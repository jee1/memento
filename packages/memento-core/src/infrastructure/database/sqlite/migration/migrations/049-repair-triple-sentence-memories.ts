/**
 * Migration: 049 — 손상된 triple 문장 semantic 기억 복구
 * Version: 49.0
 * Issue #1156 (부채 출처 #768)
 *
 * 옛 템플릿 `${subject}는 ${object}를 ${predicate}합니다` 가 만든 semantic 기억은 `정의됨합니다`
 * 처럼 활용이 깨져 있다. 정리 수단이 `scripts/repair-triple-sentence-memories.ts` 하나뿐인데
 * 그 파일은 npm 발행 tarball 의 `files` 에 없어 배포판 사용자에게 도달하지 않는다.
 * 마이그레이션은 postinstall 과 서버 시작 양쪽에서 자동으로 도는 경로이므로 여기로 옮긴다.
 *
 * 판정은 `buildRepairPlan` 이 단일 출처다. 이 마이그레이션은 그 결과를 적용만 한다.
 *
 * 임베딩은 만들지 않는다. 임베딩 모델 로드가 서버 시작을 블록하고, 마이그레이션 러너의
 * 트랜잭션 안에서 장시간 쓰기 락을 잡는다. content 가 바뀐 행의 임베딩은 stale 해지며
 * 배포판 사용자는 `memento-reindex-embeddings` 로 갱신한다(#1155).
 *
 * 048 과 달리 반복 패스가 필요 없다. 후보 SQL 이 옛 템플릿과의 **정확한 문자열 일치**로만 고르고,
 * 재렌더된 content 는 그 템플릿과 더 이상 일치하지 않으므로 1회 적용에서 수렴한다.
 */

import type Database from 'better-sqlite3';
import { buildRepairPlan } from '../../../../../domains/memory/semantic/triple-repair-plan.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { normalizeReflectionNotes } from '../../../../../shared/utils/reflection-notes-normalize.js';
import type { Migration } from '../types.js';

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

  /** 재렌더는 되돌릴 수 없다. 버전 기록만 지운다. */
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
