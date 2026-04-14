import { MCPTool, ToolOutput, ParsedResults } from '../types.js';
import { ArtilleryWrapper } from '../lib/artillery.js';
import { buildCounterBreakdown } from '../lib/counter-breakdown.js';
import { ProjectConfig } from '../lib/config-loader.js';
import path from 'path';

export class ParseResultsTool implements MCPTool {
  readonly name = 'parse_results';
  readonly description = 'Parse and summarize Artillery JSON results file. Returns ALL counters/rates/summaries verbatim; optionally adds counterBreakdown when a project config with counterGroups is loaded.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      jsonPath: { type: 'string', description: 'Path to Artillery JSON results file' }
    },
    required: ['jsonPath']
  };

  constructor(private artillery: ArtilleryWrapper, private projectConfig: ProjectConfig) {}

  async call(request: any): Promise<ToolOutput<ParsedResults>> {
    try {
      const args = request.params?.arguments || request.params || {};
      const { jsonPath } = args;

      if (!path.isAbsolute(jsonPath)) {
        throw new Error('Path must be absolute');
      }

      const results = await this.artillery.parseResults(jsonPath);

      const aggregate = results.aggregate || {};
      const counters = aggregate.counters || {};
      const rates = aggregate.rates || {};
      const summaries = aggregate.summaries || {};

      const summary = {
        requestsTotal: counters['http.requests'] || 0,
        rpsAvg: rates['http.request_rate'] || 0,
        latencyMs: {
          p50: summaries['http.response_time']?.p50 || 0,
          p95: summaries['http.response_time']?.p95 || 0,
          p99: summaries['http.response_time']?.p99 || 0
        },
        errors: counters['http.errors'] || {}
      };

      const scenarios = results.scenarios || [];
      const scenarioBreakdown = scenarios.map((scenario: any) => ({
        name: scenario.name || 'Unknown',
        count: scenario.count || 0,
        successRate: scenario.successRate || 0,
        avgLatency: scenario.avgLatency || 0
      }));

      const metadata = {
        timestamp: results.timestamp || new Date().toISOString(),
        duration: results.duration || 'Unknown',
        totalRequests: summary.requestsTotal
      };

      const parsedResults: ParsedResults = {
        summary,
        scenarios: scenarioBreakdown,
        metadata,
        allCounters: counters,
        allRates: rates,
        allSummaries: summaries
      };

      // Opt-in: only include counterBreakdown when user configured it
      const breakdown = buildCounterBreakdown(counters, this.projectConfig.counterGroups);
      if (breakdown) parsedResults.counterBreakdown = breakdown;

      return {
        status: 'ok',
        tool: this.name,
        data: parsedResults
      };

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
