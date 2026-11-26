import { createHash } from 'node:crypto';
import { FUTUROS_ENGINE_BUILD, FUTUROS_MODEL, FUTUROS_RNG, type EngineInput } from './types';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) =>
      left < right ? -1 : Number(left > right)));
  });
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function inputDigest(input: EngineInput): string {
  return sha256(canonicalJson({ input, model: FUTUROS_MODEL, engine: FUTUROS_ENGINE_BUILD, rng: FUTUROS_RNG }));
}
