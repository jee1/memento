import { createHash } from 'node:crypto';
import type { AgentEventEnvelope, AgentEventType } from './types.js';

function normalizeJson(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_PAYLOAD');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('INVALID_PAYLOAD');
    seen.add(value);
    const normalized = value.map((item) => normalizeJson(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) throw new Error('INVALID_PAYLOAD');
    seen.add(value);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) normalized[key] = normalizeJson(item, seen);
    }
    seen.delete(value);
    return normalized;
  }
  throw new Error('INVALID_PAYLOAD');
}

export function canonicalize(value: unknown): {
  json: string;
  sha256: string;
  bytes: number;
} {
  const json = JSON.stringify(normalizeJson(value, new Set()));
  if (json === undefined) throw new Error('INVALID_PAYLOAD');
  return {
    json,
    sha256: createHash('sha256').update(json).digest('hex'),
    bytes: Buffer.byteLength(json, 'utf8'),
  };
}

export function normalizeAgentEvent<TType extends AgentEventType>(
  event: AgentEventEnvelope<TType>,
): AgentEventEnvelope<TType> {
  const normalized = normalizeJson(event, new Set()) as AgentEventEnvelope<TType>;
  return {
    ...normalized,
    event_id: normalized.event_id.trim(),
    adapter_name: normalized.adapter_name.trim(),
    adapter_version: normalized.adapter_version.trim(),
    session_id: normalized.session_id.trim(),
    scope: Object.fromEntries(
      Object.entries(normalized.scope)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, value]) => [key, value.trim()]),
    ),
  };
}
