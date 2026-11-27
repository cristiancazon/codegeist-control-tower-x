export const FUTUROS_MODEL = 'cpm-pert-v1';
export const FUTUROS_ENGINE_BUILD = 'futuros-1.0.0';
export const FUTUROS_RNG = 'hmac-sha256-v1';
export const FUTUROS_BATCH_SIZE = 100;

export type Pert = readonly [min: number, mode: number, max: number];
export type Task = {
  id: string;
  code: string;
  duration: Pert;
  releaseDay: number;
  priority: number;
  milestone: boolean;
  actual?: { startDay: number; finishDay: number };
  requirements: Array<{ resourceId: string; quantity: number }>;
  productivity?: number;
};
export type Resource = {
  id: string;
  kind: 'ASSET' | 'CREW';
  windows: Array<{ fromDay: number; untilDay: number; capacity: number }>;
};
export type SupplyGate = {
  id: string;
  taskId: string;
  delivery: Pert;
  delayDays: number;
  alternative?: { offsetDays: number; commitmentCents: string };
};
export type Risk = {
  id: string;
  probability: number;
  gateId?: string;
  delayDays: number;
  costCents: string;
};
export type EngineInput = {
  snapshotId: string;
  snapshotHash: string;
  scenarioId: string;
  scenarioHash: string;
  asOf: string;
  calendar: 'CONTINUOUS';
  currency: 'USD';
  seed: string;
  sampleCount: number;
  horizon: number;
  targetDay: number;
  budgetCents: string;
  tasks: Task[];
  dependencies: Array<{ predecessorId: string; successorId: string; lagDays: number }>;
  resources: Resource[];
  gates: SupplyGate[];
  risks: Risk[];
  costs: {
    actualCents: string;
    remainingCents: string;
    indirectCentsPerDay: string;
    standby: Array<{ taskId: string; resourceId: string; rateCentsPerDay: string; mobilizedDay: number; quantity: number }>;
  };
};
export type Sample = {
  index: number;
  finishDay: number | null;
  costCents: number | null;
  milestoneDays: Array<number | null>;
  waits: number;
  utilization: number | null;
  productivity: number | null;
  factors: number[];
  critical: number[];
};
export type LogicalSchedule = {
  finishDay: number;
  tasks: Array<{ id: string; startDay: number; finishDay: number; slackDays: number }>;
};
