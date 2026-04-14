import { MCPTool, ToolOutput } from '../types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { parseArtilleryText, TextOutputParseResult } from '../lib/text-output-parser.js';
import { buildCounterBreakdown, CounterBreakdown } from '../lib/counter-breakdown.js';
import { ProjectConfig } from '../lib/config-loader.js';

export interface ReadArtilleryOutputResult extends TextOutputParseResult {
  /** Config-driven counter grouping. Only present when project config has counterGroups. */
  counterBreakdown?: CounterBreakdown;
  /** Source file path (absolute) */
  path: string;
}

export class ReadArtilleryOutputTool implements MCPTool {
  readonly name = 'read_artillery_output';
  readonly description =
    'Read an Artillery stdout text dump (e.g. artillery-output.txt from CI) and extract the summary block, counters, rates, nested latency metrics — without requiring a JSON report. Optionally adds counterBreakdown when a project config with counterGroups is loaded.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the text output file' },
      maxBytes: {
        type: 'number',
        description: 'If the file exceeds this many bytes, rawText is truncated to the tail (counters/metrics still parsed from the full file). Default: 65536.',
        default: 65536
      },
      block: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'Parse metrics from "summary" (last Summary report section) or "full" file. Default: summary.',
        default: 'summary'
      }
    },
    required: ['path']
  };

  constructor(private projectConfig: ProjectConfig) {}

  async call(request: any): Promise<ToolOutput<ReadArtilleryOutputResult>> {
    try {
      const args = request.params?.arguments || request.params || {};
      const filePath: string = args.path;
      const maxBytes: number = typeof args.maxBytes === 'number' ? args.maxBytes : 65536;
      const block: 'summary' | 'full' = args.block === 'full' ? 'full' : 'summary';

      if (!filePath || typeof filePath !== 'string') {
        throw new Error('path is required');
      }
      if (!path.isAbsolute(filePath)) {
        throw new Error('path must be absolute');
      }

      const fullText = await fs.readFile(filePath, 'utf-8');
      const parsed = parseArtilleryText(fullText, { maxBytes, block });

      const result: ReadArtilleryOutputResult = { ...parsed, path: filePath };
      const breakdown = buildCounterBreakdown(parsed.counters, this.projectConfig.counterGroups);
      if (breakdown) result.counterBreakdown = breakdown;

      return { status: 'ok', tool: this.name, data: result };
    } catch (error) {
      return {
        status: 'error',
        tool: this.name,
        error: {
          code: 'PARSE_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          details: {
            tool: this.name,
            arguments: request.params?.arguments || request.params
          }
        }
      };
    }
  }
}
