/**
 * JSONL memory export/import (Issue #668).
 */

import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { MEMENTO_LATEST_SCHEMA_VERSION } from '../../../shared/constants/schema-version.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { SchemaVersionManager } from '../../../infrastructure/database/sqlite/migration/schema-version-manager.js';

export const MEMORY_JSONL_FORMAT_VERSION = 1;

export type MemoryJsonlRecordType = 'memory_item' | 'memory_relation';

export interface MemoryJsonlManifest {
  type: 'manifest';
  format_version: number;
  schema_version: string;
  exported_at: string;
  include_relations: boolean;
  record_counts: {
    memory_item: number;
    memory_relation: number;
  };
  checksum: string;
}

export interface MemoryJsonlRecord {
  type: MemoryJsonlRecordType;
  row: Record<string, unknown>;
}

export interface MemoryExportOptions {
  includeRelations?: boolean;
}

export interface MemoryImportOptions {
  /** When true, accept exports from older schema versions (warn only). */
  allowLegacySchema?: boolean;
}

export interface MemoryImportResult {
  memoryItems: number;
  memoryRelations: number;
  schemaVersion: string;
}

export class MemoryJsonlSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryJsonlSchemaError';
  }
}

export class MemoryJsonlChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryJsonlChecksumError';
  }
}

function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

function buildInsertStatement(table: string, columns: string[]): string {
  const placeholders = columns.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}

export async function resolveExportSchemaVersion(db: Database.Database): Promise<string> {
  const manager = new SchemaVersionManager(db);
  const current = await manager.getCurrentVersion();
  return current ?? MEMENTO_LATEST_SCHEMA_VERSION;
}

export function buildMemoryJsonlContent(
  db: Database.Database,
  options: MemoryExportOptions = {},
  schemaVersion: string = MEMENTO_LATEST_SCHEMA_VERSION,
): string {
  const includeRelations = options.includeRelations ?? false;

  const memoryColumns = tableColumns(db, 'memory_item');
  const memoryRows = DatabaseUtils.all(
    db,
    `SELECT ${memoryColumns.join(', ')} FROM memory_item ORDER BY id ASC`,
  ) as Record<string, unknown>[];

  const records: MemoryJsonlRecord[] = memoryRows.map(row => ({
    type: 'memory_item',
    row,
  }));

  let relationCount = 0;
  if (includeRelations) {
    const relationColumns = tableColumns(db, 'memory_relation');
    const relationRows = DatabaseUtils.all(
      db,
      `SELECT ${relationColumns.join(', ')} FROM memory_relation ORDER BY id ASC`,
    ) as Record<string, unknown>[];
    relationCount = relationRows.length;
    for (const row of relationRows) {
      records.push({ type: 'memory_relation', row });
    }
  }

  const recordLines = records.map(r => JSON.stringify(r));
  const checksum = createHash('sha256').update(recordLines.join('\n')).digest('hex');

  const manifest: MemoryJsonlManifest = {
    type: 'manifest',
    format_version: MEMORY_JSONL_FORMAT_VERSION,
    schema_version: schemaVersion,
    exported_at: new Date().toISOString(),
    include_relations: includeRelations,
    record_counts: {
      memory_item: memoryRows.length,
      memory_relation: relationCount,
    },
    checksum,
  };

  return [JSON.stringify(manifest), ...recordLines].join('\n') + (records.length > 0 ? '\n' : '');
}

export async function exportMemoryJsonl(
  db: Database.Database,
  options: MemoryExportOptions = {},
): Promise<string> {
  const schemaVersion = await resolveExportSchemaVersion(db);
  return buildMemoryJsonlContent(db, options, schemaVersion);
}

export function exportMemoryJsonlSync(
  db: Database.Database,
  options: MemoryExportOptions = {},
): string {
  return buildMemoryJsonlContent(db, options, MEMENTO_LATEST_SCHEMA_VERSION);
}

export function parseMemoryJsonl(content: string): {
  manifest: MemoryJsonlManifest;
  records: MemoryJsonlRecord[];
} {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('JSONL file is empty');
  }

  const manifest = JSON.parse(lines[0]!) as MemoryJsonlManifest;
  if (manifest.type !== 'manifest') {
    throw new Error('First line must be a manifest record');
  }

  const records = lines.slice(1).map((line, index) => {
    try {
      return JSON.parse(line) as MemoryJsonlRecord;
    } catch {
      throw new Error(`Invalid JSON on line ${index + 2}`);
    }
  });

  return { manifest, records };
}

function validateManifest(
  manifest: MemoryJsonlManifest,
  records: MemoryJsonlRecord[],
  options: MemoryImportOptions,
): void {
  if (manifest.format_version !== MEMORY_JSONL_FORMAT_VERSION) {
    throw new MemoryJsonlSchemaError(
      `Unsupported format_version ${manifest.format_version}; expected ${MEMORY_JSONL_FORMAT_VERSION}`,
    );
  }

  if (
    manifest.schema_version !== MEMENTO_LATEST_SCHEMA_VERSION &&
    !options.allowLegacySchema
  ) {
    throw new MemoryJsonlSchemaError(
      `Unsupported schema_version ${manifest.schema_version}; expected ${MEMENTO_LATEST_SCHEMA_VERSION}`,
    );
  }

  const recordLines = records.map(r => JSON.stringify(r));
  const checksum = createHash('sha256').update(recordLines.join('\n')).digest('hex');
  if (checksum !== manifest.checksum) {
    throw new MemoryJsonlChecksumError('Checksum mismatch — file may be corrupted or tampered');
  }

  const memoryCount = records.filter(r => r.type === 'memory_item').length;
  const relationCount = records.filter(r => r.type === 'memory_relation').length;
  if (memoryCount !== manifest.record_counts.memory_item) {
    throw new MemoryJsonlChecksumError(
      `memory_item count mismatch: manifest=${manifest.record_counts.memory_item}, actual=${memoryCount}`,
    );
  }
  if (relationCount !== manifest.record_counts.memory_relation) {
    throw new MemoryJsonlChecksumError(
      `memory_relation count mismatch: manifest=${manifest.record_counts.memory_relation}, actual=${relationCount}`,
    );
  }
}

function insertRow(
  db: Database.Database,
  table: string,
  row: Record<string, unknown>,
  omitColumns: string[] = [],
): void {
  const allowed = new Set(tableColumns(db, table));
  const columns = Object.keys(row).filter(
    key => allowed.has(key) && !omitColumns.includes(key),
  );
  if (columns.length === 0) {
    return;
  }
  const values = columns.map(col => row[col]);
  db.prepare(buildInsertStatement(table, columns)).run(...values);
}

export function importMemoryJsonl(
  db: Database.Database,
  content: string,
  options: MemoryImportOptions = {},
): MemoryImportResult {
  const { manifest, records } = parseMemoryJsonl(content);
  validateManifest(manifest, records, options);

  const memoryRecords = records.filter(r => r.type === 'memory_item');
  const relationRecords = records.filter(r => r.type === 'memory_relation');

  const importTx = db.transaction(() => {
    for (const record of memoryRecords) {
      insertRow(db, 'memory_item', record.row);
    }
    for (const record of relationRecords) {
      insertRow(db, 'memory_relation', record.row, ['id']);
    }
  });

  importTx();

  return {
    memoryItems: memoryRecords.length,
    memoryRelations: relationRecords.length,
    schemaVersion: manifest.schema_version,
  };
}

/** Generate a stable export filename suffix. */
export function memoryExportFilenameSuffix(): string {
  return randomUUID().slice(0, 8);
}
