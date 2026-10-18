#!/usr/bin/env node
/**
 * Read-only aggregate of rejection-gate log lines.
 *
 * stdout is aggregate JSON. The process drops each log line after reading
 * topScore, so query text, searchId, and memory ids never leave the parser.
 *
 * npm run quality:rejection-gate-log-stats
 * Pipe gate log lines on stdin. An empty stdin (npm script, closed pipe)
 * falls back to `docker logs` for MEMENTO_REJECTION_LOG_CONTAINER
 * (default memento-memento-mcp-server-1).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isMain } from './lib/cli-runtime.js';

/** Keep equal to DEFAULT_RELEVANCE_GATE_THRESHOLD (#1387). */
export const DEFAULT_STATS_THRESHOLD = 0.4;

/** Band from the #1387 false-rejection count. Independent of the live threshold. */
export const MEASURED_BAND_LOW = 0.4;
export const MEASURED_BAND_HIGH = 0.5;

export const DEFAULT_LOG_CONTAINER = 'memento-memento-mcp-server-1';

const USAGE = 'npm run quality:rejection-gate-log-stats [--threshold 0.4]';
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REJECT_MARK = '기각 게이트: 질의 기각';
const FAIL_OPEN_MARK = '기각 게이트: 점수 없음 통과';
const PASS_MARK = '기각 게이트: 통과';
const TOP_SCORE_RE = /"topScore"\s*:\s*(null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

export function resolveLogContainer(raw = process.env.MEMENTO_REJECTION_LOG_CONTAINER) {
  const name = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_LOG_CONTAINER;
  if (!CONTAINER_NAME.test(name)) return null;
  return name;
}

function createState(threshold) {
  return {
    threshold,
    reject: 0,
    pass: 0,
    failOpen: 0,
    rejectMissingTopScore: 0,
    rejectScores: [],
  };
}

function classify(line) {
  if (line.includes(REJECT_MARK)) return 'reject';
  if (line.includes(FAIL_OPEN_MARK)) return 'failOpen';
  if (line.includes(PASS_MARK)) return 'pass';
  return null;
}

function extractTopScore(line) {
  const match = TOP_SCORE_RE.exec(line);
  if (!match || match[1] === 'null') return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function ingestLine(state, line) {
  const kind = classify(line);
  if (kind === null) return;
  if (kind === 'failOpen') {
    state.failOpen += 1;
    return;
  }
  if (kind === 'pass') {
    state.pass += 1;
    return;
  }
  state.reject += 1;
  const topScore = extractTopScore(line);
  if (topScore === null) {
    state.rejectMissingTopScore += 1;
    return;
  }
  state.rejectScores.push(topScore);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function countBand(scores, low, high) {
  let count = 0;
  for (const score of scores) {
    if (score >= low && score < high) count += 1;
  }
  return count;
}

function finalize(state) {
  const scores = state.rejectScores.sort((a, b) => a - b);
  return {
    threshold: state.threshold,
    interval: 'half-open',
    counts: {
      reject: state.reject,
      pass: state.pass,
      failOpen: state.failOpen,
      rejectMissingTopScore: state.rejectMissingTopScore,
    },
    rejectTopScore: {
      n: scores.length,
      min: scores[0] ?? null,
      p50: percentile(scores, 0.5),
      p90: percentile(scores, 0.9),
      p95: percentile(scores, 0.95),
      max: scores.at(-1) ?? null,
      method: 'nearest-rank',
    },
    bands: {
      measured04to05: {
        low: MEASURED_BAND_LOW,
        high: MEASURED_BAND_HIGH,
        rejectCount: countBand(scores, MEASURED_BAND_LOW, MEASURED_BAND_HIGH),
      },
      from04UntilThreshold: {
        low: MEASURED_BAND_LOW,
        high: state.threshold,
        rejectCount: countBand(scores, MEASURED_BAND_LOW, state.threshold),
      },
    },
  };
}

export function summarizeGateText(text, threshold = DEFAULT_STATS_THRESHOLD) {
  const state = createState(threshold);
  for (const line of String(text).split(/\r?\n/)) ingestLine(state, line);
  return finalize(state);
}

async function consume(stream, state) {
  if (!stream) return;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) ingestLine(state, line);
}

function readDockerLogs(container, threshold) {
  const state = createState(threshold);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (summary) => {
      if (settled) return;
      settled = true;
      resolve(summary);
    };
    const child = spawn('docker', ['logs', container], { stdio: ['ignore', 'pipe', 'pipe'] });
    const jobs = [consume(child.stdout, state), consume(child.stderr, state)];
    child.once('error', () => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null);
    });
    child.once('close', (code) => {
      Promise.all(jobs).then(
        () => finish(code === 0 ? finalize(state) : null),
        () => finish(null),
      );
    });
  });
}

function readThreshold(argv) {
  const flag = argv.indexOf('--threshold');
  if (flag === -1) return DEFAULT_STATS_THRESHOLD;
  const raw = argv[flag + 1];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }
  const threshold = readThreshold(argv);
  if (threshold === null) {
    writeJson({ error: 'invalid_threshold' });
    return 1;
  }
  // npm/scripts leave stdin as a closed empty pipe (not a TTY). Prefer piped
  // logs when they contain gate lines; otherwise fall back to docker logs.
  if (process.stdin.isTTY !== true) {
    const state = createState(threshold);
    await consume(process.stdin, state);
    if (state.reject + state.pass + state.failOpen > 0) {
      writeJson(finalize(state));
      return 0;
    }
  }
  const container = resolveLogContainer();
  if (container === null) {
    writeJson({ error: 'invalid_container_name' });
    return 1;
  }
  const summary = await readDockerLogs(container, threshold);
  if (summary === null) {
    writeJson({ error: 'docker_logs_failed' });
    return 1;
  }
  writeJson(summary);
  return 0;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      writeJson({ error: 'log_read_failed' });
      process.exitCode = 1;
    },
  );
}
