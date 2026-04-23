/**
 * KgTriple Repository SQLite Implementation
 */

import type Database from 'better-sqlite3';
import type { 
  IKgTripleRepository, 
  KgTripleRow, 
  UpsertTripleInput 
} from '../../../domains/memory/repositories/kg-triple-repository.interface.js';

function generateId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `triple_${timestamp}_${random}`;
}

export class KgTripleRepositorySqlite implements IKgTripleRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 동일 (subject, predicate, object)이면 기존 id 반환, 없으면 삽입 후 id 반환.
   * representative_memory_id는 새로 삽입할 때만 설정하고, 기존 행은 갱신하지 않음.
   */
  upsertTriple(input: UpsertTripleInput): string {
    const existing = this.getBySubjectPredicateObject(input.subject, input.predicate, input.object);
    if (existing) {
      return existing.id;
    }
    const id = generateId();
    const stmt = this.db.prepare(`
      INSERT INTO kg_triple (id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      input.subject,
      input.predicate,
      input.object,
      input.owner_id ?? null,
      input.process_id ?? null,
      input.session_id ?? null,
      input.representative_memory_id ?? null
    );
    return id;
  }

  getBySubjectPredicateObject(subject: string, predicate: string, object: string): KgTripleRow | null {
    const row = this.db.prepare(
      `SELECT id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id, created_at
       FROM kg_triple WHERE subject = ? AND predicate = ? AND object = ?`
    ).get(subject, predicate, object) as KgTripleRow | undefined;
    return row ?? null;
  }
}
