import {
  PATAGONIA_AS_OF_DATE,
  PATAGONIA_AS_OF_UTC,
  PATAGONIA_FIXTURE_SEED,
  PATAGONIA_FIXTURE_VERSION,
  type PatagoniaFixture,
} from './patagonia';

export class PatagoniaFixtureIntegrityError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`El fixture Patagonia tiene ${issues.length} inconsistencia(s).`);
    this.name = 'PatagoniaFixtureIntegrityError';
  }
}

const uuidV5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nonnegativeInteger = /^(?:0|[1-9][0-9]*)$/;

function indexById<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

function validateGraph(fixture: PatagoniaFixture, check: (valid: boolean, issue: string) => void) {
  const workById = indexById(fixture.workPackages);
  const edgesByPredecessor = new Map<string, string[]>();
  const inDegree = new Map(fixture.workPackages.map((work) => [work.id, 0]));
  const edges = new Set<string>();
  for (const dependency of fixture.dependencies) {
    const from = workById.get(dependency.predecessorId);
    const to = workById.get(dependency.successorId);
    const edgeKey = `${dependency.predecessorId}:${dependency.successorId}`;
    const valid = Boolean(from && to && from.id !== to.id && !edges.has(edgeKey));
    check(valid, `Dependencia repetida o huérfana ${dependency.code}.`);
    check(dependency.relationType === 'FS' && Number.isInteger(dependency.lagDays) && dependency.lagDays >= 0,
      `Tipo o desfase inválido en ${dependency.code}.`);
    if (!valid || !from || !to) {
      continue;
    }
    edges.add(edgeKey);
    const finishWithLag = Date.parse(from.plannedFinish) + dependency.lagDays * 86_400_000;
    check(finishWithLag <= Date.parse(to.plannedStart), `El cronograma incumple ${dependency.code}.`);
    const successors = edgesByPredecessor.get(from.id) ?? [];
    successors.push(to.id);
    edgesByPredecessor.set(from.id, successors);
    inDegree.set(to.id, (inDegree.get(to.id) ?? 0) + 1);
  }

  const queue = fixture.workPackages.filter((work) => inDegree.get(work.id) === 0).map((work) => work.id);
  const terminals = fixture.workPackages.filter((work) => !edgesByPredecessor.has(work.id));
  check(queue.length === 1 && workById.get(queue[0] ?? '')?.code === 'WP-001', 'El DAG debe comenzar en WP-001.');
  check(terminals.length === 1 && terminals[0]?.code === 'WP-120', 'El DAG debe terminar en WP-120.');
  for (const node of queue) {
    for (const successor of edgesByPredecessor.get(node) ?? []) {
      const count = (inDegree.get(successor) ?? 0) - 1;
      inDegree.set(successor, count);
      if (count === 0) {
        queue.push(successor);
      }
    }
  }
  check(queue.length === fixture.workPackages.length, 'Hay un ciclo en las dependencias.');

  for (const [fromCode, toCode] of [['WP-047', 'WP-048'], ['WP-048', 'WP-064'], ['WP-064', 'WP-083'],
    ['WP-083', 'WP-120'], ['WP-119', 'WP-120']] as const) {
    const from = fixture.workPackages.find((work) => work.code === fromCode);
    const to = fixture.workPackages.find((work) => work.code === toCode);
    check(Boolean(from && to && edges.has(`${from.id}:${to.id}`)), `Falta el vínculo ${fromCode} → ${toCode}.`);
  }
}

function validateResources(fixture: PatagoniaFixture, check: (valid: boolean, issue: string) => void) {
  const assetById = indexById(fixture.assets);
  const crewById = indexById(fixture.crewPools);
  const workById = indexById(fixture.workPackages);
  const windowsByResource = new Map<string, PatagoniaFixture['resourceWindows']>();
  const assignmentsByResource = new Map<string, Array<{ start: string; finish: string; quantity: number }>>();

  for (const window of fixture.resourceWindows) {
    const resources = window.resourceKind === 'ASSET' ? assetById : crewById;
    check(resources.has(window.resourceId) && window.windowStart < window.windowEnd &&
      Number.isSafeInteger(window.capacity) && window.capacity >= 0, `Ventana inválida ${window.code}.`);
    const windows = windowsByResource.get(window.resourceId) ?? [];
    check(windows.every((entry) => entry.windowEnd <= window.windowStart || entry.windowStart >= window.windowEnd),
      `Ventanas superpuestas en ${window.code}.`);
    windows.push(window);
    windowsByResource.set(window.resourceId, windows);
  }

  for (const assignment of fixture.workResources) {
    const work = workById.get(assignment.workPackageId);
    const resources = assignment.resourceKind === 'ASSET' ? assetById : crewById;
    check(Boolean(work && work.status === 'TODO' && !work.milestone) && resources.has(assignment.resourceId) &&
      Number.isSafeInteger(assignment.quantity) && assignment.quantity >= 1, `Asignación inválida ${assignment.code}.`);
    if (!work) {
      continue;
    }
    const records = assignmentsByResource.get(assignment.resourceId) ?? [];
    records.push({ start: work.plannedStart, finish: work.plannedFinish, quantity: assignment.quantity });
    assignmentsByResource.set(assignment.resourceId, records);
  }

  for (const [resourceId, reservations] of assignmentsByResource) {
    const windows = windowsByResource.get(resourceId) ?? [];
    for (const reservation of reservations) {
      const committed = reservations
        .filter((other) => other.start <= reservation.start && other.finish > reservation.start)
        .reduce((total, other) => total + other.quantity, 0);
      check(windows.some((window) => window.windowStart <= reservation.start &&
        window.windowEnd >= reservation.finish && window.capacity >= committed),
      `La disponibilidad del recurso ${resourceId} no cubre el cronograma base.`);
    }
  }
}

function validateHistoryAndCosts(fixture: PatagoniaFixture, check: (valid: boolean, issue: string) => void) {
  const metricsPerMonth = new Map<string, Set<string>>();
  const actualCostByMonth = new Map<string, string>();
  const pendingWorkWithCost = new Set(fixture.workPackages
    .filter((work) => work.status === 'TODO' && !work.milestone)
    .map((work) => work.id));

  let actualTotal = 0n;
  let remainingTotal = 0n;
  for (const cost of fixture.costRecords) {
    const valid = nonnegativeInteger.test(cost.amountCents) && cost.currency === 'USD';
    check(valid, `Importe inválido en ${cost.code}.`);
    if (!valid) {
      continue;
    }
    const amount = BigInt(cost.amountCents);
    if (cost.kind === 'ACTUAL') {
      const month = cost.effectiveDate.slice(0, 7);
      check(cost.unitCode === 'USD_CENT' && !actualCostByMonth.has(month), `Devengado mensual duplicado o inválido en ${cost.code}.`);
      actualCostByMonth.set(month, cost.amountCents);
      actualTotal += amount;
    }
    if (cost.kind === 'FIXED_REMAINING') {
      check(cost.workPackageId !== null && pendingWorkWithCost.delete(cost.workPackageId),
        `Costo base duplicado o sin trabajo pendiente en ${cost.code}.`);
      remainingTotal += amount;
    }
    check(cost.kind !== 'DAILY_RATE' || cost.unitCode === 'USD_CENT_PER_DAY', `Unidad de tasa inválida en ${cost.code}.`);
  }
  check(pendingWorkWithCost.size === 0, 'Falta el costo base de un trabajo pendiente.');
  check(actualTotal === 3_000_000_000n && remainingTotal === 1_600_000_000n, 'Los subtotales de costos no coinciden con el plan base.');

  for (const metric of fixture.historicalMetrics) {
    const month = metric.periodStart.slice(0, 7);
    const names = metricsPerMonth.get(month) ?? new Set<string>();
    check(!names.has(metric.metricCode), `Métrica mensual duplicada ${metric.code}.`);
    names.add(metric.metricCode);
    metricsPerMonth.set(month, names);
    const value = Number(metric.metricValue);
    check(Number.isFinite(value) && value >= 0 && (metric.unitCode !== 'RATIO' || value <= 1), `Valor inválido en ${metric.code}.`);
    if (metric.metricCode === 'ACCRUED_COST') {
      check(metric.metricValue === actualCostByMonth.get(month), `Devengado histórico sin respaldo en ${metric.code}.`);
    }
  }

  const expectedMetricCodes = ['AVAILABILITY', 'PRODUCTIVITY', 'PUNCTUALITY', 'PLANNED_HOURS', 'HEADCOUNT', 'ACCRUED_COST'];
  for (let index = 0; index < 24; index += 1) {
    const month = new Date(Date.UTC(2024, 10 + index, 1)).toISOString().slice(0, 7);
    const names = metricsPerMonth.get(month);
    check(Boolean(names?.size === expectedMetricCodes.length && expectedMetricCodes.every((name) => names.has(name))) &&
      actualCostByMonth.has(month), `Faltan métricas o costos en ${month}.`);
  }
}

export function validatePatagoniaFixture(fixture: PatagoniaFixture): void {
  const issues: string[] = [];
  function check(valid: boolean, issue: string) {
    if (!valid) {
      issues.push(issue);
    }
  }

  check(fixture.manifest.fixtureVersion === PATAGONIA_FIXTURE_VERSION && fixture.manifest.seed === PATAGONIA_FIXTURE_SEED &&
    fixture.manifest.asOfDate === PATAGONIA_AS_OF_DATE && fixture.manifest.asOfUtc === PATAGONIA_AS_OF_UTC &&
    fixture.manifest.synthetic && fixture.manifest.incidentAccess === 'HSE_READER', 'El manifiesto sintético no coincide con su versión.');
  check(fixture.project.code === 'PATAGONIA' && fixture.project.name === 'Patagonia Energy Development' &&
    fixture.project.dataMode === 'DEMO' && fixture.project.currency === 'USD' &&
    fixture.project.targetDate === '2026-12-24' && fixture.project.budgetCents === '4619500000', 'La identidad o los objetivos del proyecto son inválidos.');

  const collections = {
    phases: fixture.phases,
    facilities: fixture.facilities,
    workPackages: fixture.workPackages,
    dependencies: fixture.dependencies,
    contractors: fixture.contractors,
    assets: fixture.assets,
    crewPools: fixture.crewPools,
    workResources: fixture.workResources,
    resourceWindows: fixture.resourceWindows,
    shipments: fixture.shipments,
    incidents: fixture.incidents,
    historicalMetrics: fixture.historicalMetrics,
    costRecords: fixture.costRecords,
    knowledge: fixture.knowledge,
    scenarios: fixture.scenarios,
  };
  const expectedCounts = {
    phases: 6, facilities: 8, workPackages: 120, contractors: 15, assets: 80, crewPools: 9,
    workResources: 114, shipments: 20, incidents: 18, historicalMetrics: 144, costRecords: 86, knowledge: 12, scenarios: 5,
  };
  for (const [name, count] of Object.entries(expectedCounts)) {
    const records = collections[name as keyof typeof expectedCounts];
    check(records.length === count, `Se esperaban ${count} filas en ${name}.`);
  }
  check(uuidV5.test(fixture.project.id) && uuidV5.test(fixture.snapshot.id) &&
    fixture.project.id !== fixture.snapshot.id && fixture.snapshot.projectId === fixture.project.id &&
    fixture.snapshot.asOfDate === PATAGONIA_AS_OF_DATE && fixture.snapshot.accessClass === fixture.manifest.accessClass,
  'El snapshot base no pertenece al proyecto sintético.');

  const allIds = new Set([fixture.project.id, fixture.snapshot.id]);
  const origins = new Set<string>();
  for (const records of Object.values(collections)) {
    let previousCode = '';
    for (const record of records) {
      check(record.code > previousCode && uuidV5.test(record.id) && !allIds.has(record.id) && record.projectId === fixture.project.id,
        `Registro desordenado, duplicado o ajeno ${record.code}.`);
      check(record.sourceRef.synthetic && record.sourceRef.sourceSystem === 'FIXTURE' &&
        record.sourceRef.sourceContainer === PATAGONIA_FIXTURE_VERSION && record.sourceRef.sourceId === record.code,
      `Procedencia sintética inválida ${record.code}.`);
      previousCode = record.code;
      allIds.add(record.id);
      origins.add(`${record.sourceRef.targetSystem}:${record.sourceRef.sourceId}`);
    }
  }

  const phases = indexById(fixture.phases);
  const facilities = indexById(fixture.facilities);
  const contractors = indexById(fixture.contractors);
  const assets = indexById(fixture.assets);
  const crewPools = indexById(fixture.crewPools);
  const workPackages = indexById(fixture.workPackages);
  const shipments = indexById(fixture.shipments);
  for (const [index, work] of fixture.workPackages.entries()) {
    check(work.code === `WP-${String(index + 1).padStart(3, '0')}` &&
      phases.get(work.phaseId)?.ordinal === Math.floor(index / 20) + 1 &&
      facilities.has(work.facilityId) && contractors.has(work.contractorId),
    `Fase, instalación o contratista inválidos en ${work.code}.`);
    check(work.earliestStart <= work.plannedStart && work.plannedStart <= work.plannedFinish &&
      work.durationA >= 0 && work.durationA <= work.durationM && work.durationM <= work.durationB &&
      (!work.milestone || work.durationB === 0),
    `Fechas o PERT inválidos en ${work.code}.`);
    check(work.status === 'DONE'
      ? work.actualStart === work.plannedStart && work.actualFinish === work.plannedFinish &&
        work.actualFinish <= PATAGONIA_AS_OF_DATE && work.remainingDays === 0
      : work.actualStart === null && work.actualFinish === null && work.remainingDays === work.durationM,
    `El estado de trabajo no coincide con los hechos en ${work.code}.`);
  }

  for (const asset of fixture.assets) {
    check(facilities.has(asset.facilityId) && contractors.has(asset.contractorId) &&
      (asset.requiredShipmentId === null || shipments.get(asset.requiredShipmentId)?.assetId === asset.id),
    `Referencias inválidas para ${asset.code}.`);
  }
  for (const crew of fixture.crewPools) {
    check(contractors.has(crew.contractorId) && Number.isSafeInteger(crew.defaultCapacity) &&
      crew.defaultCapacity > 0 && crew.hoursPerDay > 0, `Cuadrilla inválida ${crew.code}.`);
  }
  for (const shipment of fixture.shipments) {
    const gate = workPackages.get(shipment.gateWorkPackageId);
    check(Boolean(gate && gate.contractorId === shipment.contractorId && gate.plannedFinish === shipment.baselineEta) &&
      contractors.has(shipment.contractorId) && (shipment.assetId === null || assets.get(shipment.assetId)?.requiredShipmentId === shipment.id),
    `Referencias inválidas para el envío ${shipment.code}.`);
    check(shipment.status === 'DELIVERED'
      ? shipment.arrivedDate !== null && shipment.arrivedDate <= PATAGONIA_AS_OF_DATE && shipment.arrivedDate === gate?.actualFinish
      : shipment.arrivedDate === null, `La ETA y el arribo no concilian en ${shipment.code}.`);
  }
  for (const incident of fixture.incidents) {
    check(facilities.has(incident.facilityId) && incident.accessClass === 'HSE_READER' &&
      incident.occurredAt <= PATAGONIA_AS_OF_UTC, `Acceso o fecha inválidos en ${incident.code}.`);
  }
  check(fixture.incidents.filter((incident) => incident.status === 'OPEN').length === 3, 'El fixture debe incluir tres incidentes abiertos.');
  for (const cost of fixture.costRecords) {
    check((cost.workPackageId === null || workPackages.has(cost.workPackageId)) &&
      (cost.contractorId === null || contractors.has(cost.contractorId)) &&
      (cost.assetId === null || assets.has(cost.assetId)) &&
      (cost.crewPoolId === null || crewPools.has(cost.crewPoolId)), `Referencias de costo inválidas en ${cost.code}.`);
  }
  for (const document of fixture.knowledge) {
    check(phases.has(document.phaseId) && document.relatedEntityIds.every((id) => allIds.has(id)),
      `Documento o evidencia sin referencia válida ${document.code}.`);
  }

  validateGraph(fixture, check);
  validateResources(fixture, check);
  validateHistoryAndCosts(fixture, check);

  const shipmentA17 = fixture.shipments.find((item) => item.code === 'A-17');
  const workGate = shipmentA17 && workPackages.get(shipmentA17.gateWorkPackageId);
  const resourceA17 = shipmentA17?.assetId ? assets.get(shipmentA17.assetId) : undefined;
  check(Boolean(shipmentA17?.baselineEta === '2026-11-28' && shipmentA17.latestEta === '2026-12-13' &&
    shipmentA17.arrivedDate === null && workGate?.code === 'WP-048' && workGate.businessCode === 'CTX-A17' &&
    contractors.get(shipmentA17.contractorId)?.code === 'CON-03' && resourceA17?.code === 'EQ-017' &&
    resourceA17.maintenanceEndsAt === '2026-11-30'), 'Los anclajes de A-17 no coinciden con el caso de demostración.');
  const mounting = fixture.workPackages.find((work) => work.code === 'WP-064');
  const mountingCrew = fixture.crewPools.find((crew) => crew.code === 'CR-09');
  const mountingAssignments = fixture.workResources.filter((assignment) => assignment.workPackageId === mounting?.id);
  check(mountingAssignments.length === 2 && mountingAssignments.some((assignment) => assignment.resourceKind === 'ASSET' &&
    assignment.resourceId === resourceA17?.id) && mountingAssignments.some((assignment) => assignment.resourceKind === 'CREW' &&
    assignment.resourceId === mountingCrew?.id), 'WP-064 requiere EQ-017 y la cuadrilla CR-09.');

  const baseline = fixture.scenarios.find((scenario) => scenario.code === 'S0');
  check(baseline?.baselineId === null && baseline.variables.length === 0, 'S0 debe conservar una base sin perturbaciones.');
  for (const scenario of fixture.scenarios) {
    check(scenario.snapshotId === fixture.snapshot.id && scenario.targetDay === 30 &&
      scenario.budgetCents === fixture.project.budgetCents && (scenario.code === 'S0' || scenario.baselineId === baseline?.id),
    `Umbrales o snapshot incompatibles en ${scenario.code}.`);
    for (const [index, variable] of scenario.variables.entries()) {
      const targets = variable.targetKind === 'ASSET' ? assets : variable.targetKind === 'CREW' ? crewPools : shipments;
      check(variable.ordinal === index + 1 && variable.assumption && targets.has(variable.targetId) &&
        variable.sourceRefs.length > 0 &&
        variable.sourceRefs.every((ref) => origins.has(`${ref.targetSystem}:${ref.sourceId}`)),
      `Variable sin evidencia o destino compatible en ${scenario.code}.`);
    }
  }
  const scenarioS1 = fixture.scenarios.find((scenario) => scenario.code === 'S1');
  const scenarioS2 = fixture.scenarios.find((scenario) => scenario.code === 'S2');
  const delayS1 = scenarioS1?.variables.find((variable) => variable.variableCode === 'SUPPLY_DELAY_DAYS');
  const delayS2 = scenarioS2?.variables.find((variable) => variable.variableCode === 'SUPPLY_DELAY_DAYS');
  const alternate = scenarioS2?.variables.find((variable) => variable.variableCode === 'ALTERNATE_SUPPLY');
  const alternateValue = alternate?.value;
  check(Boolean(shipmentA17 && scenarioS1?.variables.length === 1 && scenarioS2?.variables.length === 2 &&
    delayS1?.value === 15 && delayS2?.value === 15 && delayS1.targetId === shipmentA17.id &&
    delayS2.targetId === shipmentA17.id && alternate?.targetId === shipmentA17.id && alternateValue &&
    typeof alternateValue === 'object' && 'contractorId' in alternateValue && alternateValue.compatible &&
    alternateValue.etaOffsetDays === 5 && alternateValue.commitmentCents === '6000000' &&
    contractors.get(alternateValue.contractorId)?.code === 'CON-08' &&
    contractors.get(alternateValue.contractorId)?.a17Qualification === 'QUALIFIED_ALTERNATE'),
  'S1 debe aplicar una vez la demora y S2 requiere la alternativa compatible de CON-08.');

  if (issues.length > 0) {
    throw new PatagoniaFixtureIntegrityError(issues);
  }
}
