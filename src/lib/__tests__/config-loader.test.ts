import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { loadProjectConfig } from '../config-loader.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artillery-mcp-config-test-'));
  delete process.env.ARTILLERY_MCP_CONFIG;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.ARTILLERY_MCP_CONFIG;
});

describe('loadProjectConfig', () => {
  it('returns present=false when no config found anywhere', async () => {
    const result = await loadProjectConfig(tmpDir);
    expect(result.present).toBe(false);
    expect(result.sourcePath).toBeNull();
    expect(result.config).toEqual({});
  });

  it('loads .artillery-mcp.config.json from cwd', async () => {
    const configPath = path.join(tmpDir, '.artillery-mcp.config.json');
    await fs.writeFile(configPath, JSON.stringify({ flows: { smoke: 'test.yml' } }));
    const result = await loadProjectConfig(tmpDir);
    expect(result.present).toBe(true);
    expect(result.sourcePath).toBe(configPath);
    expect(result.config.flows?.smoke).toBe('test.yml');
  });

  it('walks up from cwd to find config in parent dir', async () => {
    const configPath = path.join(tmpDir, '.artillery-mcp.config.json');
    await fs.writeFile(configPath, JSON.stringify({ environments: ['dev'] }));
    const subDir = path.join(tmpDir, 'a', 'b', 'c');
    await fs.mkdir(subDir, { recursive: true });
    const result = await loadProjectConfig(subDir);
    expect(result.present).toBe(true);
    expect(result.sourcePath).toBe(configPath);
  });

  it('prefers ARTILLERY_MCP_CONFIG env over walk-up discovery', async () => {
    // Write two configs: one in cwd (would be walked-up), one via env
    const walkUpConfig = path.join(tmpDir, '.artillery-mcp.config.json');
    await fs.writeFile(walkUpConfig, JSON.stringify({ environments: ['walk-up'] }));
    const envConfig = path.join(tmpDir, 'alt', 'env-config.json');
    await fs.mkdir(path.dirname(envConfig), { recursive: true });
    await fs.writeFile(envConfig, JSON.stringify({ environments: ['via-env'] }));
    process.env.ARTILLERY_MCP_CONFIG = envConfig;
    const result = await loadProjectConfig(tmpDir);
    expect(result.sourcePath).toBe(envConfig);
    expect(result.config.environments).toEqual(['via-env']);
  });

  it('throws when ARTILLERY_MCP_CONFIG is not absolute', async () => {
    process.env.ARTILLERY_MCP_CONFIG = 'relative/path.json';
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/must be absolute/);
  });

  it('throws when ARTILLERY_MCP_CONFIG points to non-existent file', async () => {
    process.env.ARTILLERY_MCP_CONFIG = '/absolutely/does/not/exist.json';
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/non-existent/);
  });

  it('throws on malformed JSON config (caller catches early — not silent failure)', async () => {
    const configPath = path.join(tmpDir, '.artillery-mcp.config.json');
    await fs.writeFile(configPath, '{ this is not valid JSON');
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow();
  });

  it('rejects YAML extension with clear message (YAML support is v0.2+)', async () => {
    const configPath = path.join(tmpDir, '.artillery-mcp.config.yml');
    await fs.writeFile(configPath, 'flows:\n  smoke: test.yml');
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/YAML/);
  });

  it('terminates cleanly when walking up from filesystem root', async () => {
    // Pick filesystem root — should not infinite-loop, should return {present:false}
    const result = await loadProjectConfig(path.parse(tmpDir).root);
    // Allowed: found nothing (clean) OR found something (unlikely but possible if
    // the root dir coincidentally has a config). Either way the call must return.
    expect(typeof result.present).toBe('boolean');
    expect(result.config).toBeDefined();
  });

  it('picks NEAREST config when two exist in walk-up path', async () => {
    const rootConfig = path.join(tmpDir, '.artillery-mcp.config.json');
    await fs.writeFile(rootConfig, JSON.stringify({ environments: ['root'] }));
    const nearDir = path.join(tmpDir, 'a', 'b');
    await fs.mkdir(nearDir, { recursive: true });
    const nearConfig = path.join(nearDir, '.artillery-mcp.config.json');
    await fs.writeFile(nearConfig, JSON.stringify({ environments: ['near'] }));
    const result = await loadProjectConfig(path.join(nearDir, 'c'));
    expect(result.sourcePath).toBe(nearConfig);
    expect(result.config.environments).toEqual(['near']);
  });
});
