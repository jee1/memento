#!/usr/bin/env node
/** Offline weekly recall sampling; accepts references, never query or memory text. */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid shape');
}

function utc(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid UTC');
  return time;
}

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    seed: { type: 'string' },
  } });
  const seed = values.seed ?? randomBytes(32).toString('hex');
  if (!values.input || !/^[a-f0-9]{64}$/.test(seed)) throw new Error('Invalid arguments');
  const bytes = readFileSync(values.input);
  const frame = JSON.parse(bytes.toString('utf8'));
  exactKeys(frame, ['period_start', 'period_end', 'frame_complete', 'requests']);
  const start = utc(frame.period_start);
  const end = utc(frame.period_end);
  if (end - start !== 7 * 24 * 60 * 60 * 1000 || frame.frame_complete !== true
    || !Array.isArray(frame.requests)) throw new Error('Incomplete weekly frame');
  const seen = new Set();
  const eligible = [];
  for (const row of frame.requests) {
    exactKeys(row, ['request_id', 'occurred_at', 'privacy_scope']);
    const time = utc(row.occurred_at);
    if (typeof row.request_id !== 'string' || !row.request_id.trim() || seen.has(row.request_id)
      || !['private', 'team', 'public'].includes(row.privacy_scope)) throw new Error('Invalid request');
    seen.add(row.request_id);
    if (row.privacy_scope === 'private' && time >= start && time < end) eligible.push(row);
  }
  // Same hash-order sampling as sample-relations-jev; a fresh seed is drawn before review.
  const ordered = eligible.map(row => ({
    request_sha256: sha256(row.request_id),
    order: createHmac('sha256', Buffer.from(seed, 'hex')).update(row.request_id).digest('hex'),
  })).sort((a, b) => a.order.localeCompare(b.order) || a.request_sha256.localeCompare(b.request_sha256));
  const samples = ordered.slice(0, 5).map(({ request_sha256 }) => ({ request_sha256 }));
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    label_source: 'agent_panel',
    panel_status: 'pending',
    sample_origin: 'weekly_random',
    period_start: frame.period_start,
    period_end: frame.period_end,
    frame_sha256: sha256(bytes),
    runner_sha256: sha256(readFileSync(new URL(import.meta.url))),
    seed,
    eligible_count: eligible.length,
    requested_sample_size: 5,
    sample_count: samples.length,
    shortfall: 5 - samples.length,
    samples,
  }, null, 2)}\n`);
} catch {
  process.stderr.write('Recall audit failed: supply --input with a complete seven-day metadata frame and optional --seed (64 lowercase hex). See docs/guides/ko/recall-audit.md.\n');
  process.exitCode = 1;
}
