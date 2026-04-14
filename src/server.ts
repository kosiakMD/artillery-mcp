#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import debug from 'debug';
import { promises as fs } from 'fs';
import path from 'path';
import { ArtilleryWrapper } from './lib/artillery.js';
import { ConfigStorage } from './lib/config-storage.js';
import { loadProjectConfig, LoadedConfig } from './lib/config-loader.js';
import { registerTool } from './lib/register-tool.js';
import {
  RunTestFromFileTool,
  RunTestInlineTool,
  QuickTestTool,
  RunSavedConfigTool,
  ListCapabilitiesTool,
  ParseResultsTool,
  ReadArtilleryOutputTool,
  RunFargateTool,
  RunProjectLtTool,
  SaveConfigTool,
  ListConfigsTool,
  GetConfigTool,
  DeleteConfigTool,
  WizardStartTool,
  WizardStepTool,
  WizardFinalizeTool,
  RunPresetTestTool,
  CompareResultsTool
} from './tools/index.js';
import { ServerConfig } from './types.js';
import { z } from 'zod';


const SERVER_VERSION = '1.0.4';

const serverDebug = debug('artillery:mcp:server');
const errorsDebug = debug('artillery:mcp:errors');

async function main() {
  try {
    serverDebug('Starting Artillery MCP Server...');
    
    // Load configuration
    const config = await loadConfiguration();

    // Load optional project config (enables run_project_lt + counterBreakdown)
    let projectConfig: LoadedConfig;
    try {
      projectConfig = await loadProjectConfig(config.workDir);
      if (projectConfig.present) {
        serverDebug('Project config loaded from:', projectConfig.sourcePath);
      } else {
        serverDebug('No project config found — opt-in features disabled');
      }
    } catch (e) {
      errorsDebug('Failed to load project config:', e);
      // Continue without project config rather than crash the whole server
      projectConfig = { config: {}, sourcePath: null, present: false };
    }

    // Create MCP server
    const mcpServer = new McpServer({
      name: 'artillery-mcp-server',
      version: SERVER_VERSION,
    });

    // Create Artillery wrapper
    const artillery = new ArtilleryWrapper(config);

    // Create and initialize config storage
    const configStorage = new ConfigStorage(config.workDir);
    await configStorage.initialize();
    serverDebug('Config storage initialized at:', config.workDir + '/saved-configs');

    // Register tools
    registerTools(mcpServer, artillery, configStorage, config, projectConfig);

    // Connect to transport
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    
    serverDebug('Artillery MCP Server started successfully');
    serverDebug('Server version:', SERVER_VERSION);
    serverDebug('Artillery binary:', config.artilleryBin);
    serverDebug('Working directory:', config.workDir);
    
  } catch (error) {
    errorsDebug('Failed to start server:', error);
    process.exit(1);
  }
}

async function loadConfiguration(): Promise<ServerConfig> {
  // Load configuration from environment variables
  const config: ServerConfig = {
    artilleryBin: process.env.ARTILLERY_BIN || '',
    workDir: process.env.ARTILLERY_WORKDIR || process.cwd(),
    timeoutMs: parseInt(process.env.ARTILLERY_TIMEOUT_MS || '1800000'), // 30 minutes default
    maxOutputMb: parseInt(process.env.ARTILLERY_MAX_OUTPUT_MB || '10'), // 10MB default
    allowQuick: process.env.ARTILLERY_ALLOW_QUICK !== 'false'
  };

  serverDebug('Initial config loaded:', {
    artilleryBin: config.artilleryBin,
    workDir: config.workDir,
    timeoutMs: config.timeoutMs,
    maxOutputMb: config.maxOutputMb,
    allowQuick: config.allowQuick
  });

  // Validate and detect Artillery binary
  try {
    const detectedBinary = await ArtilleryWrapper.detectBinary();
    serverDebug('Artillery binary detected:', detectedBinary);
    
    config.artilleryBin = detectedBinary;
    serverDebug('Config.artilleryBin after assignment:', config.artilleryBin);
  } catch (error) {
    errorsDebug('Failed to detect Artillery binary:', error);
    throw error;
  }

  // Validate working directory
  try {
    await fs.access(config.workDir);
    serverDebug('Working directory:', config.workDir);
  } catch (error) {
    errorsDebug('Working directory not accessible:', config.workDir, error);
    throw error;
  }

  // Validate timeout
  if (config.timeoutMs < 1000 || config.timeoutMs > 7200000) {
    throw new Error('ARTILLERY_TIMEOUT_MS must be between 1 second and 2 hours');
  }

  // Validate output size limit
  if (config.maxOutputMb < 1 || config.maxOutputMb > 100) {
    throw new Error('ARTILLERY_MAX_OUTPUT_MB must be between 1 and 100');
  }

  serverDebug('Configuration loaded successfully');
  serverDebug('Final config:', {
    artilleryBin: config.artilleryBin,
    workDir: config.workDir,
    timeoutMs: config.timeoutMs,
    maxOutputMb: config.maxOutputMb,
    allowQuick: config.allowQuick
  });
  
  return config;
}

function registerTools(
  mcpServer: McpServer,
  artillery: ArtilleryWrapper,
  configStorage: ConfigStorage,
  config: ServerConfig,
  projectConfig: LoadedConfig
) {
  // Register run_test_from_file tool
  registerTool(mcpServer, 'run_test_from_file', {
    description: 'Run an Artillery test from a config file path (supports --record/--tags/--name/--note/-t/-e/--scenario-name/-v/--overrides/-p/--dotenv/-k/--count/-s).',
    inputSchema: {
      path: z.string().describe('Path to Artillery config file'),
      outputJson: z.string().optional().describe('Path for JSON results output'),
      reportHtml: z.string().optional().describe('Path for HTML report output (generated via `artillery report` after run; requires outputJson)'),
      env: z.record(z.string()).optional().describe('Environment variables'),
      cwd: z.string().optional().describe('Working directory'),
      validateOnly: z.boolean().optional().describe('Only validate config, do not run'),
      record: z.boolean().optional().describe('--record: stream to Artillery Cloud (uses ARTILLERY_CLOUD_API_KEY)'),
      name: z.string().optional().describe('--name: run name in Cloud dashboard'),
      note: z.string().optional().describe('--note: annotation'),
      tags: z.string().optional().describe('--tags: comma-separated key:value tags'),
      target: z.string().optional().describe('-t / --target: override target URL'),
      environment: z.string().optional().describe('-e: pick config.environments'),
      scenarioName: z.string().optional().describe('--scenario-name'),
      variables: z.any().optional().describe('-v: JSON object or string'),
      overrides: z.any().optional().describe('--overrides: JSON object or string'),
      payload: z.string().optional().describe('-p: CSV payload path'),
      dotenv: z.string().optional().describe('--dotenv: env file'),
      insecure: z.boolean().optional().describe('-k: allow insecure TLS'),
      count: z.number().optional().describe('--count: number of instances'),
      solo: z.boolean().optional().describe('-s / --solo: single VU'),
      extraArgs: z.array(z.string()).optional().describe('Raw extra CLI args (escape hatch)')
    }
  }, async (args) => {
    try {
      const tool = new RunTestFromFileTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'run_test_from_file',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register run_test_inline tool
  registerTool(mcpServer, 'run_test_inline', {
    description: 'Run an Artillery test from inline configuration text.',
    inputSchema: {
      configText: z.string().describe('Artillery configuration as text'),
      outputJson: z.string().optional().describe('Path for JSON results output'),
      reportHtml: z.string().optional().describe('Path for HTML report output'),
      env: z.record(z.string()).optional().describe('Environment variables'),
      cwd: z.string().optional().describe('Working directory'),
      validateOnly: z.boolean().optional().describe('Only validate config, do not run')
    }
  }, async (args) => {
    try {
      const tool = new RunTestInlineTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'run_test_inline',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register quick_test tool
  registerTool(mcpServer, 'quick_test', {
    description: 'Run a quick HTTP test (if supported by Artillery).',
    inputSchema: {
      target: z.string().describe('URL to test'),
      rate: z.number().min(1).optional().describe('Requests per second'),
      duration: z.string().optional().describe('Test duration (e.g., "1m")'),
      count: z.number().min(1).optional().describe('Total request count'),
      method: z.string().optional().describe('HTTP method'),
      headers: z.record(z.string()).optional().describe('HTTP headers'),
      body: z.string().optional().describe('Request body')
    }
  }, async (args) => {
    try {
      const tool = new QuickTestTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'quick_test',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register list_capabilities tool
  registerTool(mcpServer, 'list_capabilities', {
    description: 'Report versions, detected features, and server limits.',
    inputSchema: {}
  }, async () => {
    try {
      const tool = new ListCapabilitiesTool(artillery, config, SERVER_VERSION);
      const result = await tool.call({ params: { arguments: {} } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'list_capabilities',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register parse_results tool
  registerTool(mcpServer, 'parse_results', {
    description: 'Parse Artillery JSON results and return summary.',
    inputSchema: {
      jsonPath: z.string().describe('Path to Artillery JSON results file')
    }
  }, async (args) => {
    try {
      const tool = new ParseResultsTool(artillery, projectConfig.config);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'parse_results',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register run_fargate tool
  registerTool(mcpServer, 'run_fargate', {
    description: 'Launch an Artillery load test on AWS ECS/Fargate (run-fargate). Requires AWS credentials and an artilleryio cluster in the target region.',
    inputSchema: {
      path: z.string().describe('Path to Artillery config'),
      region: z.string().describe('AWS region, e.g. us-east-1'),
      count: z.number().optional().describe('Number of Fargate workers'),
      cluster: z.string().optional(),
      cpu: z.any().optional(),
      memory: z.any().optional(),
      launchType: z.enum(['ecs:fargate', 'ecs:ec2']).optional(),
      spot: z.boolean().optional(),
      launchConfig: z.string().optional(),
      subnetIds: z.string().optional(),
      securityGroupIds: z.string().optional(),
      taskRoleName: z.string().optional(),
      taskEphemeralStorage: z.number().optional(),
      containerDnsServers: z.string().optional(),
      maxDuration: z.string().optional(),
      packages: z.string().optional(),
      secret: z.array(z.string()).optional(),
      noAssignPublicIp: z.boolean().optional(),
      target: z.string().optional(),
      environment: z.string().optional(),
      scenarioName: z.string().optional(),
      variables: z.any().optional(),
      overrides: z.any().optional(),
      payload: z.string().optional(),
      dotenv: z.string().optional(),
      insecure: z.boolean().optional(),
      record: z.boolean().optional(),
      name: z.string().optional(),
      note: z.string().optional(),
      tags: z.string().optional(),
      outputJson: z.string().optional(),
      env: z.record(z.string()).optional(),
      cwd: z.string().optional(),
      extraArgs: z.array(z.string()).optional()
    }
  }, async (args) => {
    try {
      const tool = new RunFargateTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            tool: 'run_fargate',
            error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error occurred' }
          })
        }]
      };
    }
  });

  // Register run_project_lt tool (OPT-IN: requires .artillery-mcp.config.json with `flows`)
  if (projectConfig.present && projectConfig.config.flows && Object.keys(projectConfig.config.flows).length > 0) {
    const flowNames = Object.keys(projectConfig.config.flows);
    const envNames = projectConfig.config.environments ?? [];
    // projectRoot = ARTILLERY_WORKDIR (where the tests actually live). The config
    // file itself can live anywhere (env var override, nested location, etc.).
    // Walk-up discovery places config at project root anyway, so in the common
    // case these coincide; env-var usage needs workDir to win.
    const projectRoot = config.workDir;
    serverDebug(`Registering run_project_lt: ${flowNames.length} flows, ${envNames.length} environments`);
    registerTool(mcpServer, 'run_project_lt', {
      description: `Run a pre-configured project LT scenario with opinionated defaults. Flows: ${flowNames.join(', ')}. Environments: ${envNames.join(', ') || '(any)'}. Reads flow→path mapping, default tags, and output dir from .artillery-mcp.config.json.`,
      inputSchema: {
        flow: z.string().describe(`Named flow. One of: ${flowNames.join(', ')}`),
        environment: z.string().describe(envNames.length ? `Environment. One of: ${envNames.join(', ')}` : 'Environment name'),
        record: z.boolean().optional(),
        name: z.string().optional(),
        note: z.string().optional(),
        extraTags: z.string().optional(),
        templateVars: z.record(z.string()).optional(),
        outputJson: z.string().optional(),
        reportHtml: z.string().optional(),
        variables: z.any().optional(),
        overrides: z.any().optional(),
        validateOnly: z.boolean().optional(),
        extraArgs: z.array(z.string()).optional()
      }
    }, async (args) => {
      try {
        const tool = new RunProjectLtTool(artillery, projectConfig.config, projectRoot);
        const result = await tool.call({ params: { arguments: args } });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'run_project_lt',
              error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error occurred' }
            })
          }]
        };
      }
    });
  }

  // Register read_artillery_output tool
  registerTool(mcpServer, 'read_artillery_output', {
    description:
      'Read an Artillery stdout text dump (e.g. artillery-output.txt from CI) and extract summary block, counters, rates, nested latency metrics — without needing a JSON report. Optionally returns counterBreakdown when a project config with counterGroups is loaded.',
    inputSchema: {
      path: z.string().describe('Absolute path to the text output file'),
      maxBytes: z.number().optional().describe('Truncate rawText from the head if file exceeds this many bytes (default 65536). Counters/metrics are still parsed from the full file.'),
      block: z.enum(['summary', 'full']).optional().describe('Parse metrics from "summary" (last Summary report section) or "full" file. Default: summary.')
    }
  }, async (args) => {
    try {
      const tool = new ReadArtilleryOutputTool(projectConfig.config);
      const result = await tool.call({ params: { arguments: args } });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'read_artillery_output',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // ==========================================================================
  // Saved Config Tools
  // ==========================================================================

  // Register save_config tool
  registerTool(mcpServer, 'save_config', {
    description: 'Save a new Artillery configuration or update an existing one.',
    inputSchema: {
      name: z.string().describe('Unique name for the config'),
      content: z.string().describe('Artillery configuration as YAML or JSON string'),
      description: z.string().optional().describe('Optional description'),
      tags: z.array(z.string()).optional().describe('Optional tags for organization')
    }
  }, async (args) => {
    try {
      const tool = new SaveConfigTool(configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'save_config',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register list_configs tool
  registerTool(mcpServer, 'list_configs', {
    description: 'List all saved Artillery configurations.',
    inputSchema: {
      tag: z.string().optional().describe('Optional tag to filter configs by')
    }
  }, async (args) => {
    try {
      const tool = new ListConfigsTool(configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'list_configs',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register get_config tool
  registerTool(mcpServer, 'get_config', {
    description: 'Retrieve a saved Artillery configuration by name.',
    inputSchema: {
      name: z.string().describe('Name of the config to retrieve')
    }
  }, async (args) => {
    try {
      const tool = new GetConfigTool(configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'get_config',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register delete_config tool
  registerTool(mcpServer, 'delete_config', {
    description: 'Delete a saved Artillery configuration.',
    inputSchema: {
      name: z.string().describe('Name of the config to delete')
    }
  }, async (args) => {
    try {
      const tool = new DeleteConfigTool(configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'delete_config',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register run_saved_config tool
  registerTool(mcpServer, 'run_saved_config', {
    description: 'Run an Artillery test using a previously saved configuration.',
    inputSchema: {
      name: z.string().describe('Name of the saved config to run'),
      outputJson: z.string().optional().describe('Path for JSON results output'),
      reportHtml: z.string().optional().describe('Path for HTML report output'),
      env: z.record(z.string()).optional().describe('Environment variables'),
      validateOnly: z.boolean().optional().describe('Only validate config, do not run')
    }
  }, async (args) => {
    try {
      const tool = new RunSavedConfigTool(artillery, configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'run_saved_config',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // ==========================================================================
  // Wizard Tools
  // ==========================================================================

  // Register wizard_start tool
  registerTool(mcpServer, 'wizard_start', {
    description: 'Start a new interactive wizard for building Artillery test configurations.',
    inputSchema: {
      fromSavedConfig: z.string().optional().describe('Optional saved config name to use as starting point')
    }
  }, async (args) => {
    try {
      const tool = new WizardStartTool(configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'wizard_start',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register wizard_step tool
  registerTool(mcpServer, 'wizard_step', {
    description: 'Advance the wizard to the next step based on user input.',
    inputSchema: {
      state: z.object({}).passthrough().describe('The current wizard state'),
      action: z.string().describe('The action to perform'),
      value: z.union([
        z.string(),
        z.boolean(),
        z.number(),
        z.object({}).passthrough()
      ]).describe('The value for the action')
    }
  }, async (args) => {
    try {
      const tool = new WizardStepTool();
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'wizard_step',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register wizard_finalize tool
  registerTool(mcpServer, 'wizard_finalize', {
    description: 'Generate final Artillery config from completed wizard state. Optionally save and/or run it.',
    inputSchema: {
      state: z.object({}).passthrough().describe('The completed wizard state'),
      runImmediately: z.boolean().optional().describe('If true, run the test immediately'),
      outputJson: z.string().optional().describe('Path for JSON results output'),
      reportHtml: z.string().optional().describe('Path for HTML report output')
    }
  }, async (args) => {
    try {
      const tool = new WizardFinalizeTool(artillery, configStorage);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'wizard_finalize',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // ==========================================================================
  // Advanced Testing Tools
  // ==========================================================================

  // Register run_preset_test tool
  registerTool(mcpServer, 'run_preset_test', {
    description: 'Run a preset test type (smoke, baseline, soak, spike) with minimal configuration.',
    inputSchema: {
      target: z.string().describe('Target URL to test'),
      preset: z.enum(['smoke', 'baseline', 'soak', 'spike']).describe('Test type preset'),
      path: z.string().optional().describe('Endpoint path (default: /)'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP method'),
      body: z.record(z.unknown()).optional().describe('Request body for POST/PUT'),
      outputJson: z.string().optional().describe('Path for JSON results'),
      reportHtml: z.string().optional().describe('Path for HTML report'),
      env: z.record(z.string()).optional().describe('Environment variables')
    }
  }, async (args) => {
    try {
      const tool = new RunPresetTestTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'run_preset_test',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  // Register compare_results tool
  registerTool(mcpServer, 'compare_results', {
    description: 'Compare two Artillery test results to detect performance regressions.',
    inputSchema: {
      baselinePath: z.string().describe('Path to baseline JSON results'),
      currentPath: z.string().describe('Path to current JSON results'),
      thresholds: z.object({
        maxLatencyIncrease: z.number().optional().describe('Max latency increase (default: 0.2 = 20%)'),
        maxErrorRateIncrease: z.number().optional().describe('Max error rate increase (default: 0.01 = 1%)'),
        minThroughputRatio: z.number().optional().describe('Min throughput ratio (default: 0.9 = 90%)')
      }).optional().describe('Custom thresholds')
    }
  }, async (args) => {
    try {
      const tool = new CompareResultsTool(artillery);
      const result = await tool.call({ params: { arguments: args } });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              tool: 'compare_results',
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            })
          }
        ]
      };
    }
  });

  serverDebug('All tools registered successfully (15 tools)');
}

// Start the server
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
