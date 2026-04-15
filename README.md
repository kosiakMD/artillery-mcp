# @kosiakmd/artillery-mcp

[![ci](https://github.com/kosiakMD/artillery-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kosiakMD/artillery-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@kosiakmd/artillery-mcp.svg)](https://www.npmjs.com/package/@kosiakmd/artillery-mcp)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Richer drop-in MCP server for Artillery 2.x** — exposes the full `artillery run`
and `artillery run-fargate` flag surface, parses raw text output (`artillery-output.txt`),
returns every counter/rate/summary Artillery produces (not just `http.*`), and
optionally adds a config-driven project launcher and counter-grouping for your
custom counters.

## Why another MCP server?

The upstream [`@jch1887/artillery-mcp-server`](https://github.com/jch1887/artillery-mcp-server)
was a solid start but missed several flags our team needed day-to-day. This package is
a MIT-licensed fork with broader coverage. See [Credits](#credits).

| Feature | upstream | this package |
|---|---|---|
| `run_test_from_file` flags | path + output only | + `--record/--key/--tags/--name/--note/-t/-e/--scenario-name/-v/--overrides/-p/--dotenv/-k/--count/-s` |
| AWS Fargate (`run-fargate`) | ❌ | ✅ full flag set |
| `parse_results` counters | `http.*` only | ALL counters + rates + nested summaries |
| Parse raw stdout (`artillery-output.txt`) | ❌ | ✅ `read_artillery_output` tool |
| HTML report generation | passes invalid `--report` flag | ✅ separate `artillery report` call |
| Standalone JSON → HTML (`run_report`) | ❌ | ✅ |
| `--dry-run` validation | broken (flag doesn't exist in 2.x) | ✅ client-side YAML structural check |
| Opt-in project launcher | ❌ | ✅ `run_project_lt` (when config present) |
| Opt-in counter grouping | ❌ | ✅ `counterBreakdown` (when config present) |
| `init` scaffolder | ❌ | ✅ `npx @kosiakmd/artillery-mcp init` |
| Shipped `SKILL.md` template | ❌ | ✅ agent-oriented guidance |
| Docker image | ❌ | ✅ multi-arch (Docker Hub + GHCR) |
| MCP Registry listing | ❌ | ✅ `io.github.kosiakMD/artillery-mcp` |
| `serverVersion` accuracy | hardcoded | ✅ read from package.json at runtime |
| Tests | 122 | 163 |

## Quickstart for agents (Claude Code / Cursor)

```bash
# In your project root
npx @kosiakmd/artillery-mcp init
```

Scaffolds two files (skipped if they already exist, use `--force` to overwrite):

- `.artillery-mcp.config.json` — starter template with commented fields
- `.ai/skills/artillery-mcp/SKILL.md` — agent-oriented guidance (when to call which tool, common patterns, gotchas)

After editing the config with your real flows/paths, register the MCP in your agent and restart the session:

```bash
claude mcp add artillery-mcp -s user \
  -e ARTILLERY_WORKDIR="$PWD" \
  -e ARTILLERY_CLOUD_API_KEY=a9_... \
  -- npx -y @kosiakmd/artillery-mcp
```

## Install / Quickstart (zero-config)

Runs out of the box — no config file needed. Works as an MCP server over stdio
for Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.

```bash
# Using npx (no install)
npx -y @kosiakmd/artillery-mcp

# Or install globally
npm install -g @kosiakmd/artillery-mcp
artillery-mcp
```

**Claude Code / Cursor** — register as an MCP server in your client config:

```json
{
  "mcpServers": {
    "artillery-mcp": {
      "command": "npx",
      "args": ["-y", "@kosiakmd/artillery-mcp"],
      "env": {
        "ARTILLERY_WORKDIR": "/absolute/path/to/your/project",
        "ARTILLERY_CLOUD_API_KEY": "a9_..."
      }
    }
  }
}
```

**Claude Code CLI**:

```bash
claude mcp add artillery-mcp -s user \
  -e ARTILLERY_WORKDIR=/abs/path/to/project \
  -e ARTILLERY_CLOUD_API_KEY=a9_... \
  -- npx -y @kosiakmd/artillery-mcp
```

Prerequisites: Node.js ≥ 20; Artillery CLI on `PATH` (`npm i -g artillery`).

## Docker

Multi-arch image — `linux/amd64` and `linux/arm64`, Artillery CLI preinstalled. ~500 MB (Chromium/Playwright browsers skipped — see below). Published to **both** Docker Hub and GitHub Container Registry from the same build; identical digests.

```bash
# Docker Hub (discoverable via `docker search artillery-mcp`)
docker pull kosiakmd/artillery-mcp:latest

# GitHub Container Registry
docker pull ghcr.io/kosiakmd/artillery-mcp:latest
```

**Run** (mount your project as `/workspace`):

```bash
docker run -i --init --rm \
  -v "$PWD":/workspace \
  -e ARTILLERY_CLOUD_API_KEY="$ARTILLERY_CLOUD_API_KEY" \
  kosiakmd/artillery-mcp:latest
```

`--init` ensures the Node process gets reaped on stdin close. Mount `/workspace` read-write if you want `save_config` tools to persist to `/workspace/saved-configs/`; read-only is fine otherwise (the save-config family will simply return errors when called).

**MCP client config** (Claude Desktop / Cursor) — point the MCP at `docker` instead of `npx`:

```json
{
  "mcpServers": {
    "artillery-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--init", "--rm",
        "-v", "/absolute/path/to/your/project:/workspace",
        "-e", "ARTILLERY_CLOUD_API_KEY",
        "kosiakmd/artillery-mcp:latest"
      ],
      "env": { "ARTILLERY_CLOUD_API_KEY": "a9_..." }
    }
  }
}
```

**Playwright engine?** If you use `engine: playwright` in your Artillery scripts, extend the base image with Chromium:

```dockerfile
FROM kosiakmd/artillery-mcp:latest
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont \
 && npm i -g @playwright/test \
 && npx playwright install chromium
```

**Image tags:**
- `latest` — most recent release
- `v0.1.1`, `v0.1`, `v0` — pinned by semver (patch / minor / major)

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `ARTILLERY_BIN` | Path to `artillery` binary | auto-detected via `which artillery` |
| `ARTILLERY_WORKDIR` | Working directory for runs | `cwd` |
| `ARTILLERY_TIMEOUT_MS` | Max duration of a single run | `1800000` (30 min) |
| `ARTILLERY_MAX_OUTPUT_MB` | Cap on captured stdout/stderr | `10` |
| `ARTILLERY_ALLOW_QUICK` | Enable `quick_test` tool | `true` |
| `ARTILLERY_CLOUD_API_KEY` | Used when a tool is called with `record: true` | — |
| `ARTILLERY_MCP_CONFIG` | Absolute path to project config (opt-in) | — |
| `DEBUG` | `artillery:mcp:*` for verbose logs | — |

## 18 base tools (no config needed)

**Run tests**
- **`run_test_from_file`** — full-flag `artillery run` wrapper (see flag surface above).
- **`run_test_inline`** — same but takes YAML text, writes to a tmp file.
- **`quick_test`** — `artillery quick <url>` with rate/count/duration/method/headers/body.
- **`run_fargate`** — `artillery run-fargate` with `--region`, `--cluster`, `--cpu`, `--memory`, `--launch-type`, `--spot`, `--subnet-ids`, `--security-group-ids`, `--task-role-name`, `--task-ephemeral-storage`, `--container-dns-servers`, `--max-duration`, `--packages`, `--secret`, `--no-assign-public-ip` + all run-shared flags.
- **`run_preset_test`** — smoke / baseline / soak / spike presets against a URL.
- **`run_saved_config`** — re-run a saved config by name.

**Parse + inspect results**
- **`parse_results`** — reads an Artillery JSON report; returns `summary` + `allCounters` + `allRates` + `allSummaries` + scenarios + metadata.
- **`read_artillery_output`** — reads a raw Artillery stdout dump (e.g. `artillery-output.txt` saved from CI), returns `rawText` (with tail-truncation), `summaryBlock`, `counters`, `rates`, `metrics` (nested percentiles).
- **`run_report`** — converts an existing JSON results file to HTML via `artillery report`. Use when you have JSON from CI artifacts and want shareable HTML without re-running.
- **`compare_results`** — diff two Artillery JSON results for regression detection.

**Saved configs**
- **`save_config` / `list_configs` / `get_config` / `delete_config`** — persistent named Artillery configs.

**Interactive builder**
- **`wizard_start` / `wizard_step` / `wizard_finalize`** — interactive test builder.

**Meta**
- **`list_capabilities`** — versions of Artillery/Node/this server, configured paths, limits.

## Optional feature #1 — Project launcher (`run_project_lt`)

Activated when a `.artillery-mcp.config.json` file is discovered. Gives you
one-liner invocations instead of writing full `artillery run ...` flag lists.

**Discovery precedence:**
1. `ARTILLERY_MCP_CONFIG` env var (absolute path)
2. Walk up from `ARTILLERY_WORKDIR` / `cwd` looking for `.artillery-mcp.config.json`
3. No config → this tool is not registered

**Config** (`.artillery-mcp.config.json`):

```json
{
  "flows": {
    "browse": "tests/load/browse.yml",
    "buy": "tests/load/buy.yml",
    "combined": "tests/load/combined.yml"
  },
  "environments": ["local", "staging", "prod"],
  "defaultTags": { "repo": "my-app", "owner": "Platform" },
  "tagTemplates": ["type:{flow}", "env:{env}", "source:mcp"],
  "outputDir": "load-test-results"
}
```

**Call:**

```json
{ "flow": "buy", "environment": "staging", "note": "canary v42" }
```

**Effective command:**

```bash
artillery run \
  --record \
  --name "buy-staging-2026-04-15T00-35-00-000Z" \
  --tags "repo:my-app,owner:Platform,type:buy,env:staging,source:mcp" \
  -e staging \
  --note "canary v42" \
  -o /abs/project/load-test-results/buy-staging-2026-04-15T00-35-00-000Z.json \
  /abs/project/tests/load/buy.yml
```

**Optional fields:**
- `tagTemplates` — `{flow}`, `{env}`, plus any caller-supplied `templateVars` (e.g. `{round}`)
- `outputDir` — relative to project root; if missing, outputs land at project root
- `defaultTags` — merged before templates
- `environments` — if empty, any environment name is accepted

Override on the call side: `name`, `note`, `extraTags`, `outputJson`, `reportHtml`,
`variables`, `overrides`, `record: false`, `validateOnly`, `extraArgs`, `templateVars`.

## Optional feature #2 — Counter-group bucketing (`counterBreakdown`)

When you emit custom counters via `events.emit('counter', 'shop.step.add_item.happy', 1)`,
Artillery aggregates them into `aggregate.counters`. This server returns ALL of
them in `allCounters`. Add `counterGroups` to your config to also get a
pre-bucketed `counterBreakdown` in `parse_results` and `read_artillery_output`
responses — ideal for CI pass/fail views and semantic grouping.

**Config:**

```json
{
  "counterGroups": {
    "name": "shopBreakdown",
    "prefix": "shop.",
    "buckets": [
      { "key": "steps",   "match": "^shop\\.step\\." },
      { "key": "cart",    "match": "^shop\\.cart\\." },
      { "key": "payment", "match": "^shop\\.payment\\." },
      { "key": "flow",    "match": "^shop\\.flow\\." },
      { "key": "other",   "default": true }
    ]
  }
}
```

**Example response (`parse_results`):**

```jsonc
{
  "summary": { "requestsTotal": 1500, "rpsAvg": 25, "latencyMs": { "p95": 850 }, "errors": {} },
  "allCounters": { "shop.step.add_item.happy": 90, "http.requests": 1500, /* ... */ },
  "allRates": { "http.request_rate": 25 },
  "allSummaries": { "http.response_time": { "min": 45, "p99": 1800 } },
  "counterBreakdown": {
    "steps": { "shop.step.add_item.happy": 90, "shop.step.add_item.fail": 2 },
    "cart": { "shop.cart.failure.quantity_update": 1 },
    "payment": {},
    "flow": { "shop.flow.started": 100 },
    "other": {}
  }
}
```

Rules:
- `prefix` (optional) — counters not starting with this string are ignored
- `buckets` — ordered; **first match wins**
- One bucket may have `default: true` — catches everything that didn't match
- Invalid regex → throws at parse time (fix your config)

Without `counterGroups`, the `counterBreakdown` field is simply absent from responses.

## Full config reference

```jsonc
{
  "flows": { "<name>": "<relative yaml path>" },  // enables run_project_lt
  "environments": ["<name>", "..."],              // optional whitelist
  "defaultTags": { "<k>": "<v>" },
  "tagTemplates": ["type:{flow}", "env:{env}"],
  "outputDir": "load-test-results",
  "counterGroups": {                              // enables counterBreakdown
    "name": "<output field name, cosmetic>",
    "prefix": "<optional prefix filter>",
    "buckets": [
      { "key": "<name>", "match": "<regex>" },
      { "key": "<name>", "default": true }
    ]
  }
}
```

## Security

- No network I/O — only spawns the local `artillery` CLI.
- No `eval` / `Function` / dynamic imports.
- No install hooks.
- Dependencies pinned via `package-lock.json` (committed).
- Published with `npm --provenance` (SLSA attestation).

## Roadmap

### Shipped
- [x] **v0.1.1** — Docker image (multi-arch amd64/arm64; Artillery CLI preinstalled)
- [x] **v0.1.2** — `artillery-mcp init` scaffolder + shipped `SKILL.md` agent-guidance template
- [x] **v0.1.3** — hard-fail on unknown CLI args, fix Dockerfile missing `skills/`
- [x] **v0.1.4** — dual-publish to Docker Hub alongside GHCR (for `docker search` discoverability)
- [x] **v0.1.7** — `run_report` tool (JSON → HTML via `artillery report`); listed in MCP Official Registry (`io.github.kosiakMD/artillery-mcp`)

### v0.2 (next)
- [ ] **Artillery Cloud API integration** — `list_recent_runs`, `get_run_details(runUrl)`, `compare_to_baseline(runUrl)`. Requires reverse-engineering the `artilleryio` REST API or partnering with Artillery.io.
- [ ] **Config schema validation on startup** — parse `.artillery-mcp.config.json` through zod with human-readable error messages ("expected 'flows' to be object, got null at line 3"). Fail-fast with pointer to README.
- [ ] **YAML config support** — accept `.artillery-mcp.config.yml` using a tiny bundled YAML parser (keeping deps light).
- [ ] **Playwright Docker variant** — `kosiakmd/artillery-mcp:latest-playwright` with Chromium preinstalled for users with `engine: playwright` scripts. Separate tag to keep base image small.

### v0.3+
- [ ] **Artillery Lambda + Azure ACI tools** — `run_lambda`, `run_aci` for parity with `run_fargate`.
- [ ] **`run_project_lt` matrix mode** — `{"matrix": {"flow": ["free","paid"], "env": ["staging","prod"]}}` → 4 runs in parallel.
- [ ] **Per-flow config overrides** — different `counterGroups` / `defaultTags` / `environments` per flow instead of global.
- [ ] **Streaming intermediate metrics** via MCP progress events so agents see RPS/errors mid-run instead of only at completion.
- [ ] **Built-in presets library** — smoke / baseline / soak / spike selectable via config (not just inline YAML).
- [ ] **Published JSON Schema** at stable URL for IDE autocompletion of `.artillery-mcp.config.json`.
- [ ] **Plugin API for counter-group matchers** beyond regex — e.g. JSONPath, Wasm filter, callback to a user-provided JS.
- [ ] **Structured `run_report` variant** — return extracted summary text alongside the HTML path, so AI agents can skip loading the file.
- [ ] **Smithery support** — add StreamableHTTP transport + hosted deployment once there's enough demand (requires OAuth-style session config for per-user API keys).

### Under consideration
- [ ] **Grafana / Prometheus integration** — push metrics to a user-provided Prometheus endpoint instead of (or in addition to) Artillery Cloud.
- [ ] **Native Artillery Pro support** — enterprise features if users request them.
- [ ] **TUI dashboard** for long-running tests when invoked outside MCP (standalone mode).
- [ ] **Community MCP catalogs** — manual registration on [mcp-get.com](https://mcp-get.com), [PulseMCP](https://www.pulsemcp.com/) for extra discoverability.
- [ ] **Upstream contribution** — offer `read_artillery_output`, `run_fargate`, and `full flag surface` patches back to [`@jch1887/artillery-mcp-server`](https://github.com/jch1887/artillery-mcp-server) as PRs; if merged, this fork becomes a thin config-plugin layer on top.

Issues / feature requests / PRs welcome: [github.com/kosiakMD/artillery-mcp/issues](https://github.com/kosiakMD/artillery-mcp/issues).

Issues and feature requests welcome: [github.com/kosiakMD/artillery-mcp/issues](https://github.com/kosiakMD/artillery-mcp/issues).

## Credits

Forked from [jch1887/artillery-mcp-server](https://github.com/jch1887/artillery-mcp-server)
(MIT). See [NOTICE](./NOTICE) for the list of additions and modifications.

## License

MIT — see [LICENSE](./LICENSE). Both the upstream and this fork's copyright notices must
be preserved in substantial portions of the software.
