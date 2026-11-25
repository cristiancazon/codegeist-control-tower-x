import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalizePatagoniaFixture,
  generatePatagoniaFixture,
  hashPatagoniaFixture,
  PATAGONIA_AS_OF_DATE,
  PATAGONIA_AS_OF_UTC,
} from './patagonia';
import { PatagoniaFixtureIntegrityError, validatePatagoniaFixture } from './validate-patagonia';

function withCode<T extends { code: string }>(records: readonly T[], code: string): T {
  const value = records.find((record) => record.code === code);
  assert.ok(value, `Falta ${code}`);
  return value;
}

const day = (date: string) => (Date.parse(date) - Date.parse(PATAGONIA_AS_OF_DATE)) / 86_400_000;

test('CT002-03: el corpus Patagonia es canónico, trazable y reproducible', () => {
  const first = generatePatagoniaFixture();
  const second = generatePatagoniaFixture();
  validatePatagoniaFixture(first);
  validatePatagoniaFixture(second);

  assert.equal(canonicalizePatagoniaFixture(first), canonicalizePatagoniaFixture(second));
  assert.equal(hashPatagoniaFixture(first), hashPatagoniaFixture(second));
  assert.equal(hashPatagoniaFixture(first), '569d204b8b523306a7e8660894a4516a902d9642907fcb99755c8ebc31e26fde');
  assert.equal(first.manifest.asOfUtc, PATAGONIA_AS_OF_UTC);
  assert.equal(first.project.name, 'Patagonia Energy Development');
  assert.equal(first.phases.length, 6);
  assert.equal(first.facilities.length, 8);
  assert.equal(first.workPackages.length, 120);
  assert.equal(first.workPackages.filter((work) => work.status === 'DONE').length, 59);
  assert.equal(first.contractors.length, 15);
  assert.equal(first.assets.length, 80);
  const assetTypes = new Set(first.assets.map((asset) => asset.assetType));
  assert.equal(assetTypes.size, 8);
  assert.ok([...assetTypes].every((type) => first.assets.filter((asset) => asset.assetType === type).length === 10));
  assert.equal(first.shipments.length, 20);
  assert.equal(first.knowledge.length, 12);
  assert.equal(first.incidents.length, 18);

  const metadata = first.workPackages.map(({ id, code, sourceRef }) => ({ id, code, sourceRef }));
  assert.equal(new Set(metadata.map(({ id }) => id)).size, 120);
  assert.ok(metadata.every(({ code, sourceRef }) =>
    sourceRef.synthetic && sourceRef.sourceId === code && sourceRef.targetSystem === 'JIRA'));
  assert.ok(first.workPackages.every((work) => !('jiraIssueId' in work) && !('jiraIssueKey' in work)));
  assert.ok(first.incidents.every((incident) => incident.accessClass === 'HSE_READER' && incident.sourceRef.synthetic));
});

test('CT002-03: 24 cohortes contiguas concilian los costos en centavos', () => {
  const fixture = generatePatagoniaFixture();
  const periods = [...new Set(fixture.historicalMetrics.map((record) => record.periodStart))];
  assert.equal(periods.length, 24);
  assert.equal(periods.at(0), '2024-11-01');
  assert.equal(periods.at(-1), '2026-10-01');
  assert.ok(periods.every((start, index) => start === new Date(Date.UTC(2024, 10 + index, 1)).toISOString().slice(0, 10)));
  assert.ok(periods.every((start) => fixture.historicalMetrics.filter((row) => row.periodStart === start).length === 6));

  const totalCost = (kind: string) => fixture.costRecords
    .filter((record) => record.kind === kind)
    .reduce((total, record) => total + BigInt(record.amountCents), 0n);
  assert.equal(totalCost('ACTUAL'), 3_000_000_000n);
  assert.equal(totalCost('FIXED_REMAINING'), 1_600_000_000n);
  for (const monthly of fixture.historicalMetrics.filter((metric) => metric.metricCode === 'ACCRUED_COST')) {
    assert.equal(withCode(fixture.costRecords, `ACT-${monthly.periodStart.slice(0, 7)}`).amountCents, monthly.metricValue);
  }
});

test('CT002-03: A-17 conecta el envío, el activo, el montaje y el comisionado', () => {
  const fixture = generatePatagoniaFixture();
  const shipment = withCode(fixture.shipments, 'A-17');
  const equipment = withCode(fixture.assets, 'EQ-017');
  const gate = withCode(fixture.workPackages, 'WP-048');
  const mount = withCode(fixture.workPackages, 'WP-064');
  const commissioning = withCode(fixture.workPackages, 'WP-083');
  const lanesFinish = withCode(fixture.workPackages, 'WP-119');
  const finish = withCode(fixture.workPackages, 'WP-120');
  const mountingCrew = withCode(fixture.crewPools, 'CR-09');
  const alternateContractor = withCode(fixture.contractors, 'CON-08');
  const primaryContractor = withCode(fixture.contractors, 'CON-03');

  assert.equal(shipment.gateWorkPackageId, gate.id);
  assert.equal(shipment.contractorId, primaryContractor.id);
  assert.equal(shipment.assetId, equipment.id);
  assert.equal(equipment.requiredShipmentId, shipment.id);
  assert.equal(gate.businessCode, 'CTX-A17');
  assert.equal(day(shipment.baselineEta), 4);
  assert.equal(shipment.latestEta && day(shipment.latestEta), 19);
  assert.equal(shipment.arrivedDate, null);
  assert.deepEqual([gate.durationA, gate.durationM, gate.durationB], [2, 4, 7]);
  assert.deepEqual([mount.durationA, mount.durationM, mount.durationB], [9, 10, 11]);
  assert.deepEqual([commissioning.durationA, commissioning.durationM, commissioning.durationB], [7, 8, 9]);

  const dependency = (from: string, to: string) =>
    fixture.dependencies.some((edge) => edge.predecessorId === from && edge.successorId === to && edge.relationType === 'FS');
  assert.ok(dependency(gate.id, mount.id));
  assert.ok(dependency(mount.id, commissioning.id));
  assert.ok(dependency(commissioning.id, finish.id));
  assert.ok(dependency(lanesFinish.id, finish.id));

  const mountingResources = fixture.workResources.filter((resource) => resource.workPackageId === mount.id);
  assert.deepEqual(mountingResources.map((resource) => resource.resourceId), [equipment.id, mountingCrew.id]);
  const crewWindow = fixture.resourceWindows.find((window) => window.resourceId === mountingCrew.id && window.capacity > 0);
  assert.ok(crewWindow);
  const mobilizedDay = Math.max(day(equipment.nextAvailableDate), day(crewWindow.windowStart));
  assert.equal(mobilizedDay, 6);

  const s0 = withCode(fixture.scenarios, 'S0');
  const s1 = withCode(fixture.scenarios, 'S1');
  const s2 = withCode(fixture.scenarios, 'S2');
  assert.deepEqual(s0.variables, []);
  const delay = s1.variables.find((variable) => variable.variableCode === 'SUPPLY_DELAY_DAYS');
  const alternate = s2.variables.find((variable) => variable.variableCode === 'ALTERNATE_SUPPLY');
  assert.ok(delay && typeof delay.value === 'number');
  assert.ok(alternate && typeof alternate.value === 'object' && 'contractorId' in alternate.value);
  assert.equal(alternate.value.contractorId, alternateContractor.id);
  assert.ok(alternate.value.compatible);
  assert.deepEqual(s2.variables[0], delay);
  assert.equal(s0.snapshotId, s1.snapshotId);
  assert.equal(s1.snapshotId, s2.snapshotId);
  assert.equal(s2.targetDay, 30);

  // Modal oracle from §7.3, independent of the future engine.
  const baseEta = day(shipment.baselineEta);
  const primaryEta = baseEta + delay.value;
  const alternateEta = baseEta + alternate.value.etaOffsetDays;
  const releaseDays = [baseEta, primaryEta, Math.min(primaryEta, alternateEta)].map((eta) => Math.max(mobilizedDay, eta));
  const paidWaitDays = releaseDays.map((release) => release - mobilizedDay);
  const commissioningFinishes = releaseDays.map((release) => release + mount.durationM + commissioning.durationM);
  const projectFinishes = commissioningFinishes.map((end) => Math.max(end, day(lanesFinish.earliestStart)));
  const standbyCents = Number(withCode(fixture.costRecords, 'RATE-EQ-017').amountCents) +
    Number(withCode(fixture.costRecords, 'RATE-CR-09').amountCents);
  const indirectCents = Number(withCode(fixture.costRecords, 'RATE-INDIRECT').amountCents);
  const mitigationCents = Number(alternate.value.commitmentCents);
  const baselineFinish = projectFinishes[0];
  assert.ok(baselineFinish !== undefined);
  const deltas = projectFinishes.map((end, index) =>
    (paidWaitDays[index] ?? 0) * standbyCents + (end - baselineFinish) * indirectCents +
    (index === 2 ? mitigationCents : 0));

  assert.deepEqual(releaseDays, [6, 19, 9]);
  assert.deepEqual(paidWaitDays, [0, 13, 3]);
  assert.deepEqual(commissioningFinishes, [24, 37, 27]);
  assert.deepEqual(projectFinishes, [26, 37, 27]);
  assert.deepEqual(deltas, [0, 14_450_000, 8_950_000]);
});

test('CT002-03: se rechazan ciclos, referencias ajenas, faltantes y compromisos incompatibles', () => {
  const corrupted = generatePatagoniaFixture();
  const first = withCode(corrupted.workPackages, 'WP-001');
  const last = withCode(corrupted.workPackages, 'WP-120');
  const originalEdge = withCode(corrupted.dependencies, 'WP-083:WP-120');
  corrupted.dependencies.push({
    ...originalEdge,
    id: '84e700ee-34a9-5042-ae4a-e3ef3576a71d',
    code: 'WP-120:WP-001',
    predecessorId: last.id,
    successorId: first.id,
  });
  withCode(corrupted.assets, 'EQ-017').projectId = '572166da-d0ce-5f35-9f75-51f7aa78f255';
  corrupted.historicalMetrics.pop();
  withCode(corrupted.contractors, 'CON-08').a17Qualification = null;
  assert.throws(() => validatePatagoniaFixture(corrupted), (error: unknown) => {
    assert.ok(error instanceof PatagoniaFixtureIntegrityError);
    assert.ok(error.issues.some((issue) => issue.includes('ciclo')));
    assert.ok(error.issues.some((issue) => issue.includes('ajeno EQ-017')));
    assert.ok(error.issues.some((issue) => issue.includes('2026-10')));
    assert.ok(error.issues.some((issue) => issue.includes('alternativa compatible')));
    return true;
  });
});
