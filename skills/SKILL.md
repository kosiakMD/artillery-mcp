---
name: artillery-mcp
description: Use when running, parsing, or comparing Artillery load tests via the @kosiakmd/artillery-mcp MCP server. Covers flow launching, result bucketing, Fargate dispatch, and raw-text dump parsing.
---

# Artillery MCP — Agent Skill

Guidance for AI agents using the `@kosiakmd/artillery-mcp` MCP server. This file belongs at `.ai/skills/artillery-mcp/SKILL.md` in your project. If you don't have it yet, run `npx @kosiakmd/artillery-mcp init`.

## Decision tree — which tool to call

| I want to... | Tool |
|---|---|
| Run a known flow with project conventions (tags, output path) | `run_project_lt` (requires `.artillery-mcp.config.json` with `flows`) |
| Run a specific Artillery YAML with full flag control | `run_test_from_file` |
| Quickly hit a URL without writing a config | `quick_test` |
| Launch an LT on AWS ECS/Fargate | `run_fargate` |
| Parse an existing Artillery JSON report | `parse_results` |
| Parse a saved `artillery-output.txt` (no JSON available) | `read_artillery_output` |
| Compare two runs for regression | `compare_results` |
| Generate a config interactively via wizard | `wizard_start` → `wizard_step` → `wizard_finalize` |

## Configuration — `.artillery-mcp.config.json`

Enables `run_project_lt` and `counterBreakdown` output. Auto-discovered via:
1. `ARTILLERY_MCP_CONFIG` env var (absolute path)
2. Walk-up from cwd for `.artillery-mcp.config.json`
3. Absent → opt-in features stay off, base 17 tools still work

Minimum config for the project launcher:

```json
{
  "flows": { "smoke": "tests/load/smoke.yml" },
  "environments": ["local", "staging", "prod"],
  "defaultTags": { "repo": "my-app" },
  "tagTemplates": ["type:{flow}", "env:{env}"],
  "outputDir": "load-test-results"
}
```

Optional counter grouping (adds `counterBreakdown` field on parse_results / read_artillery_output responses):

```json
"counterGroups": {
  "prefix": "checkout.",
  "buckets": [
    { "key": "steps", "match": "^checkout\\.step\\." },
    { "key": "other", "default": true }
  ]
}
```

First-match-wins across buckets. Any bucket may set `"default": true` for fallback.

## Common call patterns

### Run a known flow with auto-tagging (config present)

```json
{
  "tool": "run_project_lt",
  "arguments": {
    "flow": "combined",
    "environment": "staging",
    "note": "canary release v42",
    "extraTags": "round:22,feature:wallet-cache",
    "templateVars": { "round": "22" }
  }
}
```

Returns `{ exitCode, elapsedMs, logsTail, jsonResultPath, summary, command, tags, configPath }`. The `command` string is the exact `artillery run ...` that was executed — useful for pasting into issues.

### Run an arbitrary YAML with Cloud recording

```json
{
  "tool": "run_test_from_file",
  "arguments": {
    "path": "/abs/path/to/my-test.yml",
    "outputJson": "/abs/path/to/results.json",
    "record": true,
    "tags": "repo:my-app,type:soak",
    "name": "my-app soak 2026-04-15",
    "environment": "staging"
  }
}
```

`--record` requires `ARTILLERY_CLOUD_API_KEY` in env — the MCP passes it through to the spawned CLI.

### Parse results + pick out counter buckets

```json
{
  "tool": "parse_results",
  "arguments": { "jsonPath": "/abs/path/to/results.json" }
}
```

Returns: `summary` (http.* stats), `allCounters` (every counter verbatim), `allRates`, `allSummaries` (nested percentile metrics), and — if config has `counterGroups` — `counterBreakdown` with one field per bucket.

### Read a text dump from CI (no JSON available)

```json
{
  "tool": "read_artillery_output",
  "arguments": {
    "path": "/abs/path/to/artillery-output.txt",
    "block": "summary",
    "maxBytes": 65536
  }
}
```

`block: "summary"` parses the last `Summary report` section only (default). `"full"` parses the whole file. `maxBytes` caps the returned `rawText` but parsing sees the full file.

### Compare two runs for regression

```json
{
  "tool": "compare_results",
  "arguments": {
    "baselinePath": "/abs/path/to/baseline.json",
    "currentPath": "/abs/path/to/current.json",
    "thresholds": {
      "maxLatencyIncrease": 0.2,
      "maxErrorRateIncrease": 0.01,
      "minThroughputRatio": 0.9
    }
  }
}
```

## Gotchas

- **Absolute paths required** for `parse_results` and `read_artillery_output`. Relative paths throw.
- **No `--dry-run` in Artillery 2.x.** `validateOnly: true` on `run_test_from_file` does a client-side YAML structural check (top-level `config:` + `scenarios:`).
- **`artillery run` has no `--report` flag.** If you pass `reportHtml`, the MCP runs `artillery report <outputJson>` AFTER the run. Requires `outputJson` also set.
- **Config must be valid JSON.** YAML configs throw until v0.2. Keep the file at repo root (walk-up discovery) or point `ARTILLERY_MCP_CONFIG` at any absolute path.
- **Workdir writability.** `save_config` / `list_configs` / `get_config` / `delete_config` / `run_saved_config` write under `${ARTILLERY_WORKDIR}/saved-configs/`. If workdir is read-only (Docker `:ro` mount), these 5 tools return errors; the other 13 still work.
- **Fargate needs AWS creds** in env (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` or instance profile) AND a pre-configured `artilleryio-cluster` ECS cluster in the target region.
- **`run_project_lt` is not registered** unless the config has `flows` with ≥1 entry.

## When NOT to use MCP

- **Small ad-hoc curl-style test** — just call the HTTP endpoint directly, don't spin up artillery.
- **Debugging artillery itself** — run `artillery` CLI directly so you see stderr in your terminal instead of piped through MCP JSON-RPC.
- **Heavily custom CI scripting** — for bespoke workflows, shell out to `artillery` from your CI YAML. MCP is for interactive agent-driven work and ad-hoc analysis.

## References

- Package README: https://github.com/kosiakMD/artillery-mcp
- Config schema (planned v0.2): `https://raw.githubusercontent.com/kosiakMD/artillery-mcp/main/schemas/config.schema.json`
- Artillery 2.x docs: https://www.artillery.io/docs
