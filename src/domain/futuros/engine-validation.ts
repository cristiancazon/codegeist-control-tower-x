import { requireModel } from './engine-error';
import type { EngineInput, Pert } from './types';

export const MAX_HORIZON = 730;
const earliestDay = -365_000;
const maxMoney = BigInt(Number.MAX_SAFE_INTEGER);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;
const hashPattern = /^[0-9a-f]{64}$/;

const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const numeric = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const record = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): boolean => typeof value === 'string' && idPattern.test(value);
const digest = (value: unknown): boolean => typeof value === 'string' && hashPattern.test(value);

function civilDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function identified<T extends { id: string }>(items: T[], field: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    requireModel(record(item) && identifier(item.id) && !map.has(item.id), field, 'La colección contiene un ID inválido o repetido.');
    map.set(item.id, item);
  }
  return map;
}

export function validatePert(value: Pert, field: string) {
  requireModel(Array.isArray(value) && value.length === 3 && value.every((item) => numeric(item, 0, MAX_HORIZON)) &&
    value[0] <= value[1] && value[1] <= value[2], field, 'La estimación PERT debe cumplir 0 ≤ mínimo ≤ moda ≤ máximo ≤ 730.');
}

function validateCents(value: string, field: string): bigint {
  requireModel(typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value), field,
    'El importe debe expresarse como centavos enteros no negativos.');
  const amount = BigInt(value);
  requireModel(amount <= maxMoney, field, 'El importe excede el rango de centavos admitido.');
  return amount;
}

export function validateEngineInput(input: EngineInput) {
  requireModel(record(input), 'input', 'Faltan los datos de la corrida.', 'INSUFFICIENT_DATA');
  requireModel(identifier(input.snapshotId) && digest(input.snapshotHash), 'snapshot', 'La identidad del snapshot es inválida.');
  requireModel(identifier(input.scenarioId) && digest(input.scenarioHash), 'scenario', 'La identidad del escenario es inválida.');
  requireModel(civilDate(input.asOf), 'asOf', 'La fecha de corte civil es inválida.');
  requireModel(input.calendar === 'CONTINUOUS', 'calendar', 'El modelo admite días corridos.');
  requireModel(input.currency === 'USD', 'currency', 'La corrida requiere una única moneda USD.');
  requireModel(typeof input.seed === 'string' && /^[0-9a-f]{32}$/.test(input.seed), 'seed', 'La semilla debe tener 32 dígitos hexadecimales.');
  requireModel(integer(input.sampleCount, 1, 10_000), 'sampleCount', 'La cantidad de muestras está fuera del rango admitido.');
  requireModel(integer(input.horizon, 1, MAX_HORIZON), 'horizon', 'El horizonte debe estar entre 1 y 730 días.');
  requireModel(integer(input.targetDay, 0, MAX_HORIZON), 'targetDay', 'El objetivo de plazo está fuera del rango admitido.');
  validateCents(input.budgetCents, 'budgetCents');

  requireModel(Array.isArray(input.tasks) && input.tasks.length > 0, 'tasks', 'El snapshot no contiene tareas.', 'INSUFFICIENT_DATA');
  requireModel(input.tasks.length <= 250, 'tasks', 'El modelo admite hasta 250 tareas.');
  requireModel(Array.isArray(input.dependencies) && input.dependencies.length <= 1_000, 'dependencies', 'El modelo admite hasta 1000 dependencias.');
  requireModel(Array.isArray(input.resources) && input.resources.length <= 1_000, 'resources', 'El perfil de recursos es inválido.');
  requireModel(Array.isArray(input.gates) && input.gates.length <= input.tasks.length, 'gates', 'El perfil de entregas es inválido.');
  requireModel(Array.isArray(input.risks) && input.risks.length <= 250, 'risks', 'El perfil de riesgos es inválido.');
  requireModel(record(input.costs) && Array.isArray(input.costs.standby) && input.costs.standby.length <= 1_000,
    'costs', 'Faltan los costos base o las tasas de espera.', 'INSUFFICIENT_DATA');

  const tasks = identified(input.tasks, 'tasks');
  const resources = identified(input.resources, 'resources');
  const gates = identified(input.gates, 'gates');
  identified(input.risks, 'risks');
  const codes = new Set<string>();

  for (const resource of resources.values()) {
    const field = `resource:${resource.id}`;
    requireModel(resource.kind === 'ASSET' || resource.kind === 'CREW', field, 'El tipo de recurso es inválido.');
    requireModel(Array.isArray(resource.windows) && resource.windows.length <= MAX_HORIZON + 1,
      field, 'Las ventanas del recurso exceden el perfil admitido.');
    for (const window of resource.windows) {
      requireModel(record(window) && integer(window.fromDay, earliestDay, MAX_HORIZON) &&
        integer(window.untilDay, earliestDay, MAX_HORIZON + 1) && window.untilDay > window.fromDay &&
        integer(window.capacity, 0, resource.kind === 'ASSET' ? 1 : 32_767),
      field, 'Una ventana de capacidad es inválida.');
    }
    const windows = [...resource.windows].sort((a, b) => a.fromDay - b.fromDay);
    for (let index = 1; index < windows.length; index += 1) {
      requireModel(windows[index - 1]!.untilDay <= windows[index]!.fromDay, field, 'Las ventanas de capacidad deben ser disjuntas.');
    }
  }

  for (const task of tasks.values()) {
    const field = `task:${task.id}`;
    requireModel(identifier(task.code) && !codes.has(task.code), field, 'El código de trabajo es inválido o repetido.');
    codes.add(task.code);
    requireModel(integer(task.releaseDay, earliestDay, MAX_HORIZON) && Number.isSafeInteger(task.priority) &&
      typeof task.milestone === 'boolean', field, 'Fecha, prioridad o hito inválido.');
    validatePert(task.duration, `${field}:duration`);
    requireModel(!task.milestone || task.duration[2] === 0, field, 'Un hito tiene duración cero.');
    requireModel(task.productivity === undefined || numeric(task.productivity, 0.25, 4), field, 'La productividad debe estar entre 0,25 y 4.');
    if (task.actual !== undefined) {
      requireModel(record(task.actual) && integer(task.actual.startDay, earliestDay, 0) &&
        integer(task.actual.finishDay, task.actual.startDay, 0) && (!task.milestone || task.actual.startDay === task.actual.finishDay),
      field, 'Las fechas de trabajo terminado deben ser compatibles con el corte.');
    }

    requireModel(Array.isArray(task.requirements) && task.requirements.length <= resources.size,
      field, 'Los requerimientos de capacidad son inválidos.');
    const seen = new Set<string>();
    for (const requirement of task.requirements) {
      requireModel(record(requirement), field, 'El requerimiento de capacidad es inválido.');
      const resource = resources.get(requirement.resourceId);
      requireModel(resource && !seen.has(resource.id) &&
        integer(requirement.quantity, 1, resource.kind === 'ASSET' ? 1 : 32_767),
      field, 'Un requerimiento referencia un recurso inexistente, repetido o tiene cantidad inválida.');
      seen.add(resource.id);
    }
    requireModel(task.actual || task.duration[2] > 0 || task.requirements.length === 0, field,
      'Una tarea sin duración carece de reservas de capacidad.');
  }

  const dependencies = new Set<string>();
  for (const edge of input.dependencies) {
    requireModel(record(edge), 'dependencies', 'La dependencia es inválida.');
    const predecessor = tasks.get(edge.predecessorId);
    const successor = tasks.get(edge.successorId);
    const edgeKey = JSON.stringify([edge.predecessorId, edge.successorId]);
    requireModel(predecessor && successor && predecessor.id !== successor.id && !dependencies.has(edgeKey) &&
      integer(edge.lagDays, 0, MAX_HORIZON), 'dependencies', 'La dependencia tiene extremos, duplicados o espera inválidos.');
    if (successor.actual) {
      requireModel(predecessor.actual && predecessor.actual.finishDay + edge.lagDays <= successor.actual.startDay,
        'dependencies', 'Las dependencias contradicen fechas ejecutadas.');
    }
    dependencies.add(edgeKey);
  }

  let maximumCost = validateCents(input.costs.actualCents, 'costs.actualCents') +
    validateCents(input.costs.remainingCents, 'costs.remainingCents') +
    validateCents(input.costs.indirectCentsPerDay, 'costs.indirectCentsPerDay') * BigInt(input.horizon);
  const gateTasks = new Set<string>();
  for (const gate of gates.values()) {
    const field = `gate:${gate.id}`;
    const task = tasks.get(gate.taskId);
    requireModel(task && !task.actual && !gateTasks.has(task.id) && task.requirements.length === 0 &&
      integer(gate.delayDays, 0, 365), field, 'La entrega requiere una puerta futura única y un atraso permitido.');
    gateTasks.add(task.id);
    validatePert(gate.delivery, `${field}:delivery`);
    if (gate.alternative !== undefined) {
      requireModel(record(gate.alternative) && integer(gate.alternative.offsetDays, 0, 365), field, 'El plazo del proveedor alternativo es inválido.');
      maximumCost += validateCents(gate.alternative.commitmentCents, `${field}:commitmentCents`);
    }
  }
  for (const risk of input.risks) {
    const field = `risk:${risk.id}`;
    requireModel(numeric(risk.probability, 0, 1) && integer(risk.delayDays, 0, 365) &&
      (risk.gateId === undefined ? risk.delayDays === 0 : gates.has(risk.gateId)),
    field, 'El riesgo requiere probabilidad válida y una puerta existente si cambia la entrega.');
    maximumCost += validateCents(risk.costCents, `${field}:costCents`);
  }

  const standbyPairs = new Set<string>();
  const standbyRates = new Map<string, string>();
  for (const line of input.costs.standby) {
    requireModel(record(line), 'costs.standby', 'La partida de espera es inválida.');
    const task = tasks.get(line.taskId);
    const requirement = task?.requirements.find(({ resourceId }) => resourceId === line.resourceId);
    const pair = JSON.stringify([line.taskId, line.resourceId]);
    const previousRate = standbyRates.get(line.resourceId);
    requireModel(task && !task.actual && requirement && !standbyPairs.has(pair) &&
      integer(line.mobilizedDay, earliestDay, MAX_HORIZON) && integer(line.quantity, 1, requirement.quantity) &&
      (previousRate === undefined || previousRate === line.rateCentsPerDay),
    'costs.standby', 'La partida de espera tiene una reserva, cantidad, ventana o tasa incompatible.');
    standbyPairs.add(pair);
    standbyRates.set(line.resourceId, line.rateCentsPerDay);
    maximumCost += validateCents(line.rateCentsPerDay, 'costs.standby.rateCentsPerDay') *
      BigInt(line.quantity) * BigInt(Math.max(0, input.horizon - Math.max(0, line.mobilizedDay)));
  }
  requireModel(maximumCost <= maxMoney, 'costs', 'El máximo del costo total excede la precisión segura.');
}
