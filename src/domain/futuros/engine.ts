import { createHmac, createSecretKey, type KeyObject } from 'node:crypto';
import { requireModel } from './engine-error';
import { MAX_HORIZON, validateEngineInput } from './engine-validation';
import { prepareIntegerPert } from './pert';
import { FUTUROS_RNG, type EngineInput, type LogicalSchedule, type Pert, type Sample } from './types';

export { EngineValidationError, type EngineErrorCode } from './engine-error';

type Edge = { index: number; lagDays: number };
type Need = { resource: number; quantity: number };
type Graph = { incoming: Edge[][]; outgoing: Edge[][]; roots: number[]; order: number[]; remaining: Uint16Array };
type Timeline = { starts: Int32Array; finishes: Int32Array; slack: Int32Array; finishDay: number };
type Standby = { task: number; fromDay: number; quantity: number };
type StandbyGroup = { resource: number; rate: bigint; lines: Standby[] };
type Factor = { name: string; kind: 'gate' | 'duration'; index: number } | { name: string; kind: 'riskCost' };

const twoTo53 = 2 ** 53;
const compareIds = (left: string, right: string) => (left < right ? -1 : Number(left > right));

export function indexedUniform(key: KeyObject, sampleIndex: number, primitiveId: string, drawIndex = 0): number {
  // Arrays of strings and safe integers already serialize canonically under RFC 8785.
  const bytes = createHmac('sha256', key)
    .update(JSON.stringify([FUTUROS_RNG, sampleIndex, primitiveId, drawIndex]))
    .digest();
  const first53 = bytes.readUIntBE(0, 6) * 32 + (bytes[6]! >>> 3);
  return Math.min((first53 + 1) / twoTo53, 1 - 1 / twoTo53);
}

function buildGraph(input: EngineInput, taskIndices: Map<string, number>): Graph {
  const incoming: Edge[][] = input.tasks.map(() => []);
  const outgoing: Edge[][] = input.tasks.map(() => []);
  for (const edge of input.dependencies) {
    const predecessor = taskIndices.get(edge.predecessorId)!;
    const successor = taskIndices.get(edge.successorId)!;
    incoming[successor]!.push({ index: predecessor, lagDays: edge.lagDays });
    outgoing[predecessor]!.push({ index: successor, lagDays: edge.lagDays });
  }

  const remaining = Uint16Array.from(incoming, (edges) => edges.length);
  const roots = input.tasks.flatMap((_, index) => remaining[index] === 0 ? [index] : []);
  const order = roots.slice();
  const unprocessed = remaining.slice();
  for (let cursor = 0; cursor < order.length; cursor += 1) {
    for (const edge of outgoing[order[cursor]!]!) {
      unprocessed[edge.index] = unprocessed[edge.index]! - 1;
      if (!unprocessed[edge.index]) order.push(edge.index);
    }
  }
  requireModel(order.length === input.tasks.length, 'dependencies', 'El cronograma contiene un ciclo de dependencias.');
  return { incoming, outgoing, roots, order, remaining };
}

function earliestStart(input: EngineInput, graph: Graph, index: number, arrivals: Int32Array, finishes: Int32Array) {
  let day = Math.max(0, input.tasks[index]!.releaseDay, arrivals[index]!);
  for (const predecessor of graph.incoming[index]!) {
    day = Math.max(day, finishes[predecessor.index]! + predecessor.lagDays);
  }
  return day;
}

function logicalTimeline(input: EngineInput, graph: Graph, durations: Int32Array, arrivals: Int32Array): Timeline {
  const starts = new Int32Array(input.tasks.length);
  const finishes = new Int32Array(input.tasks.length);
  let finishDay = 0;
  for (const index of graph.order) {
    const actual = input.tasks[index]!.actual;
    const start = actual ? actual.startDay : earliestStart(input, graph, index, arrivals, finishes);
    const finish = actual ? actual.finishDay : start + durations[index]!;
    starts[index] = start;
    finishes[index] = finish;
    finishDay = Math.max(finishDay, finish);
  }

  const latest = new Int32Array(input.tasks.length);
  const slack = new Int32Array(input.tasks.length);
  for (let cursor = graph.order.length - 1; cursor >= 0; cursor -= 1) {
    const index = graph.order[cursor]!;
    const successors = graph.outgoing[index]!;
    let latestFinish = finishDay;
    for (const successor of successors) {
      latestFinish = Math.min(latestFinish, latest[successor.index]! - successor.lagDays);
    }
    const duration = finishes[index]! - starts[index]!;
    latest[index] = latestFinish - duration;
    slack[index] = latest[index]! - starts[index]!;
  }
  return { starts, finishes, slack, finishDay };
}

function findCapacity(
  requirements: Need[], capacity: Uint16Array[], occupied: Array<Uint16Array | undefined>,
  start: number, duration: number, horizon: number,
): number | null {
  for (let day = start; day + duration <= horizon;) {
    let beyondConflict = day;
    for (const { resource, quantity } of requirements) {
      const reserved = occupied[resource];
      for (let slot = day; slot < day + duration; slot += 1) {
        if (capacity[resource]![slot]! - (reserved ? reserved[slot]! : 0) < quantity) {
          beyondConflict = Math.max(beyondConflict, slot + 1);
          break;
        }
      }
    }
    if (beyondConflict === day) return day;
    day = beyondConflict;
  }
  return null;
}

function recordStandby(
  groups: StandbyGroup[], starts: Int32Array, finishDay: number, occupied: Array<Uint16Array | undefined>,
) {
  let cost = 0n;
  for (const { resource, rate, lines } of groups) {
    // Lines for one resource share a rate. Overlapping premises represent the same capacity.
    // Charge the highest contracted quantity at each day instead of summing duplicate charges.
    const billed = new Uint16Array(finishDay);
    for (const { task, fromDay, quantity } of lines) {
      for (let day = fromDay; day < starts[task]!; day += 1) {
        billed[day] = Math.max(billed[day]!, quantity);
      }
    }
    const usage = occupied[resource];
    let unitDays = 0;
    for (let day = 0; day < billed.length; day += 1) {
      unitDays += Math.max(0, billed[day]! - (usage ? usage[day]! : 0));
    }
    cost += rate * BigInt(unitDays);
  }
  return cost;
}

function scheduleResources(
  input: EngineInput, graph: Graph, needs: Need[][], capacity: Uint16Array[], logical: Timeline,
  durations: Int32Array, arrivals: Int32Array, mobilized: Array<number | undefined>,
) {
  const occupied: Array<Uint16Array | undefined> = [];
  const starts = new Int32Array(input.tasks.length);
  const finishes = new Int32Array(input.tasks.length);
  const censored = new Uint8Array(input.tasks.length);
  const remaining = graph.remaining.slice();
  const ready: number[] = [];
  let finishDay = 0;
  let incomplete = false;
  let waits = 0;
  let usedAssets = 0;
  let weightedProductivity = 0;
  let workDuration = 0;

  const compare = (left: number, right: number) => logical.starts[left]! - logical.starts[right]!
    || input.tasks[right]!.priority - input.tasks[left]!.priority
    || compareIds(input.tasks[left]!.id, input.tasks[right]!.id);
  function queue(index: number) {
    // Keep the next eligible task at the array tail so removal is constant time.
    let low = 0;
    let high = ready.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(index, ready[middle]!) < 0) low = middle + 1;
      else high = middle;
    }
    ready.splice(low, 0, index);
  }
  for (const root of graph.roots) queue(root);

  while (ready.length) {
    const index = ready.pop()!;
    const task = input.tasks[index]!;
    const duration = durations[index]!;
    if (task.actual) {
      starts[index] = task.actual.startDay;
      finishes[index] = task.actual.finishDay;
    } else if (graph.incoming[index]!.some((edge) => censored[edge.index] === 1)) {
      censored[index] = 1;
      incomplete = true;
    } else {
      const earliest = earliestStart(input, graph, index, arrivals, finishes);
      const start = findCapacity(needs[index]!, capacity, occupied, earliest, duration, input.horizon);
      if (start === null) {
        censored[index] = 1;
        incomplete = true;
      } else {
        const finish = start + duration;
        starts[index] = start;
        finishes[index] = finish;
        finishDay = Math.max(finishDay, finish);
        // Contractual mobilisation defines waiting for priced activities. Otherwise
        // count the resource-imposed delay after their dependencies are ready.
        waits += Math.max(0, start - (mobilized[index] ?? earliest));
        weightedProductivity += duration * (task.productivity ?? 1);
        workDuration += duration;
        for (const { resource, quantity } of needs[index]!) {
          const usage = occupied[resource] ??= new Uint16Array(input.horizon);
          for (let day = start; day < finish; day += 1) {
            usage[day] = usage[day]! + quantity;
          }
          if (input.resources[resource]!.kind === 'ASSET') usedAssets += duration * quantity;
        }
      }
    }

    for (const successor of graph.outgoing[index]!) {
      remaining[successor.index] = remaining[successor.index]! - 1;
      if (!remaining[successor.index]) queue(successor.index);
    }
  }
  return {
    starts, finishes, finishDay, censored, incomplete, waits, usedAssets, occupied,
    productivity: workDuration ? weightedProductivity / workDuration : null,
  };
}

export function prepareEngine(input: EngineInput): {
  logical: LogicalSchedule;
  sample(index: number, modal?: boolean): Sample;
  factorNames: string[];
  milestoneIds: string[];
} {
  validateEngineInput(input);
  // Keep the prepared workload isolated from subsequent mutations of the caller's DTO.
  const model = structuredClone(input);
  const taskIndices = new Map(model.tasks.map(({ id }, index) => [id, index]));
  const resourceIndices = new Map(model.resources.map(({ id }, index) => [id, index]));
  const graph = buildGraph(model, taskIndices);
  const key = createSecretKey(Buffer.from(model.seed, 'hex'));

  const capacity = model.resources.map((resource) => {
    const slots = new Uint16Array(MAX_HORIZON + 1);
    for (const window of resource.windows) {
      slots.fill(window.capacity, Math.max(0, window.fromDay), Math.max(0, window.untilDay));
    }
    return slots;
  });
  const assetAvailability = new Uint32Array(model.horizon + 1);
  for (const [index, resource] of model.resources.entries()) {
    if (resource.kind !== 'ASSET') continue;
    for (let day = 0; day < model.horizon; day += 1) {
      assetAvailability[day + 1] = assetAvailability[day + 1]! + capacity[index]![day]!;
    }
  }
  for (let day = 1; day <= model.horizon; day += 1) {
    assetAvailability[day] = assetAvailability[day]! + assetAvailability[day - 1]!;
  }

  const distributions = new Map<string, ReturnType<typeof prepareIntegerPert>>();
  function distribution(range: Pert, productivity = 1) {
    const signature = JSON.stringify([range, productivity]);
    let prepared = distributions.get(signature);
    if (!prepared) {
      prepared = prepareIntegerPert(range, productivity);
      distributions.set(signature, prepared);
    }
    return prepared;
  }

  const gates = model.gates.slice().sort((left, right) => compareIds(left.id, right.id)).map((gate) => ({
    ...gate,
    task: taskIndices.get(gate.taskId)!,
    distribution: distribution(gate.delivery),
  }));
  const gateIndex = new Map(gates.map(({ id }, index) => [id, index]));
  const gateTasks = new Set(gates.map(({ task }) => task));
  const taskDistributions = model.tasks.map((task, index) => task.actual || gateTasks.has(index)
    ? undefined : distribution(task.duration, task.productivity));
  const needs = model.tasks.map(({ requirements }) => requirements.map(({ resourceId, quantity }) => ({
    resource: resourceIndices.get(resourceId)!, quantity,
  })));
  for (const [index, required] of needs.entries()) {
    const minimum = taskDistributions[index]?.minimum;
    if (!required.length || minimum === undefined) continue;
    requireModel(findCapacity(required, capacity, [], Math.max(0, model.tasks[index]!.releaseDay), minimum, MAX_HORIZON + 1) !== null,
      `task:${model.tasks[index]!.id}`, 'Ninguna ventana permite la demanda de recursos de la tarea.', 'RESOURCE_INFEASIBLE');
  }

  const risks = model.risks.map((risk) => ({
    ...risk,
    gate: risk.gateId === undefined ? undefined : gateIndex.get(risk.gateId)!,
    cost: BigInt(risk.costCents),
  }));
  const alternativeCommitments = gates.reduce((total, gate) =>
    total + BigInt(gate.alternative?.commitmentCents ?? '0'), 0n);
  const baseCost = BigInt(model.costs.actualCents) + BigInt(model.costs.remainingCents) + alternativeCommitments;
  const indirectRate = BigInt(model.costs.indirectCentsPerDay);
  const mobilized: Array<number | undefined> = [];
  const rateGroups = new Map<string, StandbyGroup>();
  for (const line of model.costs.standby) {
    const task = taskIndices.get(line.taskId)!;
    const fromDay = Math.max(0, line.mobilizedDay);
    mobilized[task] = Math.min(mobilized[task] ?? Infinity, fromDay);
    const group = rateGroups.get(line.resourceId) ?? {
      resource: resourceIndices.get(line.resourceId)!, rate: BigInt(line.rateCentsPerDay), lines: [],
    };
    group.lines.push({ task, fromDay, quantity: line.quantity });
    rateGroups.set(line.resourceId, group);
  }
  const standby = [...rateGroups.values()];

  const pendingTasks = model.tasks.flatMap((task, index) => taskDistributions[index] ? [{ task, index }] : [])
    .sort((left, right) => right.task.priority - left.task.priority || compareIds(left.task.id, right.task.id));
  const factors: Factor[] = [
    ...gates.map((gate): Factor => ({ name: `gate:${gate.id}:eta`, kind: 'gate', index: gate.task })),
    { name: 'operational-risk:cost', kind: 'riskCost' as const },
    ...pendingTasks.map(({ task, index }): Factor => ({ name: `task:${task.code}:duration`, kind: 'duration', index })),
  ].slice(0, 10);
  const milestones = model.tasks.flatMap((task, index) => task.milestone && !task.actual ? [{ id: task.id, code: task.code, index }] : [])
    .sort((left, right) => compareIds(left.code, right.code) || compareIds(left.id, right.id)).slice(0, 5);

  function sampleInputs(index: number, modal: boolean) {
    const durations = new Int32Array(model.tasks.length);
    const arrivals = new Int32Array(model.tasks.length);
    const riskDelays = new Int32Array(gates.length);
    let riskCost = 0n;
    for (const risk of risks) {
      const occurs = modal ? risk.probability > 0.5
        : risk.probability === 1 || (risk.probability > 0 && indexedUniform(key, index, `risk:${risk.id}`) < risk.probability);
      if (!occurs) continue;
      riskCost += risk.cost;
      if (risk.gate !== undefined) riskDelays[risk.gate] = riskDelays[risk.gate]! + risk.delayDays;
    }
    for (const [gateIndex, gate] of gates.entries()) {
      const dist = gate.distribution;
      const baseline = modal || dist.constant ? dist.modal : dist.draw(indexedUniform(key, index, `gate:${gate.id}:delivery`));
      const primary = baseline + gate.delayDays + riskDelays[gateIndex]!;
      arrivals[gate.task] = gate.alternative ? Math.min(primary, baseline + gate.alternative.offsetDays) : primary;
    }
    for (const [taskIndex, prepared] of taskDistributions.entries()) {
      if (!prepared) continue;
      durations[taskIndex] = modal || prepared.constant ? prepared.modal
        : prepared.draw(indexedUniform(key, index, `task:${model.tasks[taskIndex]!.id}:duration`));
    }
    return { durations, arrivals, riskCost };
  }

  const modal = sampleInputs(0, true);
  const timeline = logicalTimeline(model, graph, modal.durations, modal.arrivals);

  function sample(index: number, modal = false): Sample {
    requireModel(Number.isSafeInteger(index) && index >= 0 && index < model.sampleCount, 'index', 'La muestra está fuera de la corrida.');
    const { durations, arrivals, riskCost } = sampleInputs(index, modal);
    const logical = logicalTimeline(model, graph, durations, arrivals);
    const schedule = scheduleResources(model, graph, needs, capacity, logical, durations, arrivals, mobilized);
    const finishDay = schedule.incomplete ? null : schedule.finishDay;
    const costCents = finishDay === null ? null : Number(baseCost + riskCost
      + indirectRate * BigInt(finishDay) + recordStandby(standby, schedule.starts, finishDay, schedule.occupied));
    const availableDays = finishDay === null ? 0 : assetAvailability[finishDay]!;

    return {
      index, finishDay, costCents,
      milestoneDays: milestones.map(({ index }) => schedule.censored[index] ? null : schedule.finishes[index]!),
      waits: schedule.waits,
      utilization: availableDays ? schedule.usedAssets / availableDays : null,
      productivity: schedule.incomplete ? null : schedule.productivity,
      factors: factors.map((factor) => factor.kind === 'gate' ? arrivals[factor.index]!
        : factor.kind === 'duration' ? durations[factor.index]! : Number(riskCost)),
      critical: model.tasks.flatMap((task, index) => !task.actual && logical.slack[index] === 0 ? [index] : []),
    };
  }

  return {
    sample,
    logical: {
      finishDay: timeline.finishDay,
      tasks: model.tasks.map((task, index) => ({
        id: task.id, startDay: timeline.starts[index]!, finishDay: timeline.finishes[index]!, slackDays: timeline.slack[index]!,
      })),
    },
    factorNames: factors.map(({ name }) => name),
    milestoneIds: milestones.map(({ id }) => id),
  };
}
