import { CounterGroupsConfig } from './config-loader.js';

/**
 * Generic, config-driven counter grouping.
 *
 * Given a flat map of counters (e.g. Artillery aggregate.counters or
 * counters parsed from a text output dump), applies a set of bucket rules
 * from the user's config and returns an object keyed by bucket name.
 *
 * Example config:
 *   prefix: "checkout."
 *   buckets:
 *     - { key: "steps", match: "^checkout\\.step\\." }
 *     - { key: "flow",  match: "^checkout\\.flow\\." }
 *     - { key: "other", default: true }
 *
 * Example counters:
 *   { "checkout.step.add_ticket.happy": 90, "http.requests": 1500 }
 *
 * Result (counters with prefix go through bucketing, others are skipped):
 *   { steps: { "checkout.step.add_ticket.happy": 90 }, flow: {}, other: {} }
 *
 * Returns `null` if no rules are configured (caller should omit the field
 * from its response entirely).
 */
export type CounterBreakdown = Record<string, Record<string, number>>;

export function buildCounterBreakdown(
  counters: Record<string, number>,
  groups: CounterGroupsConfig | undefined
): CounterBreakdown | null {
  if (!groups || !groups.buckets || groups.buckets.length === 0) return null;

  // Pre-compile regex (throws on bad pattern — surface to caller).
  const compiled = groups.buckets.map((b) => ({
    key: b.key,
    regex: b.match ? new RegExp(b.match) : null,
    isDefault: !!b.default
  }));

  // Initialise all buckets empty so consumers always see the keys.
  const result: CounterBreakdown = {};
  for (const b of compiled) result[b.key] = {};

  const defaultBucket = compiled.find((b) => b.isDefault)?.key;
  const prefix = groups.prefix ?? '';

  for (const [counterName, rawValue] of Object.entries(counters)) {
    if (prefix && !counterName.startsWith(prefix)) continue;
    const value = Number(rawValue) || 0;

    let placed = false;
    for (const b of compiled) {
      if (b.regex && b.regex.test(counterName)) {
        result[b.key][counterName] = value;
        placed = true;
        break;
      }
    }
    if (!placed && defaultBucket) {
      result[defaultBucket][counterName] = value;
    }
  }

  return result;
}
