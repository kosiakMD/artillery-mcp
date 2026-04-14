import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

/**
 * Wrapper around `McpServer.registerTool` that avoids the TS2589
 * "Type instantiation is excessively deep and possibly infinite" error.
 *
 * Background: MCP SDK 1.23.0 introduced support for both Zod v3 and Zod v4 via
 * a union type `ZodRawShapeCompat | AnySchema` on the `registerTool` generic.
 * That union causes TypeScript's conditional type checker to distribute, which
 * explodes exponentially when the inputSchema object has more than ~5 fields.
 *
 * Upstream fix (GH issue modelcontextprotocol/typescript-sdk#1180) uses
 * `[T] extends [U]` wrapping to prevent distribution but hasn't landed in a
 * published release as of 1.29.0.
 *
 * Our workaround: a narrowly-typed helper. Callers get proper types on
 * `inputSchema` (z.ZodRawShape) and on the handler args. The internal call to
 * `registerTool` is routed through a single `any` cast that is isolated to
 * this file — everywhere else stays type-safe.
 *
 * Remove this helper and call `mcpServer.registerTool` directly once the
 * upstream fix is released.
 */
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

export function registerTool(
  mcpServer: McpServer,
  name: string,
  config: { description: string; inputSchema: z.ZodRawShape },
  handler: ToolHandler
): void {
  // The SDK's registerTool generic distributes over ZodRawShapeCompat | AnySchema
  // and blows up tsc memory/time. Isolate the cast here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mcpServer.registerTool as any)(name, config, handler);
}
