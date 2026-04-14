import { describe, it, expect } from 'vitest';
import { parseArtilleryText, extractSummaryBlock, parseTextBlock } from '../text-output-parser.js';

const SAMPLE = `Phase started: "Warmup" (index: 0, duration: 30s)

--------------------------------------
Metrics for period to: 15:00:00(+0300) (width: 58.0s)
--------------------------------------

http.codes.200: ................ 780
http.request_rate: ............. 13/sec
http.requests: ................. 780

--------------------------------
Summary report @ 15:01:00(+0300)
--------------------------------

http.codes.200: ................ 1450
http.codes.500: ................ 50
http.request_rate: ............. 25/sec
http.requests: ................. 1500
http.response_time:
  min: ......................... 45
  max: ......................... 3200
  mean: ........................ 220
  median: ...................... 180
  p95: ......................... 850
  p99: ......................... 1800
vusers.created: ................ 100
vusers.failed: ................. 5
checkout.step.add_ticket.happy: 90
checkout.step.add_ticket.fail: . 2
`;

describe('extractSummaryBlock', () => {
  it('returns null when no Summary report present', () => {
    expect(extractSummaryBlock('hello\nworld')).toBeNull();
  });

  it('extracts from the LAST Summary report occurrence', () => {
    const text = 'Summary report @ 10:00\nhttp.requests: 100\nSummary report @ 11:00\nhttp.requests: 200\n';
    const block = extractSummaryBlock(text);
    expect(block).not.toBeNull();
    expect(block).toContain('@ 11:00');
    expect(block).toContain('http.requests: 200');
    expect(block).not.toContain('@ 10:00');
  });

  it('includes the leading ------- separator line', () => {
    const block = extractSummaryBlock(SAMPLE);
    expect(block).not.toBeNull();
    expect(block!.split('\n')[0]).toMatch(/^-{4,}$/);
  });
});

describe('parseTextBlock', () => {
  it('parses top-level counters and rates', () => {
    const { counters, rates } = parseTextBlock('http.requests: 1500\nhttp.request_rate: 25/sec\n');
    expect(counters['http.requests']).toBe(1500);
    expect(rates['http.request_rate']).toBe(25);
    // rates should NOT also appear in counters
    expect(counters['http.request_rate']).toBeUndefined();
  });

  it('parses nested metric blocks (http.response_time: min/max/p95/p99)', () => {
    const text = `http.response_time:\n  min: 45\n  p95: 850\n  p99: 1800\n`;
    const { metrics } = parseTextBlock(text);
    expect(metrics['http.response_time']).toEqual({ min: 45, p95: 850, p99: 1800 });
  });

  it('closes nested context when encountering non-indented line', () => {
    const text = `http.response_time:\n  min: 45\nhttp.requests: 100\n  this_should_not_be_p95: 999\n`;
    const { metrics, counters } = parseTextBlock(text);
    expect(metrics['http.response_time']).toEqual({ min: 45 });
    expect(counters['http.requests']).toBe(100);
    // The indented line after non-indented should not pollute any metric
    expect(Object.keys(metrics)).toEqual(['http.response_time']);
  });

  it('strips ANSI color codes', () => {
    const text = `\u001b[32mhttp.requests\u001b[0m: 500\n`;
    const { counters } = parseTextBlock(text);
    expect(counters['http.requests']).toBe(500);
  });

  it('handles decimal rates', () => {
    const { rates } = parseTextBlock('http.request_rate: 25.5/sec\n');
    expect(rates['http.request_rate']).toBe(25.5);
  });
});

describe('parseArtilleryText end-to-end', () => {
  it('defaults to parsing only the summary block, not phase metrics', () => {
    const r = parseArtilleryText(SAMPLE);
    // Summary has http.requests=1500; phase metrics had 780 — must prefer summary
    expect(r.counters['http.requests']).toBe(1500);
    expect(r.metrics['http.response_time'].p99).toBe(1800);
    expect(r.summaryBlock).not.toBeNull();
  });

  it('parses full file when block=full', () => {
    const r = parseArtilleryText(SAMPLE, { block: 'full' });
    // Full parse: last http.requests entry wins → 1500 (summary block is last)
    expect(r.counters['http.requests']).toBe(1500);
  });

  it('truncates rawText from tail when over maxBytes but parses from full', () => {
    const long = 'X'.repeat(1000) + '\n' + SAMPLE;
    const r = parseArtilleryText(long, { maxBytes: 500 });
    expect(r.truncated).toBe(true);
    expect(r.totalBytes).toBeGreaterThan(500);
    expect(r.rawText.length).toBeLessThanOrEqual(500);
    // Counters still extracted from the full text
    expect(r.counters['http.requests']).toBe(1500);
  });

  it('extracts checkout counters from summary', () => {
    const r = parseArtilleryText(SAMPLE);
    expect(r.counters['checkout.step.add_ticket.happy']).toBe(90);
    expect(r.counters['checkout.step.add_ticket.fail']).toBe(2);
  });
});
