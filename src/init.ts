#!/usr/bin/env node
/**
 * `npx @kosiakmd/artillery-mcp init` — scaffolds `.artillery-mcp.config.json`
 * and `.ai/skills/artillery-mcp/SKILL.md` in the current directory.
 *
 * Idempotent: refuses to overwrite existing files by default; pass `--force`
 * to clobber.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/init.js → repo root is one level up. In a published package, the
// `skills/` dir sits next to `dist/` so we look there.
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const CONFIG_TEMPLATE = {
  $comment:
    'Config for @kosiakmd/artillery-mcp. Remove fields you don\'t need. Full schema: https://github.com/kosiakMD/artillery-mcp#readme',
  flows: {
    smoke: 'tests/load/smoke.yml',
  },
  environments: ['local', 'staging', 'prod'],
  defaultTags: {
    repo: 'my-app',
    owner: 'my-team',
  },
  tagTemplates: ['type:{flow}', 'env:{env}', 'source:mcp'],
  outputDir: 'load-test-results',
  counterGroups: {
    name: 'breakdown',
    prefix: '',
    buckets: [
      { key: 'steps', match: '^.+\\.step\\.' },
      { key: 'other', default: true },
    ],
  },
};

interface WriteOp {
  label: string;
  target: string;
  contents: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  if (subcommand === '--help' || subcommand === '-h' || !subcommand) {
    console.log(
      'Usage:\n' +
        '  artillery-mcp               Start the MCP server (stdio)\n' +
        '  artillery-mcp init [-f]     Scaffold .artillery-mcp.config.json + .ai/skills/artillery-mcp/SKILL.md\n' +
        '  artillery-mcp --help        Show this message\n'
    );
    return;
  }
  if (subcommand !== 'init') {
    console.error(`Unknown subcommand: ${subcommand}. Run 'artillery-mcp --help'.`);
    process.exit(1);
  }

  const force = args.includes('--force') || args.includes('-f');
  const cwd = process.cwd();

  // Locate the SKILL.md template shipped with the package
  const skillTemplatePath = path.join(PACKAGE_ROOT, 'skills', 'SKILL.md');
  let skillTemplate: string;
  try {
    skillTemplate = await fs.readFile(skillTemplatePath, 'utf-8');
  } catch (e) {
    console.error(
      `Could not read SKILL.md template at ${skillTemplatePath}.\n` +
        `This is a package integrity issue — please report at ` +
        `https://github.com/kosiakMD/artillery-mcp/issues.`
    );
    process.exit(2);
  }

  const ops: WriteOp[] = [
    {
      label: 'project config',
      target: path.join(cwd, '.artillery-mcp.config.json'),
      contents: JSON.stringify(CONFIG_TEMPLATE, null, 2) + '\n',
    },
    {
      label: 'agent skill',
      target: path.join(cwd, '.ai', 'skills', 'artillery-mcp', 'SKILL.md'),
      contents: skillTemplate,
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const op of ops) {
    if ((await fileExists(op.target)) && !force) {
      const rel = path.relative(cwd, op.target);
      console.log(`  skip   ${rel}  (exists — re-run with --force to overwrite)`);
      skipped++;
      continue;
    }
    await fs.mkdir(path.dirname(op.target), { recursive: true });
    await fs.writeFile(op.target, op.contents);
    const rel = path.relative(cwd, op.target);
    console.log(`  create ${rel}`);
    created++;
  }

  console.log(
    `\nDone. ${created} created, ${skipped} skipped.\n\n` +
      `Next steps:\n` +
      `  1. Edit .artillery-mcp.config.json — replace flows/environments with your own.\n` +
      `  2. Add the MCP to Claude Code:\n` +
      `       claude mcp add artillery-mcp -s user \\\n` +
      `         -e ARTILLERY_WORKDIR="$PWD" \\\n` +
      `         -e ARTILLERY_CLOUD_API_KEY=... \\\n` +
      `         -- npx -y @kosiakmd/artillery-mcp\n` +
      `  3. Restart your Claude session — the MCP will walk up and find your config.\n`
  );
}

// When invoked directly (`node dist/init.js`), run the CLI. When imported from
// server.ts as a subcommand dispatcher, the caller invokes `runCli()` instead.
const isDirectInvoke =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith('/init.js');
if (isDirectInvoke && process.argv[1]?.endsWith('init.js')) {
  runCli().catch((e) => {
    console.error('artillery-mcp init failed:', e);
    process.exit(1);
  });
}
