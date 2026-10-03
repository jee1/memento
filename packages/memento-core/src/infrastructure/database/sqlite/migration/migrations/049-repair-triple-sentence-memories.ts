/**
 * Migration: 049 — 손상된 triple 문장 semantic 기억 복구
 * Version: 49.0
 * Issue #1156 (부채 출처 #768)
 *
 * #1237: buildRepairPlan/triple-sentence 로직을 마이그레이션 파일에 인라인한다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import { normalizeReflectionNotes } from '../../../../../shared/utils/reflection-notes-normalize.js';
import type { Migration } from '../types.js';
import {
  buildTripleSentence,
  hasBrokenTripleConjugation,
} from '../migration-repair-helpers.js';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

interface CandidateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  content: string;
}

interface RepairPlanEntry {
  id: string;
  before: string;
  after: string;
}

interface RepairPlan {
  repairable: RepairPlanEntry[];
  unrenderable: string[];
  missingComponents: string[];
}

const CANDIDATE_SQL = `
  SELECT id, subject, predicate, object, content
  FROM memory_item
  WHERE type = 'semantic'
    AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL
    AND content = subject || '는 ' || object || '를 ' || predicate || '합니다'
`;

const MISSING_COMPONENT_SQL = `
  SELECT id, content
  FROM memory_item
  WHERE type = 'semantic'
    AND (subject IS NULL OR predicate IS NULL OR object IS NULL)
`;

function buildRepairPlan(db: Database.Database): RepairPlan {
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];
  const repairable: RepairPlanEntry[] = [];
  const unrenderable: string[] = [];

  for (const row of candidates) {
    const rendered = buildTripleSentence(row.subject, row.predicate, row.object);
    if (!rendered) {
      unrenderable.push(row.id);
      continue;
    }
    if (rendered !== row.content) {
      repairable.push({ id: row.id, before: row.content, after: rendered });
    }
  }

  const missingComponents = (
    db.prepare(MISSING_COMPONENT_SQL).all() as Array<{ id: string; content: string }>
  )
    .filter((row) => hasBrokenTripleConjugation(row.content))
    .map((row) => row.id);

  return { repairable, unrenderable, missingComponents };
}

function registerNormalizeFunction(db: Database.Database): void {
  try {
    db.function(
      'normalize_reflection_notes',
      {
        deterministic: true,
        varargs: false,
      },
      (reflectionNotes: string | null) => {
        return normalizeReflectionNotes(reflectionNotes);
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('active statements')) {
      return;
    }
    throw error;
  }
}

export class RepairTripleSentenceMemoriesMigration implements Migration {
  version = '49.0';
  name = 'repair-triple-sentence-memories';
  description =
    'Re-render semantic content left broken by the legacy triple sentence template (#1156)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) {
      throw new Error('Migration 049 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    registerNormalizeFunction(db);

    const plan = buildRepairPlan(db);
    const update = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');

    for (const entry of plan.repairable) {
      update.run(entry.after, entry.id);
    }

    logger.info('repair-triple-sentence-memories: 복구 완료', {
      repaired: plan.repairable.length,
      unrenderable: plan.unrenderable.length,
      missingComponents: plan.missingComponents.length,
    });
  }

  async down(db: Database.Database): Promise<void> {
    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const plan = buildRepairPlan(db);
    if (plan.repairable.length > 0) {
      throw new Error(
        `Migration 049 did not converge: ${plan.repairable.length} rows still need re-render`,
      );
    }
  }
}

export default RepairTripleSentenceMemoriesMigration;
