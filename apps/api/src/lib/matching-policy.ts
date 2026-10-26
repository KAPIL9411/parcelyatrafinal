import { matchingPolicy, type MatchingPolicy } from '@py/domain';

import { config, type Config } from '../config.ts';

const WEIGHT_KEYS = ['time', 'departure', 'detour', 'reliability', 'capacity', 'preference'] as const;

/**
 * `MATCH_WEIGHTS` is a plain `key=value` list rather than JSON: it is meant to be typed into a
 * hosting dashboard, where an unquoted brace is a daily invitation to break the build.
 * Anything malformed fails at boot, in the same way the rest of the configuration does.
 */
export function parseMatchWeights(raw: string): MatchingPolicy['weights'] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const out: Record<string, number> = {};
  for (const part of trimmed.split(',')) {
    const [key, value] = part.split('=').map((s) => s?.trim());
    if (!key || value === undefined || !(WEIGHT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`MATCH_WEIGHTS: "${part}" is not one of ${WEIGHT_KEYS.join(', ')}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`MATCH_WEIGHTS: ${key}=${value} is not a non-negative number`);
    out[key] = n;
  }
  return out as MatchingPolicy['weights'];
}

export function matchPolicyFor(c: Config): MatchingPolicy {
  const weights = parseMatchWeights(c.MATCH_WEIGHTS);
  return matchingPolicy({
    maxOriginDetourKm: c.MATCH_MAX_ORIGIN_DETOUR_KM,
    arrivalGraceHours: c.MATCH_ARRIVAL_GRACE_HOURS,
    minScoreToShow: c.MATCH_MIN_SCORE,
    maxResults: c.MATCH_MAX_RESULTS,
    ...(weights ? { weights } : {}),
  });
}

export const matchPolicy = matchPolicyFor(config);
