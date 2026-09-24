/**
 * Migration: 048 — 중복 본문 semantic 기억 정리
 * Version: 48.0
 * Issue #1139 (부채 출처 #1137)
 *
 * #1137 은 쓰기·읽기 경로를 고쳤지만 이미 만들어진 중복 본문 행은 그대로 남는다.
 * 정리 수단이 `scripts/repair-duplicate-semantic-content.ts` 하나뿐인데 그 파일은
 * npm 발행 tarball 의 `files` 에 없어 배포판 사용자에게 도달하지 않는다. 마이그레이션은
 * postinstall 과 서버 시작 양쪽에서 자동으로 도는 경로이므로 여기로 옮긴다.
 *
 * 판정은 `buildDuplicatePlan` 이 단일 출처다. 이 마이그레이션은 그 결과를 적용만 한다.
 *
 * 임베딩은 만들지 않는다. MiniLM 모델 로드가 서버 시작을 블록하고, 마이그레이션 러너의
 * 트랜잭션 안에서 장시간 쓰기 락을 잡는다. content 가 바뀐 행의 임베딩은 stale 해지며
 * `npm run reindex-embeddings` 로 갱신한다.
 */

import type Database from 'better-sqlite3';
import { buildDuplicatePlan } from '../../../../../domains/memory/semantic/duplicate-content-plan.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { normalizeReflectionNotes } from '../../../../../shared/utils/reflection-notes-normalize.js';
import type { Migration } from '../types.js';

/**
 * 재렌더가 새 중복 그룹을 만들 수 있어 수렴할 때까지 반복한다.
 * 개발자 DB 실측(1,566행·228그룹)에서는 1회에 수렴했다. 상한은 무한 루프 방지용이다.
 */
const MAX_PASSES = 5;

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

/**
 * `UPDATE memory_item` 이 태우는 FTS 트리거가 이 SQL 함수를 요구한다.
 * 라이브 경로는 `configureSqliteSession` 이 등록하지만 단독 실행 경로를 위해 방어적으로 등록한다.
 */
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

export class RepairDuplicateSemanticContentMigration implements Migration {
  version = '48.0';
  name = 'repair-duplicate-semantic-content';
  description =
    'Re-render duplicated semantic content from stored triples and soft-delete exact duplicates (#1139)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) {
      throw new Error('Migration 048 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    registerNormalizeFunction(db);

    const updateContent = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');
    const softDelete = db.prepare('UPDATE memory_item SET is_deleted = 1 WHERE id = ?');

    let rerendered = 0;
    let deleted = 0;
    let passes = 0;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const plan = buildDuplicatePlan(db);
      if (plan.rerender.length === 0 && plan.deletions.length === 0) {
        break;
      }
      passes = pass + 1;
      for (const entry of plan.rerender) {
        updateContent.run(entry.after, entry.id);
        rerendered += 1;
      }
      for (const entry of plan.deletions) {
        softDelete.run(entry.id);
        deleted += 1;
      }
    }

    logger.info('repair-duplicate-semantic-content: 정리 완료', {
      rerendered,
      deleted,
      passes,
    });
  }

  /** 재렌더·soft-delete 는 되돌릴 수 없다. 버전 기록만 지운다. */
  async down(db: Database.Database): Promise<void> {
    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const plan = buildDuplicatePlan(db);
    if (plan.rerender.length > 0 || plan.deletions.length > 0) {
      throw new Error(
        `Migration 048 did not converge in ${MAX_PASSES} passes: ` +
          `${plan.rerender.length} rows still need re-render, ${plan.deletions.length} duplicates remain`,
      );
    }
  }
}

export default RepairDuplicateSemanticContentMigration;
