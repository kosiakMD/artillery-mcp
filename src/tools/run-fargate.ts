import { MCPTool, ToolOutput, ArtilleryResult } from '../types.js';
import { ArtilleryWrapper } from '../lib/artillery.js';

export interface RunFargateOptions {
  path: string;
  region: string;
  count?: number;
  cluster?: string;
  cpu?: number | string;
  memory?: number | string;
  launchType?: 'ecs:fargate' | 'ecs:ec2';
  spot?: boolean;
  launchConfig?: string;
  subnetIds?: string;
  securityGroupIds?: string;
  taskRoleName?: string;
  taskEphemeralStorage?: number;
  containerDnsServers?: string;
  maxDuration?: string;
  packages?: string;
  secret?: string[];
  noAssignPublicIp?: boolean;
  // Shared with `run`
  target?: string;
  environment?: string;
  scenarioName?: string;
  variables?: string | Record<string, unknown>;
  overrides?: string | Record<string, unknown>;
  payload?: string;
  dotenv?: string;
  insecure?: boolean;
  record?: boolean;
  name?: string;
  note?: string;
  tags?: string;
  outputJson?: string;
  env?: Record<string, string>;
  cwd?: string;
  extraArgs?: string[];
}

export class RunFargateTool implements MCPTool {
  readonly name = 'run_fargate';
  readonly description =
    'Launch an Artillery load test on AWS ECS/Fargate (`artillery run-fargate`). Requires AWS credentials and a pre-configured artilleryio Fargate cluster in the target region.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to Artillery config' },
      region: { type: 'string', description: 'AWS region, e.g. us-east-1' },
      count: { type: 'number', description: 'Number of Fargate workers' },
      cluster: { type: 'string', description: 'ECS cluster name (defaults to artilleryio-cluster)' },
      cpu: { description: 'Task CPU (vCPU number or raw value, e.g. 4 / 4096)' },
      memory: { description: 'Task memory (GB 1-120 or MiB)' },
      launchType: { type: 'string', enum: ['ecs:fargate', 'ecs:ec2'] },
      spot: { type: 'boolean', description: 'Use Fargate Spot' },
      launchConfig: { type: 'string', description: 'JSON string for --launch-config (e.g. per-container env)' },
      subnetIds: { type: 'string', description: 'Comma-separated VPC subnet IDs' },
      securityGroupIds: { type: 'string', description: 'Comma-separated security group IDs' },
      taskRoleName: { type: 'string' },
      taskEphemeralStorage: { type: 'number', description: 'GiB' },
      containerDnsServers: { type: 'string' },
      maxDuration: { type: 'string', description: 'e.g. "15m"' },
      packages: { type: 'string', description: 'Path to package.json for worker deps' },
      secret: { type: 'array', items: { type: 'string' }, description: 'SSM secrets to expose to workers' },
      noAssignPublicIp: { type: 'boolean' },
      // Shared
      target: { type: 'string' },
      environment: { type: 'string' },
      scenarioName: { type: 'string' },
      variables: { description: 'JSON object or string' },
      overrides: { description: 'JSON object or string' },
      payload: { type: 'string' },
      dotenv: { type: 'string' },
      insecure: { type: 'boolean' },
      record: { type: 'boolean', description: 'Record to Artillery Cloud (uses ARTILLERY_CLOUD_API_KEY from env)' },
      name: { type: 'string' },
      note: { type: 'string' },
      tags: { type: 'string' },
      outputJson: { type: 'string', description: '--output (written by the run-fargate wrapper, if supported)' },
      env: { type: 'object', additionalProperties: { type: 'string' } },
      cwd: { type: 'string' },
      extraArgs: { type: 'array', items: { type: 'string' } }
    },
    required: ['path', 'region']
  };

  constructor(private artillery: ArtilleryWrapper) {}

  async call(request: any): Promise<ToolOutput<ArtilleryResult>> {
    try {
      const args = (request.params?.arguments || request.params || {}) as RunFargateOptions;
      const result = await this.artillery.runFargate(args);
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
