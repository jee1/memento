import { AgentIntegrationError } from '@memento/core';
import type { PersistedAgentEventInput } from '@memento/core';
import type { CaptureReason } from '@memento/agent-integration';
import type { Response } from 'express';
import { AgentTranscriptImportError } from './agent-transcript-import.js';

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentIntegrationError(`${name} is required`, 'INVALID_ENVELOPE', 400);
  }
  return value.trim();
}

export function statusForValidationReason(reason: CaptureReason): number {
  if (reason === 'UNSUPPORTED_CONTRACT_VERSION' || reason === 'UNSUPPORTED_EVENT_TYPE') {
    return 422;
  }
  return 400;
}

export function parsePayload(prepared: PersistedAgentEventInput): Record<string, unknown> {
  if (!prepared.payloadJson) return {};
  try {
    const parsed: unknown = JSON.parse(prepared.payloadJson);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function writeError(res: Response, error: unknown): Response {
  if (error instanceof AgentIntegrationError) {
    return res.status(error.httpStatus).json({
      status: error.httpStatus,
      reason_code: error.reasonCode,
      message: error.message,
      retryable: error.retryable,
      ...(error instanceof AgentTranscriptImportError && error.line
        ? { line: error.line }
        : {}),
    });
  }
  return res.status(500).json({
    status: 500,
    reason_code: 'INTERNAL_ERROR',
    message: 'Agent integration request failed',
    retryable: false,
  });
}

export function safeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, index)]!;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function boundedStatusLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 20;
}

export function boundedStatusSince(value: unknown, now = new Date()): string {
  const maximumWindowMs = 7 * 24 * 60 * 60 * 1_000;
  const fallback = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  if (typeof value !== 'string') return fallback.toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed > now) return fallback.toISOString();
  return new Date(Math.max(parsed.getTime(), now.getTime() - maximumWindowMs)).toISOString();
}

export function safeTelemetrySessionId(extraData: string | null): string | null {
  try {
    const parsed = JSON.parse(extraData ?? '{}') as Record<string, unknown>;
    return typeof parsed.session_id === 'string' ? parsed.session_id : null;
  } catch {
    return null;
  }
}
