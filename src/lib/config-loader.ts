/**
 * Optional project-config loader for @kosiakmd/artillery-mcp.
 *
 * The package is fully usable with NO config. A config file is only needed
 * when you want:
 *  - `run_project_lt` tool (flow × environment launcher with opinionated defaults)
 *  - `counterBreakdown` grouping in parse_results / read_artillery_output responses
 *
 * Discovery precedence:
 *   1. ARTILLERY_MCP_CONFIG env var (absolute path)
 *   2. Walk up from cwd looking for `.artillery-mcp.config.json` (or `.yml`)
 *   3. No config → features stay disabled
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface CounterBucketRule {
  /** Output bucket name (key in the resulting counterBreakdown object) */
  key: string;
  /** Regex string matched against the full counter name */
  match?: string;
  /** Fallback bucket when no rule matches. Only one bucket may have default:true */
  default?: boolean;
}

export interface CounterGroupsConfig {
  /** Name of the output field in responses (e.g. "counterBreakdown") */
  name?: string;
  /** Optional prefix — counters not starting with this prefix are ignored entirely */
  prefix?: string;
  /** Ordered list of buckets. First match wins. */
  buckets: CounterBucketRule[];
}

export interface ProjectConfig {
  /** Named flow → relative YAML config path. Required for run_project_lt. */
  flows?: Record<string, string>;
  /** Accepted environment values (from `config.environments` in the Artillery YAML) */
  environments?: string[];
  /** Constant tags merged into every run_project_lt call */
  defaultTags?: Record<string, string>;
  /**
   * Tag templates, e.g. ["type:{flow}", "env:{env}", "round:{round}"].
   * Substitutes {flow}, {env}, and any caller-supplied template vars.
   */
  tagTemplates?: string[];
  /** Relative dir for auto-generated outputJson paths */
  outputDir?: string;
  /** Counter-group rules for enriching parse_results / read_artillery_output */
  counterGroups?: CounterGroupsConfig;
}

export interface LoadedConfig {
  /** Parsed config (or empty `{}` if no config file found) */
  config: ProjectConfig;
  /** Absolute path of the config file, or null if none found */
  sourcePath: string | null;
  /** True when at least one config file was located and parsed */
  present: boolean;
}

const CONFIG_FILENAMES = ['.artillery-mcp.config.json', '.artillery-mcp.config.yml', '.artillery-mcp.config.yaml'];

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkUp(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  // Safety limit: at most 32 levels up
  for (let i = 0; i < 32; i++) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (await fileExists(candidate)) return candidate;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseContent(content: string, filePath: string): ProjectConfig {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return JSON.parse(content);
  }
  if (ext === '.yml' || ext === '.yaml') {
    // Keep the public package dependency-light: inform user YAML needs a peer dep.
    throw new Error(
      `YAML configs are not yet supported without an extra dependency. Please use .artillery-mcp.config.json. (Source: ${filePath})`
    );
  }
  throw new Error(`Unknown config file extension: ${filePath}`);
}

/**
 * Load a project config, if any. Never throws for "no config" — only throws
 * when a config file is found but fails to parse (so users catch typos early).
 */
export async function loadProjectConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const envPath = process.env.ARTILLERY_MCP_CONFIG;
  let sourcePath: string | null = null;

  if (envPath) {
    if (!path.isAbsolute(envPath)) {
      throw new Error(`ARTILLERY_MCP_CONFIG must be absolute: ${envPath}`);
    }
    if (!(await fileExists(envPath))) {
      throw new Error(`ARTILLERY_MCP_CONFIG points to non-existent file: ${envPath}`);
    }
    sourcePath = envPath;
  } else {
    sourcePath = await walkUp(cwd);
  }

  if (!sourcePath) {
    return { config: {}, sourcePath: null, present: false };
  }

  const content = await fs.readFile(sourcePath, 'utf-8');
  const config = parseContent(content, sourcePath);
  return { config, sourcePath, present: true };
}
