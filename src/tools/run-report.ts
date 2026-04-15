import { MCPTool, ToolOutput } from '../types.js';
import { ArtilleryWrapper } from '../lib/artillery.js';
import { promises as fs } from 'fs';
import path from 'path';

export interface RunReportInput {
  jsonPath: string;
  outputHtml?: string;
}

export interface RunReportResult {
  htmlPath: string;
  jsonPath: string;
  sizeBytes: number;
}

/**
 * Wraps `artillery report <json>` — converts an existing Artillery JSON results
 * file into an HTML report without re-running the test. Complements
 * run_test_from_file which can generate HTML inline but only when outputJson
 * was specified.
 *
 * Common use case: JSON report from a CI Fargate run is in your artifacts
 * bundle; you want the HTML locally for sharing, without re-running the LT.
 */
export class RunReportTool implements MCPTool {
  readonly name = 'run_report';
  readonly description =
    'Convert an existing Artillery JSON results file to an HTML report via `artillery report`. Use when you have a JSON (e.g. from CI artifacts) and want the shareable HTML without re-running the test.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      jsonPath: {
        type: 'string',
        description: 'Absolute path to the Artillery JSON results file (from --output of a prior run)'
      },
      outputHtml: {
        type: 'string',
        description: 'Absolute path for the generated HTML. Defaults to <jsonPath>.html'
      }
    },
    required: ['jsonPath']
  };

  constructor(private artillery: ArtilleryWrapper) {}

  async call(request: any): Promise<ToolOutput<RunReportResult>> {
    try {
      const args = request.params?.arguments || request.params || {};
      const jsonPath: string = args.jsonPath;
      if (!jsonPath || typeof jsonPath !== 'string') throw new Error('jsonPath is required');
      if (!path.isAbsolute(jsonPath)) throw new Error('jsonPath must be absolute');

      // Fail fast with a clear message rather than letting artillery CLI show a cryptic error.
      try {
        await fs.access(jsonPath);
      } catch {
        throw new Error(`JSON results file not found: ${jsonPath}`);
      }

      const outputHtml = args.outputHtml || `${jsonPath}.html`;
      if (!path.isAbsolute(outputHtml)) throw new Error('outputHtml must be absolute');

      await this.artillery.runReport(jsonPath, outputHtml);

      const stat = await fs.stat(outputHtml);
      return {
        status: 'ok',
        tool: this.name,
        data: { htmlPath: outputHtml, jsonPath, sizeBytes: stat.size }
      };
    } catch (error) {
      return {
        status: 'error',
        tool: this.name,
        error: {
          code: 'EXECUTION_ERROR',
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
