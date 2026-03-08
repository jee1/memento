/**
 * ProcessAttribute Repository (Issue #91)
 * process_attribute 테이블 접근: getByProcessId, upsert.
 */

import type Database from 'better-sqlite3';
import type { ProcessAttribute } from '../../../shared/types/index.js';

function parseJsonArray(value: string | null): string[] {
  if (value == null || value === '') return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(arr: string[] | undefined): string | null {
  if (arr == null || arr.length === 0) return null;
  return JSON.stringify(arr);
}

export class ProcessAttributeRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * process_id로 속성 조회. 없으면 null.
   */
  getByProcessId(processId: string): ProcessAttribute | null {
    const row = this.db.prepare(
      `SELECT process_id, topics, workflow_names, skill_names, created_at, updated_at
       FROM process_attribute WHERE process_id = ?`
    ).get(processId) as { process_id: string; topics: string | null; workflow_names: string | null; skill_names: string | null; created_at: string; updated_at: string } | undefined;
    if (!row) return null;
    return {
      process_id: row.process_id,
      topics: parseJsonArray(row.topics),
      workflow_names: parseJsonArray(row.workflow_names),
      skill_names: parseJsonArray(row.skill_names),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * process_attribute 행 삽입 또는 갱신. topics/workflow_names/skill_names를 저장.
   */
  upsert(attr: ProcessAttribute): void {
    const topicsJson = stringifyJsonArray(attr.topics);
    const workflowNamesJson = stringifyJsonArray(attr.workflow_names);
    const skillNamesJson = stringifyJsonArray(attr.skill_names);

    this.db.prepare(`
      INSERT INTO process_attribute (process_id, topics, workflow_names, skill_names)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(process_id) DO UPDATE SET
        topics = excluded.topics,
        workflow_names = excluded.workflow_names,
        skill_names = excluded.skill_names,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(attr.process_id, topicsJson, workflowNamesJson, skillNamesJson);
  }
}
