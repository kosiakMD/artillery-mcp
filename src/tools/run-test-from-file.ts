import { MCPTool, ToolOutput, ArtilleryResult } from '../types.js';
import { ArtilleryWrapper } from '../lib/artillery.js';

export class RunTestFromFileTool implements MCPTool {
  readonly name = 'run_test_from_file';
  readonly description =
    'Run an Artillery test from a config file path. Supports full `artillery run` flag surface including --record/--key (Artillery Cloud), --tags, --name, --note, -t/--target, -e/--environment, --scenario-name, -v/--variables, --overrides, -p/--payload, --dotenv, -k/--insecure, --count, --solo.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to Artillery config' },
      outputJson: { type: 'string', description: 'Path to write JSON results (enables summary parsing and HTML report generation)' },
      reportHtml: { type: 'string', description: 'Path to write HTML report (requires outputJson; runs `artillery report` after the test)' },
      env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra env vars passed to the Artillery subprocess' },
      cwd: { type: 'string', description: 'Working directory for the run' },
      validateOnly: { type: 'boolean', default: false, description: '--dry-run (validate config only)' },
      // Cloud recording
      record: { type: 'boolean', description: 'Pass --record to stream results to Artillery Cloud. Uses ARTILLERY_CLOUD_API_KEY from env for --key.' },
      name: { type: 'string', description: 'Run name shown in Artillery Cloud dashboard (--name)' },
      note: { type: 'string', description: 'Annotation for the run (--note)' },
      tags: { type: 'string', description: 'Comma-separated key:value tags, e.g. "repo:my-app,type:baseline,owner:Platform"' },
      // Overrides
      target: { type: 'string', description: 'Override target URL (-t / --target)' },
      environment: { type: 'string', description: 'Pick environment from config.environments (-e)' },
      scenarioName: { type: 'string', description: 'Run a specific scenario (--scenario-name)' },
      variables: { description: 'JSON object or string of vars (-v)' },
      overrides: { description: 'JSON object or string of dynamic overrides (--overrides)' },
      payload: { type: 'string', description: 'CSV payload file path (-p / --payload)' },
      dotenv: { type: 'string', description: 'Path to dotenv file (--dotenv)' },
      insecure: { type: 'boolean', description: 'Allow insecure TLS connections (-k)' },
      count: { type: 'number', description: '--count: number of instances' },
      solo: { type: 'boolean', description: '-s / --solo: single VU' },
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Raw extra CLI args appended last (escape hatch)' }
    },
    required: ['path']
  };

  constructor(private artillery: ArtilleryWrapper) {}

  async call(request: any): Promise<ToolOutput<ArtilleryResult>> {
    try {
      const args = request.params?.arguments || request.params || {};

      if (args.validateOnly) {
        const result = await this.artillery.runTestFromFile(args.path, {
          cwd: args.cwd,
          env: args.env,
          validateOnly: true
        });
        return { status: 'ok', tool: this.name, data: result };
      }

      const result = await this.artillery.runTestFromFile(args.path, {
        outputJson: args.outputJson,
        reportHtml: args.reportHtml,
        env: args.env,
        cwd: args.cwd,
        record: args.record,
        name: args.name,
        note: args.note,
        tags: args.tags,
        target: args.target,
        environment: args.environment,
        scenarioName: args.scenarioName,
        variables: args.variables,
        overrides: args.overrides,
        payload: args.payload,
        dotenv: args.dotenv,
        insecure: args.insecure,
        count: args.count,
        solo: args.solo,
        extraArgs: args.extraArgs
      });

      return { status: 'ok', tool: this.name, data: result };
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
