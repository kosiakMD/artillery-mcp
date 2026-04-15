import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RunReportTool } from '../run-report.js';

let tmpDir: string;
let mockArtillery: { runReport: any };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artillery-mcp-run-report-test-'));
  mockArtillery = { runReport: vi.fn() };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('RunReportTool', () => {
  it('happy path — calls artillery.runReport with correct paths and returns size', async () => {
    const jsonPath = path.join(tmpDir, 'results.json');
    const htmlPath = `${jsonPath}.html`;
    await fs.writeFile(jsonPath, JSON.stringify({ aggregate: {} }));
    // Simulate artillery report creating the file
    mockArtillery.runReport.mockImplementation(async () => {
      await fs.writeFile(htmlPath, '<html>fake report</html>');
    });
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({ params: { arguments: { jsonPath } } });
    expect(result.status).toBe('ok');
    expect(result.data?.htmlPath).toBe(htmlPath);
    expect(result.data?.sizeBytes).toBeGreaterThan(0);
    expect(mockArtillery.runReport).toHaveBeenCalledWith(jsonPath, htmlPath);
  });

  it('errors when jsonPath is missing', async () => {
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({ params: { arguments: {} } });
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/jsonPath is required/);
  });

  it('errors on relative jsonPath', async () => {
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({ params: { arguments: { jsonPath: 'relative/path.json' } } });
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/must be absolute/);
  });

  it('errors when jsonPath file does not exist — fail fast before calling artillery', async () => {
    const jsonPath = path.join(tmpDir, 'does-not-exist.json');
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({ params: { arguments: { jsonPath } } });
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/not found/);
    expect(mockArtillery.runReport).not.toHaveBeenCalled();
  });

  it('honors custom outputHtml override', async () => {
    const jsonPath = path.join(tmpDir, 'results.json');
    const customHtml = path.join(tmpDir, 'custom-report.html');
    await fs.writeFile(jsonPath, '{}');
    mockArtillery.runReport.mockImplementation(async () => {
      await fs.writeFile(customHtml, '<html/>');
    });
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({
      params: { arguments: { jsonPath, outputHtml: customHtml } }
    });
    expect(result.status).toBe('ok');
    expect(result.data?.htmlPath).toBe(customHtml);
    expect(mockArtillery.runReport).toHaveBeenCalledWith(jsonPath, customHtml);
  });

  it('errors on relative outputHtml', async () => {
    const jsonPath = path.join(tmpDir, 'results.json');
    await fs.writeFile(jsonPath, '{}');
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({
      params: { arguments: { jsonPath, outputHtml: 'relative.html' } }
    });
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/must be absolute/);
  });

  it('surfaces artillery command failures through tool error', async () => {
    const jsonPath = path.join(tmpDir, 'results.json');
    await fs.writeFile(jsonPath, '{}');
    mockArtillery.runReport.mockRejectedValue(
      new Error('artillery report exited with code 1. stderr: invalid input')
    );
    const tool = new RunReportTool(mockArtillery as any);
    const result = await tool.call({ params: { arguments: { jsonPath } } });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('artillery report exited');
  });
});
