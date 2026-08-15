#!/usr/bin/env node
/**
 * #768: 옛 triple 템플릿이 남긴 손상된 semantic memory 문장을 다시 렌더한다.
 *
 * 옛 템플릿은 `${subject}는 ${object}를 ${predicate}합니다`였다. subject/predicate/object 컬럼이
 * 그대로 남아 있으므로, content가 옛 템플릿과 정확히 일치하는 행만 골라 새 렌더러로 다시 만든다.
 * 정규식 대신 템플릿 동일성으로 고르기 때문에 `포함합니다` 같은 정상 문장을 건드리지 않는다.
 *
 * 사용:
 *   DB_PATH=./data/memory.db npm run memory:repair-triple-sentences            # dry-run
 *   DB_PATH=./data/memory.db npm run memory:repair-triple-sentences -- --apply
 */

import Database from 'better-sqlite3';
import {
  buildTripleSentence,
  closeDatabase,
  hasBrokenTripleConjugation,
  initializeDatabase,
  MemoryEmbeddingService,
} from '@memento/core';

interface CandidateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  content: string;
}

export interface RepairPlanEntry {
  id: string;
  before: string;
  after: string;
}

export interface RepairPlan {
  repairable: RepairPlanEntry[];
  /** 옛 템플릿과 일치하지만 새 렌더러도 문장을 만들 수 없는 행 */
  unrenderable: string[];
  /** 손상 신호는 있으나 triple 컬럼이 없어 복구 불가능한 행 */
  missingComponents: string[];
}

/** 옛 템플릿과 정확히 일치하는 행만 고른다 (SQL 문자열 결합으로 오탐 0). */
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

export function buildRepairPlan(db: Database.Database): RepairPlan {
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

  const missingComponents = (db.prepare(MISSING_COMPONENT_SQL).all() as Array<{ id: string; content: string }>)
    .filter((row) => hasBrokenTripleConjugation(row.content))
    .map((row) => row.id);

  return { repairable, unrenderable, missingComponents };
}

async function applyRepair(db: Database.Database, plan: RepairPlan): Promise<void> {
  const update = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');
  const runAll = db.transaction((entries: RepairPlanEntry[]) => {
    for (const entry of entries) {
      update.run(entry.after, entry.id);
    }
  });
  runAll(plan.repairable);

  // content가 바뀌면 기존 임베딩은 낡은 벡터다. 실패해도 content 복구는 이미 커밋되었으므로 경고만 남긴다.
  const embeddingService = new MemoryEmbeddingService();
  for (const entry of plan.repairable) {
    try {
      await embeddingService.createAndStoreEmbedding(db, entry.id, entry.after, 'semantic');
    } catch (error) {
      console.warn(
        `[repair] 임베딩 재생성 실패 (무시): ${entry.id} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function printPlan(plan: RepairPlan, apply: boolean): void {
  console.log(`복구 대상: ${plan.repairable.length}건 (${apply ? '적용' : 'dry-run'})`);
  for (const entry of plan.repairable.slice(0, 20)) {
    console.log(`  ${entry.id}`);
    console.log(`    - ${entry.before}`);
    console.log(`    + ${entry.after}`);
  }
  if (plan.repairable.length > 20) {
    console.log(`  … 외 ${plan.repairable.length - 20}건`);
  }
  if (plan.unrenderable.length > 0) {
    console.log(`재렌더 불가(구성 요소가 문장이 되지 않음): ${plan.unrenderable.length}건`);
  }
  if (plan.missingComponents.length > 0) {
    console.log(
      `triple 컬럼 없음 → 복구 불가, 수동 확인 필요: ${plan.missingComponents.length}건`,
    );
    console.log(`  ${plan.missingComponents.slice(0, 10).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  let db: Database.Database | null = null;

  try {
    db = await initializeDatabase();
    const plan = buildRepairPlan(db);
    printPlan(plan, apply);

    if (apply && plan.repairable.length > 0) {
      await applyRepair(db, plan);
      console.log('✅ 복구 완료');
    } else if (!apply && plan.repairable.length > 0) {
      console.log('ℹ️ 실제 수정은 --apply 를 붙여 실행하세요');
    }
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('repair-triple-sentence-memories.ts')) {
  main().catch((error) => {
    console.error('복구 실패:', error);
    process.exit(1);
  });
}
