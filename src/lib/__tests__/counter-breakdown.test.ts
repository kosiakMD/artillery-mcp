import { describe, it, expect } from 'vitest';
import { buildCounterBreakdown } from '../counter-breakdown.js';
import { CounterGroupsConfig } from '../config-loader.js';

describe('buildCounterBreakdown', () => {
  it('returns null when no config is provided', () => {
    expect(buildCounterBreakdown({}, undefined)).toBeNull();
  });

  it('returns null when buckets array is empty', () => {
    const groups: CounterGroupsConfig = { buckets: [] };
    expect(buildCounterBreakdown({ 'foo.bar': 1 }, groups)).toBeNull();
  });

  it('groups counters matching regex into the corresponding bucket', () => {
    const groups: CounterGroupsConfig = {
      buckets: [
        { key: 'steps', match: '^shop\\.step\\.' },
        { key: 'flow', match: '^shop\\.flow\\.' },
        { key: 'other', default: true }
      ]
    };
    const result = buildCounterBreakdown(
      {
        'shop.step.add_item.happy': 90,
        'shop.step.add_item.fail': 2,
        'shop.flow.started': 100,
        'shop.other.weird': 5
      },
      groups
    );
    expect(result).toEqual({
      steps: { 'shop.step.add_item.happy': 90, 'shop.step.add_item.fail': 2 },
      flow: { 'shop.flow.started': 100 },
      other: { 'shop.other.weird': 5 }
    });
  });

  it('skips counters that do not start with prefix', () => {
    const groups: CounterGroupsConfig = {
      prefix: 'shop.',
      buckets: [
        { key: 'all', match: '^shop\\.' },
        { key: 'other', default: true }
      ]
    };
    const result = buildCounterBreakdown(
      {
        'shop.order.completed': 100,
        'http.requests': 1500,
        'vusers.created': 10
      },
      groups
    );
    expect(result).toEqual({ all: { 'shop.order.completed': 100 }, other: {} });
  });

  it('uses first-match-wins when multiple regexes overlap', () => {
    const groups: CounterGroupsConfig = {
      buckets: [
        { key: 'specific', match: '^shop\\.step\\.add_item\\.happy$' },
        { key: 'generic', match: '^shop\\.step\\.' }
      ]
    };
    const result = buildCounterBreakdown(
      { 'shop.step.add_item.happy': 90, 'shop.step.add_item.fail': 2 },
      groups
    );
    expect(result!.specific).toEqual({ 'shop.step.add_item.happy': 90 });
    expect(result!.generic).toEqual({ 'shop.step.add_item.fail': 2 });
  });

  it('initializes empty buckets so consumers always see configured keys', () => {
    const groups: CounterGroupsConfig = {
      buckets: [
        { key: 'steps', match: '^shop\\.step\\.' },
        { key: 'errors', match: '^shop\\.error\\.' },
        { key: 'other', default: true }
      ]
    };
    const result = buildCounterBreakdown({ 'shop.step.a.happy': 1 }, groups);
    expect(result).toEqual({ steps: { 'shop.step.a.happy': 1 }, errors: {}, other: {} });
  });

  it('coerces non-numeric values to 0 (Number() fallback)', () => {
    const groups: CounterGroupsConfig = {
      buckets: [{ key: 'all', match: '.*' }]
    };
    const result = buildCounterBreakdown(
      { 'x.y': NaN as unknown as number, 'x.z': 42 },
      groups
    );
    expect(result!.all['x.y']).toBe(0);
    expect(result!.all['x.z']).toBe(42);
  });

  it('throws on invalid regex pattern', () => {
    const groups: CounterGroupsConfig = {
      buckets: [{ key: 'bad', match: '[invalid' }]
    };
    expect(() => buildCounterBreakdown({ foo: 1 }, groups)).toThrow();
  });
});
