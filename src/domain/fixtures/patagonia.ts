import { createHash, createHmac } from 'node:crypto';

export const PATAGONIA_FIXTURE_VERSION = 'patagonia-v1';
export const PATAGONIA_FIXTURE_SEED = '57f6286e7a6048ada8d6cf468c3b2e18';
export const PATAGONIA_AS_OF_DATE = '2026-11-24';
export const PATAGONIA_AS_OF_UTC = '2026-11-24T14:00:00.000Z';
export const PATAGONIA_UUID_NAMESPACE = '4e02949e-c6c7-4a13-99dd-428e7dd3213f';

const projectCode = 'PATAGONIA';
const rngVersion = 'patagonia-fixture-hmac-v1';
const asOfMillis = Date.parse(PATAGONIA_AS_OF_DATE);
const dayMillis = 86_400_000;
const actualTotalCents = 3_000_000_000;
const fixedRemainingTotalCents = 1_600_000_000;

type TargetSystem = 'JIRA' | 'ASSETS' | 'JSM' | 'CONFLUENCE' | 'FORGE';

type FixtureSourceRef = {
  sourceSystem: 'FIXTURE';
  sourceContainer: typeof PATAGONIA_FIXTURE_VERSION;
  sourceId: string;
  targetSystem: TargetSystem;
  observedAt: string;
  synthetic: true;
};

type FixtureWorkPackage = ReturnType<typeof buildWorkPackage>;
type ResourceKind = 'ASSET' | 'CREW';

const phaseNames = [
  'Planificación',
  'Permisos y accesos',
  'Suministro',
  'Montaje',
  'Comisionado',
  'Entrega',
] as const;

const phaseWork = [
  ['Revisión de alcance', 'Estimación base', 'Revisión de hitos', 'Control del plan'],
  ['Control de ingreso', 'Validación documental', 'Coordinación de accesos', 'Inspección de área'],
  ['Recepción de materiales', 'Seguimiento de proveedor', 'Control de almacén', 'Validación de remito'],
  ['Preparación de frente', 'Ensamble mecánico', 'Control de montaje', 'Verificación de fijaciones'],
  ['Verificación previa', 'Ensayo de aceptación', 'Revisión de protocolo', 'Informe de ensayo'],
  ['Acta de inspección', 'Revisión de pendientes', 'Entrega de documentación', 'Cierre de frente'],
] as const;

const facilityCatalog = [
  ['Base Boreal', 'BASE', 'NORTE', 0.23, 0.18],
  ['Patio Brújula', 'PATIO', 'NORTE', 0.53, 0.19],
  ['Estación Cauce', 'ESTACION', 'NORTE', 0.71, 0.28],
  ['Almacén Duna', 'ALMACEN', 'CENTRO', 0.24, 0.48],
  ['Planta Horizonte', 'PLANTA', 'CENTRO', 0.51, 0.51],
  ['Pozo Mirador', 'POZO', 'CENTRO', 0.78, 0.58],
  ['Área Nube', 'AREA', 'SUR', 0.31, 0.73],
  ['Terminal Senda', 'TERMINAL', 'SUR', 0.61, 0.84],
] as const;

const trades = [
  'Planificación', 'Obra civil', 'Suministro primario', 'Transporte', 'Inspección',
  'Entrenamiento', 'Instrumentación', 'Suministro alternativo', 'Mecánica',
  'Montaje especializado', 'Comisionado', 'Seguridad', 'Almacenamiento', 'Electricidad', 'Calidad',
] as const;

const assetTypes = [
  'Transporte', 'Izaje', 'Instrumentación', 'Generación', 'Almacenamiento',
  'Movimiento de suelo', 'Inspección', 'Apoyo',
] as const;

const documentCatalog = [
  ['PLAN-BASE', 'Bases del plan', 'Corte de planificación, fases y objetivos de cierre.'],
  ['PLAN-REVISION', 'Revisión del plan', 'Criterios para comparar una revisión con la línea base.'],
  ['ACCESO-CRITERIOS', 'Criterios de entrada', 'Validación de capacidad y ventanas de acceso del proyecto.'],
  ['ACCESO-PERMISOS', 'Registro de permisos', 'Referencias de permisos y controles para las áreas ficticias.'],
  ['A17-FICHA', 'Ficha del kit A-17', 'Kit de instalación para EQ-017 y puerta de recepción WP-048.'],
  ['A17-AVISO', 'Actualización de A-17', 'ETA original día 4 y estimación actualizada día 19 pendiente de confirmación.'],
  ['EQ017-MANTENIMIENTO', 'Ventana de mantenimiento EQ-017', 'Fin de mantenimiento y movilización previstos el día 6.'],
  ['EQ017-COMPATIBILIDAD', 'Compatibilidad EQ-017', 'El kit alternativo de CON-08 cumple el criterio ficticio de compatibilidad.'],
  ['COMISIONADO-PROTOCOLO', 'Protocolo de comisionado', 'WP-083 requiere el cierre del montaje WP-064.'],
  ['COMISIONADO-ACTA', 'Acta de comisionado', 'El acta se revisa antes de la entrega final.'],
  ['ENTREGA-DECISION', 'Criterio de decisión de entrega', 'Comparar plazo, presupuesto y restricciones antes de proponer una medida.'],
  ['ENTREGA-LECCIONES', 'Lecciones de entrega', 'Registrar supuestos, responsables y problemas pendientes de cierre.'],
] as const;

function orderByCode<T extends { code: string }>(records: T[]): T[] {
  return records.sort((left, right) => (left.code < right.code ? -1 : Number(left.code > right.code)));
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function itemAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new RangeError(`Índice de catálogo fuera de rango: ${index}`);
  }
  return value;
}

function code(prefix: string, index: number, length = 2): string {
  return `${prefix}-${String(index).padStart(length, '0')}`;
}

function workCode(index: number): string {
  return code('WP', index, 3);
}

function assetCode(index: number): string {
  return code('EQ', index, 3);
}

function fixtureId(entity: string, entityCode: string): string {
  const namespace = Buffer.from(PATAGONIA_UUID_NAMESPACE.replaceAll('-', ''), 'hex');
  const name = `${PATAGONIA_FIXTURE_VERSION}|${projectCode}|${entity}|${entityCode}`;
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const projectId = fixtureId('project', projectCode);

function sourceRef(sourceId: string, targetSystem: TargetSystem, observedAt = PATAGONIA_AS_OF_UTC): FixtureSourceRef {
  return { sourceSystem: 'FIXTURE', sourceContainer: PATAGONIA_FIXTURE_VERSION, sourceId, targetSystem, observedAt, synthetic: true };
}

function entity(entityType: string, entityCode: string, targetSystem: TargetSystem) {
  return {
    id: fixtureId(entityType, entityCode),
    projectId,
    code: entityCode,
    version: 1 as const,
    sourceRef: sourceRef(entityCode, targetSystem),
  };
}

function civilDay(day: number): string {
  return new Date(asOfMillis + day * dayMillis).toISOString().slice(0, 10);
}

function phaseNumber(workNumber: number): number {
  return Math.ceil(workNumber / 20);
}

function uniform(periodIndex: number, field: string): number {
  // The array contains only ASCII strings and safe integers and is already canonical JSON.
  const key = Buffer.from(PATAGONIA_FIXTURE_SEED, 'hex');
  const draw = JSON.stringify([rngVersion, periodIndex, field, 0]);
  const integer = createHmac('sha256', key).update(draw).digest().readBigUInt64BE(0) >> 11n;
  return Math.min((Number(integer) + 1) / 2 ** 53, 1 - 2 ** -53);
}

function distributeCents(total: number, weights: readonly number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = total;
  return weights.map((weight, index) => {
    const amount = index === weights.length - 1 ? remaining : Math.round(total * weight / weightTotal);
    remaining -= amount;
    return amount;
  });
}

const completedNumbers = range(60).filter((number) => number !== 48);
const ordinaryNumbers = range(58).map((number) => number + 60).filter((number) => number !== 64 && number !== 83);
const lanes = range(8).map((lane) => ordinaryNumbers.filter((_, index) => index % 8 === lane - 1));

type WorkSchedule = {
  start: number;
  release: number;
  duration: readonly [number, number, number];
  completed: boolean;
};

function buildWorkPackage(number: number, schedule: WorkSchedule) {
  const phase = phaseNumber(number);
  const entityCode = workCode(number);
  const milestone = number === 119 || number === 120;
  const facilityIndex = number === 48 || number === 64 || number === 83 ? 5 : (number - 1) % facilityCatalog.length + 1;
  const contractorIndex = number === 48 ? 3 : number === 64 ? 10 : (number - 1) % trades.length + 1;
  const [durationA, durationM, durationB] = schedule.duration;
  const plannedStart = civilDay(schedule.start);
  const plannedFinish = civilDay(schedule.start + durationM);
  const routineTitle = itemAt(itemAt(phaseWork, phase - 1), (number - 1) % 4);
  const titles: Partial<Record<number, string>> = {
    48: 'Recepción del kit A-17',
    64: 'Montaje con EQ-017',
    83: 'Comisionado posterior al montaje',
    119: 'Hito de cierre de carriles',
    120: 'Hito de entrega del proyecto',
  };

  return {
    ...entity('work-package', entityCode, 'JIRA'),
    phaseId: fixtureId('phase', code('PH', phase)),
    facilityId: fixtureId('facility', code('FAC', facilityIndex)),
    contractorId: fixtureId('contractor', code('CON', contractorIndex)),
    title: `[${entityCode}] ${titles[number] ?? routineTitle}`,
    businessCode: number === 48 ? 'CTX-A17' : null,
    status: schedule.completed ? 'DONE' as const : 'TODO' as const,
    plannedStart,
    plannedFinish,
    actualStart: schedule.completed ? plannedStart : null,
    actualFinish: schedule.completed ? plannedFinish : null,
    earliestStart: civilDay(schedule.release),
    durationA,
    durationM,
    durationB,
    remainingDays: schedule.completed ? 0 : durationM,
    milestone,
    priorityRank: number === 48 || number === 64 || number === 83 ? 100 : 10,
    sourceUpdatedAt: PATAGONIA_AS_OF_UTC,
  };
}

function makeWorkPackages(): FixtureWorkPackage[] {
  const schedules = new Map<number, WorkSchedule>();
  completedNumbers.forEach((number, index) => {
    schedules.set(number, { start: index - 59, release: index - 59, duration: [1, 1, 1], completed: true });
  });
  lanes.forEach((lane, index) => {
    lane.forEach((number, position) => {
      schedules.set(number, { start: index % 3 + 2 * position, release: 0, duration: [1, 2, 3], completed: false });
    });
  });
  schedules.set(48, { start: 0, release: 0, duration: [2, 4, 7], completed: false });
  schedules.set(64, { start: 6, release: 0, duration: [9, 10, 11], completed: false });
  schedules.set(83, { start: 16, release: 0, duration: [7, 8, 9], completed: false });
  schedules.set(119, { start: 26, release: 26, duration: [0, 0, 0], completed: false });
  schedules.set(120, { start: 26, release: 0, duration: [0, 0, 0], completed: false });

  return range(120).map((number) => {
    const schedule = schedules.get(number);
    if (!schedule) {
      throw new Error(`Falta el cronograma de ${workCode(number)}.`);
    }
    return buildWorkPackage(number, schedule);
  });
}

function makeDependencies() {
  const edges: Array<readonly [number, number]> = [];
  function chain(start: number, successors: readonly number[]) {
    let predecessor = start;
    for (const successor of successors) {
      edges.push([predecessor, successor]);
      predecessor = successor;
    }
  }

  chain(itemAt(completedNumbers, 0), completedNumbers.slice(1));
  for (const lane of lanes) {
    chain(60, [...lane, 119]);
  }
  chain(47, [48, 64, 83, 120]);
  chain(119, [120]);

  return orderByCode(edges.map(([predecessor, successor]) => ({
    ...entity('dependency', `${workCode(predecessor)}:${workCode(successor)}`, 'FORGE'),
    predecessorId: fixtureId('work-package', workCode(predecessor)),
    successorId: fixtureId('work-package', workCode(successor)),
    relationType: 'FS' as const,
    lagDays: 0,
  })));
}

function makeAssets() {
  return range(80).map((number) => {
    const entityCode = assetCode(number);
    const type = itemAt(assetTypes, Math.floor((number - 1) / 10));
    const nextAvailableDay = number === 17 ? 6 : (number - 1) % 3;
    return {
      ...entity('asset', entityCode, 'ASSETS'),
      name: number === 17 ? 'Equipo de izaje EQ-017' : `${type} ${entityCode}`,
      assetType: type,
      status: nextAvailableDay === 0 ? 'AVAILABLE' : 'MAINTENANCE',
      facilityId: fixtureId('facility', code('FAC', number === 17 ? 5 : (number - 1) % facilityCatalog.length + 1)),
      contractorId: fixtureId('contractor', code('CON', number === 17 ? 10 : (number - 1) % trades.length + 1)),
      nextAvailableDate: civilDay(nextAvailableDay),
      maintenanceEndsAt: nextAvailableDay > 0 ? civilDay(nextAvailableDay) : null,
      requiredShipmentId: number === 17 ? fixtureId('shipment', 'A-17') : null,
      sourceUpdatedAt: PATAGONIA_AS_OF_UTC,
    };
  });
}

function makeCrewPools() {
  return range(9).map((number) => ({
    ...entity('crew-pool', code('CR', number), 'FORGE'),
    contractorId: fixtureId('contractor', code('CON', number === 9 ? 10 : number)),
    skill: number === 9 ? 'Montaje especializado' : itemAt(trades, number - 1),
    defaultCapacity: number === 9 ? 8 : 5 + number,
    hoursPerDay: 8,
  }));
}

function makeResources(assets: ReturnType<typeof makeAssets>, crewPools: ReturnType<typeof makeCrewPools>) {
  const workResources = [];
  const resourceWindows = [];

  for (const asset of assets) {
    if (asset.maintenanceEndsAt) {
      resourceWindows.push(makeWindow('ASSET', asset.code, asset.id, PATAGONIA_AS_OF_DATE, asset.maintenanceEndsAt, 0, 'MAINTENANCE'));
    }
    resourceWindows.push(makeWindow('ASSET', asset.code, asset.id, asset.nextAvailableDate, civilDay(731), 1, 'AVAILABLE'));
  }

  for (const [index, crew] of crewPools.entries()) {
    const isMounting = index === 8;
    const group = isMounting ? [64] : itemAt(lanes, index);
    const asset = itemAt(assets, isMounting ? 16 : index);
    const availableDay = isMounting ? 6 : index % 3;

    resourceWindows.push(makeWindow('CREW', crew.code, crew.id, civilDay(availableDay), civilDay(731), crew.defaultCapacity, 'MOBILIZED'));
    for (const workNumber of group) {
      const packageCode = workCode(workNumber);
      const workPackageId = fixtureId('work-package', packageCode);
      workResources.push(
        { ...entity('work-resource', `${packageCode}:ASSET`, 'FORGE'), workPackageId, resourceKind: 'ASSET' as const, resourceId: asset.id, quantity: 1 },
        { ...entity('work-resource', `${packageCode}:CREW`, 'FORGE'), workPackageId, resourceKind: 'CREW' as const, resourceId: crew.id, quantity: crew.defaultCapacity },
      );
    }
  }

  return { workResources: orderByCode(workResources), resourceWindows: orderByCode(resourceWindows) };
}

function makeWindow(
  resourceKind: ResourceKind,
  resourceCode: string,
  resourceId: string,
  windowStart: string,
  windowEnd: string,
  capacity: number,
  reasonCode: string,
) {
  return {
    ...entity('resource-window', `${resourceCode}:${windowStart}`, 'FORGE'),
    resourceKind,
    resourceId,
    windowStart,
    windowEnd,
    capacity,
    reasonCode,
  };
}

function makeShipments(workPackages: readonly FixtureWorkPackage[]) {
  const otherGates = workPackages.filter((work, index) => index >= 40 && index < 60 && work.code !== 'WP-048');

  return range(20).map((number) => {
    const critical = number === 17;
    const gate = critical ? itemAt(workPackages, 47) : itemAt(otherGates, number < 17 ? number - 1 : number - 2);
    return {
      ...entity('shipment', code('A', number), 'FORGE'),
      gateWorkPackageId: gate.id,
      contractorId: gate.contractorId,
      assetId: critical ? fixtureId('asset', 'EQ-017') : null,
      status: critical ? 'AT_RISK' : 'DELIVERED',
      baselineEta: gate.plannedFinish,
      latestEta: critical ? civilDay(19) : gate.actualFinish,
      arrivedDate: gate.actualFinish,
      shipmentQty: critical ? 1 : number * 2,
      shipmentUnit: critical ? 'KIT' : 'UNIDAD',
      updatedAt: PATAGONIA_AS_OF_UTC,
    };
  });
}

function makeMonths() {
  return range(24).map((_, index) => {
    const start = new Date(Date.UTC(2024, 10 + index, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2024, 11 + index, 0)).toISOString().slice(0, 10);
    return { key: start.slice(0, 7), start, end };
  });
}

function makeIncidents(months: ReturnType<typeof makeMonths>) {
  const categories = ['TRÁNSITO', 'INSPECCIÓN', 'AMBIENTE', 'ORDEN'] as const;
  const severities = ['LOW', 'MEDIUM', 'HIGH'] as const;
  const recentIncidentDays = [-11, -6, -1];
  return range(18).map((number) => {
    const open = number > 15;
    const monthly = itemAt(months, Math.floor((Math.min(number, 15) - 1) * 23 / 14));
    const date = open ? civilDay(itemAt(recentIncidentDays, number - 16)) : `${monthly.key}-08`;
    return {
      ...entity('incident', code('HSE', number), 'JSM'),
      facilityId: fixtureId('facility', code('FAC', (number - 1) % facilityCatalog.length + 1)),
      workPackageId: null,
      category: itemAt(categories, (number - 1) % categories.length),
      severity: itemAt(severities, (number - 1) % severities.length),
      status: open ? 'OPEN' : 'CLOSED',
      accessClass: 'HSE_READER' as const,
      occurredAt: `${date}T10:00:00.000Z`,
      updatedAt: PATAGONIA_AS_OF_UTC,
    };
  });
}

function makeCostLine(
  entityCode: string,
  kind: 'ACTUAL' | 'FIXED_REMAINING' | 'DAILY_RATE',
  costBucket: string,
  amountCents: number,
  effectiveDate: string,
  links: { workPackageId?: string; contractorId?: string; assetId?: string; crewPoolId?: string } = {},
) {
  return {
    ...entity('cost-record', entityCode, 'FORGE'),
    recordCode: entityCode,
    kind,
    costBucket,
    amountCents: String(amountCents),
    currency: 'USD' as const,
    unitCode: kind === 'DAILY_RATE' ? 'USD_CENT_PER_DAY' : 'USD_CENT',
    effectiveDate,
    validUntil: null,
    actuality: kind === 'ACTUAL' ? 'ACTUAL' : 'ASSUMPTION',
    workPackageId: links.workPackageId ?? null,
    contractorId: links.contractorId ?? null,
    assetId: links.assetId ?? null,
    crewPoolId: links.crewPoolId ?? null,
  };
}

function makeHistoryAndCosts(months: ReturnType<typeof makeMonths>, workPackages: readonly FixtureWorkPackage[]) {
  const accrued = distributeCents(actualTotalCents, months.map((_, index) => 1 + index / 32 + 0.2 * uniform(index, 'COST_WEIGHT')));
  const actualCosts = months.map((month, index) =>
    makeCostLine(`ACT-${month.key}`, 'ACTUAL', 'ACCRUED_BASE', itemAt(accrued, index), month.end));
  const pending = workPackages.filter((work) => work.status === 'TODO' && !work.milestone);
  const remaining = distributeCents(fixedRemainingTotalCents, pending.map(() => 1));
  const remainingCosts = pending.map((work, index) =>
    makeCostLine(`REM-${work.code}`, 'FIXED_REMAINING', 'WORK_BASE', itemAt(remaining, index), PATAGONIA_AS_OF_DATE, {
      workPackageId: work.id,
      contractorId: work.contractorId,
    }));
  const mounting = itemAt(workPackages, 63);
  const rates = [
    makeCostLine('RATE-INDIRECT', 'DAILY_RATE', 'PROJECT_INDIRECT', 250_000, PATAGONIA_AS_OF_DATE),
    makeCostLine('RATE-EQ-017', 'DAILY_RATE', 'ASSET_STANDBY', 300_000, civilDay(6), {
      workPackageId: mounting.id,
      contractorId: mounting.contractorId,
      assetId: fixtureId('asset', 'EQ-017'),
    }),
    makeCostLine('RATE-CR-09', 'DAILY_RATE', 'CREW_STANDBY', 600_000, civilDay(6), {
      workPackageId: mounting.id,
      contractorId: mounting.contractorId,
      crewPoolId: fixtureId('crew-pool', 'CR-09'),
    }),
  ];

  const historicalMetrics = months.flatMap((month, index) => {
    const metrics = [
      ['AVAILABILITY', 'RATIO', Math.min(1, 0.82 + 0.003 * index + 0.04 * (uniform(index, 'AVAILABILITY') - 0.5)).toFixed(6)],
      ['PRODUCTIVITY', 'MULTIPLIER', (0.96 + 0.006 * index + 0.08 * (uniform(index, 'PRODUCTIVITY') - 0.5)).toFixed(6)],
      ['PUNCTUALITY', 'RATIO', Math.min(1, 0.75 + 0.004 * index + 0.1 * (uniform(index, 'PUNCTUALITY') - 0.5)).toFixed(6)],
      ['PLANNED_HOURS', 'HOUR', String(4000 + 60 * index)],
      ['HEADCOUNT', 'PERSON', String(Math.round(70 + 1.5 * index + 4 * (uniform(index, 'HEADCOUNT') - 0.5)))],
      ['ACCRUED_COST', 'USD_CENT', String(itemAt(accrued, index))],
    ] as const;
    return metrics.map(([metricCode, unitCode, metricValue]) => ({
      ...entity('historical-metric', `${month.key}:${metricCode}`, 'FORGE'),
      metricCode,
      dimensionKind: 'PROJECT' as const,
      dimensionId: projectId,
      unitCode,
      periodStart: month.start,
      periodEnd: month.end,
      metricValue,
      qualityCode: 'SYNTHETIC' as const,
    }));
  });

  return {
    historicalMetrics: orderByCode(historicalMetrics),
    costRecords: orderByCode([...actualCosts, ...remainingCosts, ...rates]),
  };
}

function makeKnowledge() {
  const focus: Partial<Record<string, ReadonlyArray<readonly [string, string]>>> = {
    'A17-FICHA': [['shipment', 'A-17'], ['work-package', 'WP-048'], ['asset', 'EQ-017']],
    'A17-AVISO': [['shipment', 'A-17'], ['contractor', 'CON-03']],
    'EQ017-MANTENIMIENTO': [['asset', 'EQ-017'], ['work-package', 'WP-064']],
    'EQ017-COMPATIBILIDAD': [['asset', 'EQ-017'], ['contractor', 'CON-08'], ['shipment', 'A-17']],
    'COMISIONADO-PROTOCOLO': [['work-package', 'WP-064'], ['work-package', 'WP-083']],
  };
  return orderByCode(documentCatalog.map(([subjectCode, title, description], index) => ({
    ...entity('knowledge', subjectCode, 'CONFLUENCE'),
    phaseId: fixtureId('phase', code('PH', Math.floor(index / 2) + 1)),
    subjectCode,
    title,
    body: `Documento de demostración sintético. ${description}`,
    relatedEntityIds: (focus[subjectCode] ?? []).map(([type, key]) => fixtureId(type, key)),
    sourceVersion: '1',
    checkedAt: PATAGONIA_AS_OF_UTC,
  })));
}

type ScenarioVariable = {
  ordinal: number;
  variableCode: 'SUPPLY_DELAY_DAYS' | 'ALTERNATE_SUPPLY' | 'ASSET_AVAILABLE_DAY' | 'CREW_CAPACITY';
  targetKind: 'SHIPMENT' | 'ASSET' | 'CREW';
  targetId: string;
  unitCode: 'DAY' | 'PERSON';
  value: number | {
    contractorId: string;
    etaOffsetDays: number;
    commitmentCents: string;
    compatible: true;
  } | { capacity: number; fromDay: number; untilDay: number };
  sourceRefs: FixtureSourceRef[];
  reason: string;
  assumption: true;
};

function makeScenarios(snapshotId: string) {
  const shipmentId = fixtureId('shipment', 'A-17');
  const makeSupplyDelay = (): ScenarioVariable => ({
    ordinal: 1,
    variableCode: 'SUPPLY_DELAY_DAYS',
    targetKind: 'SHIPMENT',
    targetId: shipmentId,
    unitCode: 'DAY',
    value: 15,
    sourceRefs: [sourceRef('A17-AVISO', 'CONFLUENCE')],
    reason: 'Demora adicional aplicada una vez sobre la ETA base de la entrega primaria.',
    assumption: true,
  });
  const alternateSupply: ScenarioVariable = {
    ordinal: 2,
    variableCode: 'ALTERNATE_SUPPLY',
    targetKind: 'SHIPMENT',
    targetId: shipmentId,
    unitCode: 'DAY',
    value: {
      contractorId: fixtureId('contractor', 'CON-08'),
      etaOffsetDays: 5,
      commitmentCents: '6000000',
      compatible: true,
    },
    sourceRefs: [sourceRef('EQ017-COMPATIBILIDAD', 'CONFLUENCE')],
    reason: 'Compromiso alternativo para el kit equivalente y una ETA relativa a la entrega base.',
    assumption: true,
  };
  const maintenance: ScenarioVariable = {
    ordinal: 1,
    variableCode: 'ASSET_AVAILABLE_DAY',
    targetKind: 'ASSET',
    targetId: fixtureId('asset', 'EQ-017'),
    unitCode: 'DAY',
    value: 12,
    sourceRefs: [sourceRef('EQ017-MANTENIMIENTO', 'CONFLUENCE')],
    reason: 'Ejercicio de prolongación hipotética de la ventana de mantenimiento.',
    assumption: true,
  };
  const crewCapacity: ScenarioVariable = {
    ordinal: 1,
    variableCode: 'CREW_CAPACITY',
    targetKind: 'CREW',
    targetId: fixtureId('crew-pool', 'CR-01'),
    unitCode: 'PERSON',
    value: { capacity: 3, fromDay: 2, untilDay: 7 },
    sourceRefs: [sourceRef('CR-01', 'FORGE')],
    reason: 'Ejercicio de menor dotación durante una ventana acotada.',
    assumption: true,
  };
  const definitions: Array<[string, string, ScenarioVariable[]]> = [
    ['S0', 'Plan base', []],
    ['S1', 'Retraso de suministro A-17', [makeSupplyDelay()]],
    ['S2', 'Mitigación de suministro A-17', [makeSupplyDelay(), alternateSupply]],
    ['S3', 'Mantenimiento extendido', [maintenance]],
    ['S4', 'Capacidad reducida de cuadrilla', [crewCapacity]],
  ];
  return definitions.map(([scenarioCode, name, variables]) => ({
    ...entity('scenario', scenarioCode, 'FORGE'),
    snapshotId,
    baselineId: scenarioCode === 'S0' ? null : fixtureId('scenario', 'S0'),
    name,
    state: 'PUBLISHED' as const,
    revision: 1,
    targetDay: 30,
    budgetCents: '4619500000',
    variables,
  }));
}

export type PatagoniaFixture = ReturnType<typeof generatePatagoniaFixture>;

export function generatePatagoniaFixture() {
  const workPackages = makeWorkPackages();
  const phases = phaseNames.map((name, index) => {
    const phaseWorkPackages = workPackages.slice(index * 20, (index + 1) * 20);
    const dates = phaseWorkPackages.map((work) => work.plannedStart).sort();
    const finishes = phaseWorkPackages.map((work) => work.plannedFinish).sort();
    return {
      ...entity('phase', code('PH', index + 1), 'FORGE'),
      name,
      ordinal: index + 1,
      plannedStart: itemAt(dates, 0),
      plannedEnd: itemAt(finishes, finishes.length - 1),
    };
  });
  const facilities = facilityCatalog.map(([name, facilityType, zoneCode, mapX, mapY], index) => ({
    ...entity('facility', code('FAC', index + 1), 'FORGE'),
    name,
    facilityType,
    zoneCode,
    mapX,
    mapY,
    status: 'ACTIVE',
  }));
  const contractors = trades.map((trade, index) => ({
    ...entity('contractor', code('CON', index + 1), 'ASSETS'),
    name: `Contratista sintético ${String(index + 1).padStart(2, '0')}`,
    trade,
    status: 'ACTIVE',
    sourceUpdatedAt: PATAGONIA_AS_OF_UTC,
    historicalPunctuality: (0.72 + 0.2 * uniform(index, 'CONTRACTOR_PUNCTUALITY')).toFixed(6),
    a17Qualification: index === 2 ? 'PRIMARY' : index === 7 ? 'QUALIFIED_ALTERNATE' : null,
  }));
  const months = makeMonths();
  const assets = makeAssets();
  const crewPools = makeCrewPools();
  const snapshot = {
    ...entity('snapshot', 'BASELINE', 'FORGE'),
    asOfDate: PATAGONIA_AS_OF_DATE,
    collectedAt: PATAGONIA_AS_OF_UTC,
    schemaVersion: 1,
    accessClass: 'SYNTHETIC_DEMO' as const,
  };

  return {
    manifest: {
      fixtureVersion: PATAGONIA_FIXTURE_VERSION,
      seed: PATAGONIA_FIXTURE_SEED,
      rngVersion,
      asOfDate: PATAGONIA_AS_OF_DATE,
      asOfUtc: PATAGONIA_AS_OF_UTC,
      synthetic: true as const,
      disclosure: 'Proyecto, ubicaciones y registros sintéticos de demostración.',
      accessClass: 'SYNTHETIC_DEMO' as const,
      incidentAccess: 'HSE_READER' as const,
    },
    project: {
      id: projectId,
      code: projectCode,
      name: 'Patagonia Energy Development',
      timeZone: 'America/Argentina/Buenos_Aires',
      currency: 'USD' as const,
      targetDate: civilDay(30),
      budgetCents: '4619500000',
      dataMode: 'DEMO' as const,
      status: 'ACTIVE' as const,
      version: 1,
      updatedAt: PATAGONIA_AS_OF_UTC,
      sourceRef: sourceRef(projectCode, 'JIRA'),
    },
    zones: [
      { code: 'CENTRO', name: 'Zona Centro' },
      { code: 'NORTE', name: 'Zona Norte' },
      { code: 'SUR', name: 'Zona Sur' },
    ],
    phases,
    facilities,
    workPackages,
    dependencies: makeDependencies(),
    contractors,
    assets,
    crewPools,
    ...makeResources(assets, crewPools),
    shipments: makeShipments(workPackages),
    incidents: makeIncidents(months),
    ...makeHistoryAndCosts(months, workPackages),
    knowledge: makeKnowledge(),
    snapshot,
    scenarios: makeScenarios(snapshot.id),
  };
}

export function canonicalizePatagoniaFixture(fixture: PatagoniaFixture): string {
  // The fixture contains only plain JSON records. Collections are emitted in code order.
  return JSON.stringify(fixture, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : Number(a > b)));
  });
}

export function hashPatagoniaFixture(fixture: PatagoniaFixture): string {
  return createHash('sha256').update(canonicalizePatagoniaFixture(fixture), 'utf8').digest('hex');
}
