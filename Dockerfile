# syntax=docker/dockerfile:1.7
# @kosiakmd/artillery-mcp — MCP server for Artillery 2.x
# https://github.com/kosiakMD/artillery-mcp

FROM node:22-alpine AS base

# artillery = the load-test CLI the MCP server spawns.
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD avoids pulling ~1 GB of Chromium for users
# who only run HTTP tests. If you need the Playwright engine, extend this image:
#   FROM ghcr.io/kosiakmd/artillery-mcp:latest
#   RUN apk add --no-cache chromium && npx playwright install-deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g --prefer-offline --no-audit --no-fund artillery@^2 \
 && npm cache clean --force

WORKDIR /app

# Install runtime deps separately from source → better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund \
 && npm cache clean --force

# Ship the compiled JS + examples + agent skill + metadata (mirrors npm package files)
COPY dist/ ./dist/
COPY examples/ ./examples/
COPY skills/ ./skills/
COPY README.md LICENSE NOTICE ./

# Users mount their project (with .artillery-mcp.config.json at root) here.
WORKDIR /workspace
ENV ARTILLERY_WORKDIR=/workspace

# MCP speaks JSON-RPC over stdio. Run with `docker run --init -i --rm ...` so the
# Docker-managed init reaps the Node process on stdin close / SIGTERM.
ENTRYPOINT ["node", "/app/dist/server.js"]
