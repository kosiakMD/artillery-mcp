import { spawn, SpawnOptions } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { ServerConfig, ArtilleryResult, ArtillerySummary } from '../types.js';

export class ArtilleryWrapper {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Detect Artillery binary from PATH or environment
   */
  static async detectBinary(): Promise<string> {
    const envBin = process.env.ARTILLERY_BIN;
    if (envBin) {
      try {
        await fs.access(envBin);
        return envBin;
      } catch {
        throw new Error(`ARTILLERY_BIN specified but not accessible: ${envBin}`);
      }
    }

    // Try common binary names
    const binaryNames = ['artillery', 'artillery.exe'];
    for (const name of binaryNames) {
      try {
        const { execSync } = await import('child_process');
        execSync(`which ${name}`, { stdio: 'ignore' });
        return name;
      } catch {
        // Continue to next binary name
      }
    }

    throw new Error('Artillery binary not found in PATH. Please install Artillery or set ARTILLERY_BIN environment variable.');
  }

  /**
   * Get Artillery version
   */
  async getVersion(): Promise<string> {
    try {
      const result = await this.runCommand(['--version'], { timeout: 10000 });
      return result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to get Artillery version: ${error}`);
    }
  }

  /**
   * Convert an existing JSON results file to HTML via `artillery report`.
   * Complements the inline reportHtml option on runTestFromFile — used when
   * you have a JSON from a previous/CI run and want the HTML locally.
   */
  async runReport(jsonPath: string, outputHtml: string): Promise<void> {
    const result = await this.runCommand(
      ['report', '--output', outputHtml, jsonPath],
      { cwd: this.config.workDir, env: process.env, timeout: 60000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `artillery report exited with code ${result.exitCode}. stderr: ${(result.stderr || '').slice(-500)}`
      );
    }
  }

  /**
   * Run Artillery test from file.
   *
   * Supports the full `artillery run` flag surface:
   *   --record --key     Cloud recording (key comes from ARTILLERY_CLOUD_API_KEY env)
   *   --tags             Cloud-dashboard tags (comma-separated key:value list)
   *   --name / --note    Human-friendly run identification
   *   -t --target        Override target URL
   *   -e --environment   Pick environment from config.environments
   *   --scenario-name    Run a specific scenario
   *   -v --variables     JSON vars
   *   --overrides        JSON dynamic overrides
   *   -p --payload       CSV payload path
   *   --dotenv           dotenv file path
   *   -k --insecure      Allow insecure TLS
   *   --count --solo     Multiple instances / single VU
   *
   * reportHtml is handled via a SEPARATE `artillery report` call after run
   * (the `artillery run` command has no --report flag in Artillery 2.x).
   */
  async runTestFromFile(
    filePath: string,
    options: {
      outputJson?: string;
      reportHtml?: string;
      env?: Record<string, string>;
      cwd?: string;
      validateOnly?: boolean;
      // Cloud recording
      record?: boolean;
      name?: string;
      note?: string;
      tags?: string; // comma-separated key:value
      // Config overrides
      target?: string;
      environment?: string;
      scenarioName?: string;
      variables?: string | Record<string, unknown>;
      overrides?: string | Record<string, unknown>;
      payload?: string;
      dotenv?: string;
      insecure?: boolean;
      count?: number;
      solo?: boolean;
      // Escape hatch — raw args appended last
      extraArgs?: string[];
    } = {}
  ): Promise<ArtilleryResult> {
    const startTime = Date.now();

    // Validate and sanitize file path
    const resolvedPath = await this.sanitizePath(filePath, options.cwd);

    // Artillery 2.x has no --dry-run flag; do a client-side YAML parse check instead.
    if (options.validateOnly) {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      // Minimal structural check: must contain `config:` and `scenarios:` keys at top-level
      const hasConfig = /^\s*config\s*:/m.test(content);
      const hasScenarios = /^\s*scenarios\s*:/m.test(content);
      if (!hasConfig || !hasScenarios) {
        throw new Error(
          `Config validation failed: ${!hasConfig ? 'missing "config:" key' : 'missing "scenarios:" key'}`
        );
      }
      return {
        exitCode: 0,
        elapsedMs: Date.now() - startTime,
        logsTail: `Config validated (client-side, Artillery 2.x has no --dry-run): ${resolvedPath}`,
        jsonResultPath: undefined,
        htmlReportPath: undefined,
        summary: undefined
      };
    }

    // Build command arguments
    const args = ['run'];

    if (options.outputJson) args.push('--output', options.outputJson);

    // NOTE: `artillery run` has no --report flag; HTML generation happens
    // via a separate `artillery report` invocation after the run.

    // Cloud recording
    if (options.record) {
      args.push('--record');
      // artillery CLI auto-reads ARTILLERY_CLOUD_API_KEY if --key is omitted,
      // but accept an explicit key override from env.
      const keyFromEnv = (options.env && options.env.ARTILLERY_CLOUD_API_KEY) || process.env.ARTILLERY_CLOUD_API_KEY;
      if (keyFromEnv) args.push('--key', keyFromEnv);
    }
    if (options.name) args.push('--name', options.name);
    if (options.note) args.push('--note', options.note);
    if (options.tags) args.push('--tags', options.tags);

    // Config / target overrides
    if (options.target) args.push('-t', options.target);
    if (options.environment) args.push('-e', options.environment);
    if (options.scenarioName) args.push('--scenario-name', options.scenarioName);
    if (options.variables !== undefined) {
      const json = typeof options.variables === 'string' ? options.variables : JSON.stringify(options.variables);
      args.push('-v', json);
    }
    if (options.overrides !== undefined) {
      const json = typeof options.overrides === 'string' ? options.overrides : JSON.stringify(options.overrides);
      args.push('--overrides', json);
    }
    if (options.payload) args.push('-p', options.payload);
    if (options.dotenv) args.push('--dotenv', options.dotenv);
    if (options.insecure) args.push('-k');
    if (options.count !== undefined) args.push('--count', String(options.count));
    if (options.solo) args.push('-s');

    if (options.extraArgs && options.extraArgs.length) args.push(...options.extraArgs);

    args.push(resolvedPath);

    // Run the command
    const result = await this.runCommand(args, {
      cwd: options.cwd || this.config.workDir,
      env: { ...process.env, ...options.env },
      timeout: this.config.timeoutMs
    });

    const elapsedMs = Date.now() - startTime;

    // Parse summary if JSON output was generated
    let summary: ArtillerySummary | undefined;
    if (options.outputJson && result.exitCode === 0) {
      try {
        summary = await this.parseSummary(options.outputJson);
      } catch (error) {
        // Log but don't fail the operation
        console.warn('Failed to parse summary:', error);
      }
    }

    // Post-run: generate HTML report if requested (separate CLI call)
    let htmlReportPath: string | undefined;
    if (options.reportHtml && options.outputJson && result.exitCode === 0) {
      try {
        await this.runCommand(
          ['report', '--output', options.reportHtml, options.outputJson],
          {
            cwd: options.cwd || this.config.workDir,
            env: { ...process.env, ...options.env },
            timeout: 60000
          }
        );
        htmlReportPath = options.reportHtml;
      } catch (error) {
        console.warn('Failed to generate HTML report:', error);
      }
    }

    return {
      exitCode: result.exitCode,
      elapsedMs,
      logsTail: result.stdout.slice(-2048), // Last 2KB
      jsonResultPath: options.outputJson,
      htmlReportPath,
      summary
    };
  }

  /**
   * Run Artillery test from inline config
   */
  /**
   * Launch a test on AWS ECS/Fargate via `artillery run-fargate`.
   */
  async runFargate(options: {
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
  }): Promise<ArtilleryResult> {
    const startTime = Date.now();
    const resolvedPath = await this.sanitizePath(options.path, options.cwd);

    const args: string[] = ['run-fargate', '--region', options.region];

    // Fargate-specific
    if (options.count !== undefined) args.push('--count', String(options.count));
    if (options.cluster) args.push('--cluster', options.cluster);
    if (options.cpu !== undefined) args.push('--cpu', String(options.cpu));
    if (options.memory !== undefined) args.push('--memory', String(options.memory));
    if (options.launchType) args.push('--launch-type', options.launchType);
    if (options.spot) args.push('--spot');
    if (options.launchConfig) args.push('--launch-config', options.launchConfig);
    if (options.subnetIds) args.push('--subnet-ids', options.subnetIds);
    if (options.securityGroupIds) args.push('--security-group-ids', options.securityGroupIds);
    if (options.taskRoleName) args.push('--task-role-name', options.taskRoleName);
    if (options.taskEphemeralStorage !== undefined) args.push('--task-ephemeral-storage', String(options.taskEphemeralStorage));
    if (options.containerDnsServers) args.push('--container-dns-servers', options.containerDnsServers);
    if (options.maxDuration) args.push('--max-duration', options.maxDuration);
    if (options.packages) args.push('--packages', options.packages);
    if (options.secret && options.secret.length) {
      for (const s of options.secret) args.push('--secret', s);
    }
    if (options.noAssignPublicIp) args.push('--no-assign-public-ip');

    // Shared with `run`
    if (options.outputJson) args.push('--output', options.outputJson);
    if (options.record) {
      args.push('--record');
      const keyFromEnv = (options.env && options.env.ARTILLERY_CLOUD_API_KEY) || process.env.ARTILLERY_CLOUD_API_KEY;
      if (keyFromEnv) args.push('--key', keyFromEnv);
    }
    if (options.name) args.push('--name', options.name);
    if (options.note) args.push('--note', options.note);
    if (options.tags) args.push('--tags', options.tags);
    if (options.target) args.push('-t', options.target);
    if (options.environment) args.push('-e', options.environment);
    if (options.scenarioName) args.push('--scenario-name', options.scenarioName);
    if (options.variables !== undefined) {
      const json = typeof options.variables === 'string' ? options.variables : JSON.stringify(options.variables);
      args.push('-v', json);
    }
    if (options.overrides !== undefined) {
      const json = typeof options.overrides === 'string' ? options.overrides : JSON.stringify(options.overrides);
      args.push('--overrides', json);
    }
    if (options.payload) args.push('-p', options.payload);
    if (options.dotenv) args.push('--dotenv', options.dotenv);
    if (options.insecure) args.push('-k');

    if (options.extraArgs && options.extraArgs.length) args.push(...options.extraArgs);

    args.push(resolvedPath);

    const result = await this.runCommand(args, {
      cwd: options.cwd || this.config.workDir,
      env: { ...process.env, ...options.env },
      timeout: this.config.timeoutMs
    });

    const elapsedMs = Date.now() - startTime;

    let summary: ArtillerySummary | undefined;
    if (options.outputJson && result.exitCode === 0) {
      try {
        summary = await this.parseSummary(options.outputJson);
      } catch (error) {
        console.warn('Failed to parse Fargate summary:', error);
      }
    }

    return {
      exitCode: result.exitCode,
      elapsedMs,
      logsTail: result.stdout.slice(-4096),
      jsonResultPath: options.outputJson,
      htmlReportPath: undefined,
      summary
    };
  }

  async runTestInline(
    configText: string,
    options: Parameters<ArtilleryWrapper['runTestFromFile']>[1] = {}
  ): Promise<ArtilleryResult> {
    // Create temporary config file
    const tempDir = path.join(this.config.workDir, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFile = path.join(tempDir, `config-${Date.now()}.yml`);
    
    try {
      await fs.writeFile(tempFile, configText);
      return await this.runTestFromFile(tempFile, options);
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Run quick HTTP test
   */
  async quickTest(options: {
    target: string;
    rate?: number;
    duration?: string;
    count?: number;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<ArtilleryResult> {
    if (!this.config.allowQuick) {
      throw new Error('Quick tests are disabled. Set ARTILLERY_ALLOW_QUICK=false to disable.');
    }

    // Use Artillery 2.0's quick command for simple tests
    const args = ['quick'];
    
    // Add target URL
    args.push(options.target);
    
    // Add count (number of VUs)
    if (options.count) {
      args.push('-c', options.count.toString());
    } else if (options.rate && options.duration) {
      // Estimate count based on rate and duration
      const durationSeconds = this.parseDuration(options.duration);
      const estimatedCount = Math.ceil(options.rate * durationSeconds);
      args.push('-c', estimatedCount.toString());
    } else {
      args.push('-c', '10'); // Default to 10 VUs
    }
    
    // Add number of requests per VU
    if (options.rate && options.duration) {
      const durationSeconds = this.parseDuration(options.duration);
      const vuCount = options.count || Math.ceil(options.rate * durationSeconds);
      const requestsPerVU = Math.ceil(options.rate * durationSeconds / vuCount);
      args.push('-n', requestsPerVU.toString());
    } else if (options.duration && !options.rate) {
      // If duration is specified but not rate, calculate requests to spread over duration
      const durationSeconds = this.parseDuration(options.duration);
      const requestsPerVU = Math.max(1, Math.ceil(durationSeconds / 2)); // Roughly 1 request every 2 seconds
      args.push('-n', requestsPerVU.toString());
    } else {
      args.push('-n', '30'); // Default to 30 requests per VU
    }
    
    // Add output file
    const outputFile = path.join(this.config.workDir, `quick-test-${Date.now()}.json`);
    args.push('-o', outputFile);
    
    // Add insecure flag if needed (for self-signed certs)
    if (options.target.startsWith('https://')) {
      args.push('-k');
    }
    
    // Run the quick command
    const startTime = Date.now();
    const result = await this.runCommand(args, {
      cwd: this.config.workDir,
      timeout: this.config.timeoutMs
    });
    const elapsedMs = Date.now() - startTime;
    
    // Parse summary if JSON output was generated
    let summary: ArtillerySummary | undefined;
    if (result.exitCode === 0) {
      try {
        summary = await this.parseSummary(outputFile);
      } catch (error) {
        // Log but don't fail the operation
        console.warn('Failed to parse summary:', error);
      }
    }

    return {
      exitCode: result.exitCode,
      elapsedMs,
      logsTail: result.stdout.slice(-2048), // Last 2KB
      jsonResultPath: outputFile,
      htmlReportPath: undefined,
      summary
    };
  }

  /**
   * Parse duration string to seconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])?$/);
    if (!match) return 1;
    
    const value = parseInt(match[1]);
    const unit = match[2] || 's';
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return value;
    }
  }

  /**
   * Parse Artillery JSON results
   */
  async parseResults(jsonPath: string): Promise<any> {
    try {
      const content = await fs.readFile(jsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse results file: ${error}`);
    }
  }

  /**
   * Parse summary from JSON results
   */
  private async parseSummary(jsonPath: string): Promise<ArtillerySummary> {
    const results = await this.parseResults(jsonPath);
    
    // Extract metrics from Artillery 2.0 output format
    const aggregate = results.aggregate || {};
    const counters = aggregate.counters || {};
    const rates = aggregate.rates || {};
    const summaries = aggregate.summaries || {};
    
    return {
      requestsTotal: counters['http.requests'] || 0,
      rpsAvg: rates['http.request_rate'] || 0,
      latencyMs: {
        p50: summaries['http.response_time']?.p50 || 0,
        p95: summaries['http.response_time']?.p95 || 0,
        p99: summaries['http.response_time']?.p99 || 0
      },
      errors: counters['http.errors'] || {}
    };
  }

  /**
   * Run Artillery command with process management
   */
  private async runCommand(
    args: string[],
    options: SpawnOptions & { timeout?: number } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { timeout, ...spawnOptions } = options;
      const timeoutMs = timeout || this.config.timeoutMs;

      const child = spawn(this.config.artilleryBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...spawnOptions
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Capture output with size limits
      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        if (stdout.length < this.config.maxOutputMb * 1024 * 1024) {
          stdout += chunk;
        }
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        if (stderr.length < this.config.maxOutputMb * 1024 * 1024) {
          stderr += chunk;
        }
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (!killed) {
          resolve({
            exitCode: code || 0,
            stdout,
            stderr
          });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Sanitize and validate file paths
   */
  private async sanitizePath(filePath: string, cwd?: string): Promise<string> {
    const workDir = cwd || this.config.workDir;
    const resolvedPath = path.resolve(workDir, filePath);
    
    // Ensure path is within allowed working directory
    if (!resolvedPath.startsWith(path.resolve(workDir))) {
      throw new Error(`Path ${filePath} is outside allowed working directory`);
    }
    
    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    
    return resolvedPath;
  }
}
