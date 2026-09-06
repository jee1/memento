/**
 * Multi-family log rotation orchestrator for the log_rotation batch job (#852).
 */

import fs from 'fs/promises';
import { basename, resolve, sep } from 'path';
import { DAY_MS } from '../../shared/utils/date.js';
import {
  resolveLogRotationPolicies,
  type LogRotationPolicies,
} from './log-rotation-policies.js';
import {
  resolveLogRotationRoots,
  type LogRotationRoots,
} from './log-rotation-paths.js';

export type LogFamilyId =
  | 'triple_extraction'
  | 'migration'
  | 'docker_diagnostics'
  | 'log_issue_monitor';

export interface FamilyRotationResult {
  family: LogFamilyId;
  deletedCount: number;
  reclaimedBytes: number;
  skippedMissingRoot?: boolean;
  warnings: string[];
}

export interface LogRotationReport {
  families: FamilyRotationResult[];
  deletedCount: number;
  reclaimedBytes: number;
  warnings: string[];
  policies: LogRotationPolicies;
}

export interface RotateLogsOptions {
  roots?: Partial<LogRotationRoots>;
  policies?: Partial<LogRotationPolicies>;
  now?: Date;
}

const MIGRATION_LOG_RE = /^migration_.*\.log$/;

/** Ensure join(root, name) stays under root (no validateFilePath('logs') for abs ~/.memento). */
function safePathUnderRoot(root: string, name: string): string | null {
  if (name === '' || name === '.' || name === '..') {
    return null;
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return null;
  }
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, name);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (candidate !== resolvedRoot && !candidate.startsWith(rootPrefix)) {
    return null;
  }
  return candidate;
}

function warn(family: LogFamilyId, fileBasename: string, detail: string): string {
  return `${family}:${fileBasename}:${detail}`;
}

async function pathExists(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function rotateMigration(
  root: string,
  keepCount: number
): Promise<FamilyRotationResult> {
  const family: LogFamilyId = 'migration';
  const warnings: string[] = [];
  if (!(await pathExists(root))) {
    return { family, deletedCount: 0, reclaimedBytes: 0, skippedMissingRoot: true, warnings };
  }

  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    warnings.push(warn(family, basename(root), 'readdir-failed'));
    return { family, deletedCount: 0, reclaimedBytes: 0, warnings };
  }

  const matched: Array<{ name: string; mtimeMs: number; size: number }> = [];
  for (const name of names) {
    if (!MIGRATION_LOG_RE.test(name)) {
      continue;
    }
    const filePath = safePathUnderRoot(root, name);
    if (filePath === null) {
      warnings.push(warn(family, name, 'path-unsafe'));
      continue;
    }
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) {
        continue;
      }
      matched.push({ name, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      warnings.push(warn(family, name, 'stat-failed'));
    }
  }

  // Newest first; basename ASC tie-break
  matched.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  const surplus =
    keepCount <= 0 ? [] : matched.slice(Math.max(0, keepCount));

  let deletedCount = 0;
  let reclaimedBytes = 0;
  for (const entry of surplus) {
    const filePath = safePathUnderRoot(root, entry.name);
    if (filePath === null) {
      continue;
    }
    try {
      await fs.unlink(filePath);
      deletedCount += 1;
      reclaimedBytes += entry.size;
    } catch {
      warnings.push(warn(family, entry.name, 'unlink-failed'));
    }
  }

  return { family, deletedCount, reclaimedBytes, warnings };
}

async function rotateDockerDiagnostics(
  root: string,
  maxTotalBytes: number
): Promise<FamilyRotationResult> {
  const family: LogFamilyId = 'docker_diagnostics';
  const warnings: string[] = [];
  if (!(await pathExists(root))) {
    return { family, deletedCount: 0, reclaimedBytes: 0, skippedMissingRoot: true, warnings };
  }

  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    warnings.push(warn(family, basename(root), 'readdir-failed'));
    return { family, deletedCount: 0, reclaimedBytes: 0, warnings };
  }

  const files: Array<{ name: string; mtimeMs: number; size: number }> = [];
  for (const name of names) {
    const filePath = safePathUnderRoot(root, name);
    if (filePath === null) {
      warnings.push(warn(family, name, 'path-unsafe'));
      continue;
    }
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) {
        continue;
      }
      files.push({ name, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      warnings.push(warn(family, name, 'stat-failed'));
    }
  }

  // Oldest first for deletion candidates
  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));

  let total = files.reduce((sum, f) => sum + f.size, 0);
  let deletedCount = 0;
  let reclaimedBytes = 0;
  let remaining = files.length;

  for (const entry of files) {
    if (total <= maxTotalBytes || remaining <= 1) {
      break;
    }
    const filePath = safePathUnderRoot(root, entry.name);
    if (filePath === null) {
      continue;
    }
    try {
      await fs.unlink(filePath);
      deletedCount += 1;
      reclaimedBytes += entry.size;
      total -= entry.size;
      remaining -= 1;
    } catch {
      warnings.push(warn(family, entry.name, 'unlink-failed'));
    }
  }

  return { family, deletedCount, reclaimedBytes, warnings };
}

async function rotateLogIssueMonitor(
  root: string,
  maxJsonlBytes: number
): Promise<FamilyRotationResult> {
  const family: LogFamilyId = 'log_issue_monitor';
  const warnings: string[] = [];
  if (!(await pathExists(root))) {
    return { family, deletedCount: 0, reclaimedBytes: 0, skippedMissingRoot: true, warnings };
  }

  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    warnings.push(warn(family, basename(root), 'readdir-failed'));
    return { family, deletedCount: 0, reclaimedBytes: 0, warnings };
  }

  let deletedCount = 0;
  let reclaimedBytes = 0;

  for (const name of names) {
    if (name === 'state.json') {
      continue;
    }
    if (!name.endsWith('.jsonl')) {
      continue;
    }
    const filePath = safePathUnderRoot(root, name);
    if (filePath === null) {
      warnings.push(warn(family, name, 'path-unsafe'));
      continue;
    }
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile() || st.size <= maxJsonlBytes) {
        continue;
      }
      const fh = await fs.open(filePath, 'r');
      let tail: Buffer;
      try {
        tail = Buffer.alloc(maxJsonlBytes);
        await fh.read(tail, 0, maxJsonlBytes, st.size - maxJsonlBytes);
      } finally {
        await fh.close();
      }
      await fs.writeFile(filePath, tail);
      deletedCount += 1;
      reclaimedBytes += st.size - maxJsonlBytes;
    } catch {
      warnings.push(warn(family, name, 'trim-failed'));
    }
  }

  return { family, deletedCount, reclaimedBytes, warnings };
}

async function rotateTripleExtraction(
  root: string,
  retentionDays: number,
  nowMs: number
): Promise<FamilyRotationResult> {
  const family: LogFamilyId = 'triple_extraction';
  const warnings: string[] = [];
  if (!(await pathExists(root))) {
    return { family, deletedCount: 0, reclaimedBytes: 0, skippedMissingRoot: true, warnings };
  }

  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    warnings.push(warn(family, basename(root), 'readdir-failed'));
    return { family, deletedCount: 0, reclaimedBytes: 0, warnings };
  }

  const retentionMs = retentionDays * DAY_MS;
  let deletedCount = 0;
  let reclaimedBytes = 0;

  for (const name of names) {
    if (!name.endsWith('.log')) {
      continue;
    }
    const filePath = safePathUnderRoot(root, name);
    if (filePath === null) {
      warnings.push(warn(family, name, 'path-unsafe'));
      continue;
    }
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) {
        continue;
      }
      if (nowMs - st.mtimeMs <= retentionMs) {
        continue;
      }
      await fs.unlink(filePath);
      deletedCount += 1;
      reclaimedBytes += st.size;
    } catch {
      warnings.push(warn(family, name, 'unlink-failed'));
    }
  }

  return { family, deletedCount, reclaimedBytes, warnings };
}

export async function rotateLogs(options: RotateLogsOptions = {}): Promise<LogRotationReport> {
  const policies = resolveLogRotationPolicies(options.policies);
  const roots = resolveLogRotationRoots(options.roots);
  const nowMs = (options.now ?? new Date()).getTime();

  const families: FamilyRotationResult[] = [
    await rotateMigration(roots.migrationLogDir, policies.migrationKeepCount),
    await rotateDockerDiagnostics(
      roots.dockerDiagnosticsDir,
      policies.dockerDiagnosticsMaxBytes
    ),
    await rotateLogIssueMonitor(roots.logIssueMonitorDir, policies.monitorJsonlMaxBytes),
    await rotateTripleExtraction(
      roots.tripleExtractionLogDir,
      policies.tripleExtractionDays,
      nowMs
    ),
  ];

  const deletedCount = families.reduce((sum, f) => sum + f.deletedCount, 0);
  const reclaimedBytes = families.reduce((sum, f) => sum + f.reclaimedBytes, 0);
  const warnings = families.flatMap(f => f.warnings);

  return {
    families,
    deletedCount,
    reclaimedBytes,
    warnings,
    policies,
  };
}
