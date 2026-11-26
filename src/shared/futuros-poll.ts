export const futurosPollIntervalMs = 5_000;
const maxBackoffMs = 30_000;
const maxTimerMs = 2_147_483_647;

export function futurosPollWait(currentMs: number, retryRemainingMs: number, transientFailure: boolean, jitterMs = 0) {
  const nextMs = transientFailure ? Math.min(currentMs * 2, maxBackoffMs) : futurosPollIntervalMs;
  const timeoutMs = Math.min(maxTimerMs, Math.max(nextMs, retryRemainingMs) + (transientFailure ? jitterMs : 0));
  return { nextMs, timeoutMs };
}
