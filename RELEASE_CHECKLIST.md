# Release Checklist

`npm publish` and `docker push` are effectively irreversible — deprecate is possible, unpublish is only within 72 hours and only if no dependents. Verify the packaged artifact (not just `dist/`) before tagging.

## Before `git tag vX.Y.Z`

```bash
# 1. Clean build + tests
npm ci && npm run build && npm run test:run

# 2. Pack the real tarball (same content npm will upload)
npm pack  # → kosiakmd-artillery-mcp-X.Y.Z.tgz

# 3. Inspect tarball contents — no stray files, nothing essential missing
tar -tzf kosiakmd-artillery-mcp-*.tgz | sort

# 4. Install into a clean dir and smoke every public entry point
TESTDIR=$(mktemp -d)
cd "$TESTDIR" && npm init -y --silent
npm install /path/to/kosiakmd-artillery-mcp-X.Y.Z.tgz

npx artillery-mcp --help
npx artillery-mcp init
ls -la .ai/skills/artillery-mcp/SKILL.md .artillery-mcp.config.json

# JSON-RPC stdio smoke
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx artillery-mcp 2>/dev/null | head -2

# 5. Docker locally (if Dockerfile changed)
docker build -t artillery-mcp:test .
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | docker run -i --init --rm artillery-mcp:test 2>/dev/null | head -2

# 6. Only now tag + push
npm version patch  # or minor / major
git push --follow-tags
```

## Reversibility cheatsheet

| Artifact | Reversible? |
|---|---|
| git commit | force-push while no one depends |
| git tag | `git push --delete origin vX.Y.Z` while no Release/consumers |
| GitHub Release | delete via UI/API |
| npm version | **72h window for `npm unpublish`**, then deprecate + new patch |
| GHCR image | delete, but pulled caches persist in users' environments |
| npm SLSA provenance | permanent, tied to version |

## When to skip the checklist

Never. Even a patch bump can ship a regressed `files` array that omits `dist/` or `skills/`. The tarball check takes 30 s.
