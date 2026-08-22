#!/usr/bin/env node
import { isMain } from './lib/cli.js';

/**
 * Measures how much client context the MCP tool definitions occupy (#769).
 *
 * The number that matters is the serialized `tools/list` payload: every MCP host
 * keeps it in the prompt for the whole session. Token counts are estimated as
 * bytes/4, which is the usual rule of thumb for English JSON — the absolute value
 * matters less than the before/after ratio, and the method is stated so the two
 * runs stay comparable.
 */

import { getExposedTools, getToolRegistry, type ToolsetMode } from '@memento/core';

const BYTES_PER_TOKEN = 4;

export interface ToolSurfaceEntry {
  name: string;
  bytes: number;
  estimated_tokens: number;
}

export interface ToolSurfaceReport {
  toolset: ToolsetMode;
  tool_count: number;
  total_bytes: number;
  estimated_tokens: number;
  tools: ToolSurfaceEntry[];
}

/** Serializes exactly what a `tools/list` response carries: name, description, schema. */
export function serializeToolListing(toolset: ToolsetMode): string {
  return JSON.stringify(getExposedTools(toolset).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })));
}

export function measureToolSurface(toolset: ToolsetMode): ToolSurfaceReport {
  const tools = getExposedTools(toolset).map((tool) => {
    const bytes = Buffer.byteLength(JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }), 'utf8');
    return {
      name: tool.name,
      bytes,
      estimated_tokens: Math.round(bytes / BYTES_PER_TOKEN),
    };
  });
  const totalBytes = Buffer.byteLength(serializeToolListing(toolset), 'utf8');
  return {
    toolset,
    tool_count: tools.length,
    total_bytes: totalBytes,
    estimated_tokens: Math.round(totalBytes / BYTES_PER_TOKEN),
    tools: tools.sort((a, b) => b.bytes - a.bytes),
  };
}

function main(): void {
  const full = measureToolSurface('full');
  const core = measureToolSurface('core');
  const reduction = 1 - core.total_bytes / full.total_bytes;

  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    method: 'JSON.stringify of name/description/inputSchema; tokens estimated as bytes/4',
    registered_tool_count: getToolRegistry().getAll().length,
    full,
    core,
    reduction_ratio: Number(reduction.toFixed(4)),
  }, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  main();
}
