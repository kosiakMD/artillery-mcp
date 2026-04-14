/**
 * Parses Artillery stdout text dumps (e.g. artillery-output.txt saved from CI)
 * into a structured form.
 *
 * Artillery 2.x produces summary blocks like:
 *
 *   --------------------------------
 *   Summary report @ 15:31:00(+0300)
 *   --------------------------------
 *
 *   http.codes.200: ....... 1500
 *   http.request_rate: .... 25/sec
 *   http.requests: ........ 1500
 *   http.response_time:
 *     min: ................ 45
 *     max: ................ 3200
 *     mean: ............... 220
 *     median: ............. 180
 *     p95: ................ 850
 *     p99: ................ 1800
 *   checkout.step.add_ticket.happy: ....... 90
 *
 * We extract:
 *   - rawText (possibly trimmed to tail)
 *   - summaryBlock (text of the LAST "Summary report" section)
 *   - counters (flat key → number)
 *   - metrics (key → { min, max, mean, median, p50, p95, p99, ... })
 */

export interface TextOutputParseResult {
  /** Raw text (possibly truncated from head if maxBytes applied) */
  rawText: string;
  /** Was the raw text truncated from head */
  truncated: boolean;
  /** Total bytes of the source file */
  totalBytes: number;
  /** Text of the LAST "Summary report" section, if present */
  summaryBlock: string | null;
  /** Flat counters / rate-like metrics (http.requests, checkout.step.foo.happy, …) */
  counters: Record<string, number>;
  /** Rate metrics (e.g. http.request_rate: 25/sec) — value stored as number */
  rates: Record<string, number>;
  /** Nested percentile/latency metrics (http.response_time, vusers.session_length, …) */
  metrics: Record<string, Record<string, number>>;
}

const LINE_SEP = /\r?\n/;

/** Parse a numeric string like "1500", "25.5", "1,500" (locale), or "25/sec". Returns null if not numeric. */
function parseNumeric(raw: string): { value: number; isRate: boolean } | null {
  const trimmed = raw.trim().replace(/,/g, '');
  const rateMatch = trimmed.match(/^([-+]?\d+(?:\.\d+)?)\s*\/\s*sec$/i);
  if (rateMatch) return { value: Number(rateMatch[1]), isRate: true };
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) return { value: Number(trimmed), isRate: false };
  return null;
}

/**
 * Extract the LAST "Summary report" block (bounded by the "--------" lines).
 * Returns null if no summary block found.
 */
export function extractSummaryBlock(text: string): string | null {
  const lines = text.split(LINE_SEP);
  let lastStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^Summary report/i.test(lines[i])) lastStart = i;
  }
  if (lastStart === -1) return null;
  // Start from the "-------" line above, if any
  let start = lastStart;
  if (start > 0 && /^-{4,}\s*$/.test(lines[start - 1])) start -= 1;
  // End at EOF
  return lines.slice(start).join('\n');
}

/**
 * Parses a block of Artillery text output (summary or full).
 * Returns counters, rates, and nested metrics.
 */
export function parseTextBlock(block: string): {
  counters: Record<string, number>;
  rates: Record<string, number>;
  metrics: Record<string, Record<string, number>>;
} {
  const counters: Record<string, number> = {};
  const rates: Record<string, number> = {};
  const metrics: Record<string, Record<string, number>> = {};

  const lines = block.split(LINE_SEP);
  let currentMetricKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, ''); // strip ANSI colors

    // Match "  subkey: .... value" (indented sub-metric under currentMetricKey)
    const subMatch = line.match(/^\s{2,}([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*:\s*\.*\s*(.+?)\s*$/);
    // Match "key.path: .... value" (top-level key: value) — must NOT be indented
    const topMatch = line.match(/^([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*:\s*(.*)$/);

    if (currentMetricKey && /^\s{2,}/.test(line) && subMatch) {
      const [, subKey, valueRaw] = subMatch;
      const parsed = parseNumeric(valueRaw);
      if (parsed) {
        if (!metrics[currentMetricKey]) metrics[currentMetricKey] = {};
        metrics[currentMetricKey][subKey] = parsed.value;
      }
      continue;
    }

    // Reset nested context when we hit a non-indented line
    if (!/^\s{2,}/.test(line)) currentMetricKey = null;

    if (topMatch && !/^\s{2,}/.test(line)) {
      const [, key, valueRaw] = topMatch;
      const trimmedValue = valueRaw.trim().replace(/^\.+\s*/, '');
      if (trimmedValue === '') {
        // "key:" with empty value → start of nested metric block (e.g. http.response_time:)
        currentMetricKey = key;
        continue;
      }
      const parsed = parseNumeric(trimmedValue);
      if (parsed) {
        if (parsed.isRate) rates[key] = parsed.value;
        else counters[key] = parsed.value;
      }
    }
  }

  return { counters, rates, metrics };
}

/**
 * Full parser — applies tail-truncation, extracts summary block, parses metrics.
 */
export function parseArtilleryText(
  fullText: string,
  options: { maxBytes?: number; block?: 'summary' | 'full' } = {}
): TextOutputParseResult {
  const totalBytes = Buffer.byteLength(fullText, 'utf-8');
  const { maxBytes, block = 'summary' } = options;

  let rawText = fullText;
  let truncated = false;
  if (maxBytes && totalBytes > maxBytes) {
    rawText = fullText.slice(-maxBytes);
    truncated = true;
  }

  const summaryBlock = extractSummaryBlock(fullText);
  const parseSource =
    block === 'full' ? fullText : (summaryBlock ?? fullText);
  const { counters, rates, metrics } = parseTextBlock(parseSource);

  return { rawText, truncated, totalBytes, summaryBlock, counters, rates, metrics };
}
