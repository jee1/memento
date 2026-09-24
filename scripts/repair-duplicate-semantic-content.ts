#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';
/**
 * #1137: 원문 폴백(#768 경로)이 만든 중복 본문 semantic 기억을 정리한다.
 *
 * 판정 로직은 `@memento/core` 의 `buildDuplicatePlan` 이 단일 출처다 (#1139).
 * 이 스크립트는 판정 결과를 적용하고 바뀐 행의 임베딩을 다시 만든다.
 * 배포판 사용자에게는 마이그레이션 048 이 같은 판정을 적용한다 (임베딩은 만들지 않는다).
 *
 * 사용:
 *   DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic            # dry-run
 *   DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic -- --apply
 */

import {
  buildDuplicatePlan,
  closeDatabase,
  initializeDatabase,
  MemoryEmbeddingService,
  type DuplicatePlan,
} from '@memento/core';

async function applyPlan(db: CliDatabase, plan: DuplicatePlan): Promise<void> {
  const updateContent = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');
  const softDelete = db.prepare('UPDATE memory_item SET is_deleted = 1 WHERE id = ?');
  const runAll = db.transaction(() => {
    for (const entry of plan.rerender) {
      updateContent.run(entry.after, entry.id);
    }
    for (const entry of plan.deletions) {
      softDelete.run(entry.id);
    }
  });
  runAll();

  const embeddingService = new MemoryEmbeddingService();
  for (const entry of plan.rerender) {
    try {
      await embeddingService.createAndStoreEmbedding(db, entry.id, entry.after, 'semantic');
    } catch (error) {
      console.warn(
        `[repair] 임베딩 재생성 실패 (무시): ${entry.id} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function printPlan(plan: DuplicatePlan, apply: boolean): void {
  console.log(`재렌더 대상: ${plan.rerender.length}건 (${apply ? '적용' : 'dry-run'})`);
  for (const entry of plan.rerender.slice(0, 20)) {
    console.log(`  ${entry.id}`);
    console.log(`    - ${entry.before}`);
    console.log(`    + ${entry.after}`);
  }
  if (plan.rerender.length > 20) {
    console.log(`  … 외 ${plan.rerender.length - 20}건`);
  }
  if (plan.deletions.length > 0) {
    console.log(`완전중복 soft-delete: ${plan.deletions.length}건`);
    for (const entry of plan.deletions.slice(0, 20)) {
      console.log(`  ${entry.id} (유지: ${entry.keptId})`);
    }
    if (plan.deletions.length > 20) {
      console.log(`  … 외 ${plan.deletions.length - 20}건`);
    }
  }
}

async function main(): Promise<void> {
  const apply = parseCliArgs().args.includes('--apply');
  let db: CliDatabase | null = null;

  try {
    db = await initializeDatabase();
    const plan = buildDuplicatePlan(db);
    printPlan(plan, apply);

    if (apply && (plan.rerender.length > 0 || plan.deletions.length > 0)) {
      await applyPlan(db, plan);
      console.log('✅ 정리 완료');
    } else if (!apply && (plan.rerender.length > 0 || plan.deletions.length > 0)) {
      console.log('ℹ️ 실제 수정은 --apply 를 붙여 실행하세요');
    }
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error('정리 실패:', error);
    process.exit(1);
  });
}
