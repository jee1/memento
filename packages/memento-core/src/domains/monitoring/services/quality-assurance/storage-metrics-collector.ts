import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import type { CollectedMetrics } from './quality-metrics-types.js';

/** 점수 1.0 에서 시작해 실패하면 failPenalty, 쿼리 오류면 errorPenalty 를 뺀다. */
interface ScoreCheck {
  sql: string;
  passes: (row: unknown) => boolean;
  failPenalty: number;
  errorPenalty: number;
}

const countIsZero = (row: unknown): boolean => (row as { count: number }).count === 0;

const SELECT_MEMORY_ITEM_COUNT_SQL = `
  SELECT COUNT(*) as count FROM memory_item
`;

const SELECT_DUPLICATE_LINK_COUNT_SQL = `
  SELECT COUNT(*) as count FROM memory_link
  WHERE relation_type = 'duplicates'
`;

// memory_embedding 테이블에 embedding이 없는 memory_item 수
const SELECT_ITEMS_WITHOUT_EMBEDDING_SQL = `
  SELECT COUNT(*) as count
  FROM memory_item mi
  LEFT JOIN memory_embedding me ON mi.id = me.memory_id
  WHERE me.memory_id IS NULL
`;

/** 데이터 무결성: PRAGMA integrity_check + 외래키 고아 행 */
const INTEGRITY_CHECKS: readonly ScoreCheck[] = [
  {
    sql: 'PRAGMA integrity_check',
    passes: (row) => (row as { integrity_check: string }).integrity_check === 'ok',
    failPenalty: 0.3, // 무결성 검사 실패 시 큰 패널티
    errorPenalty: 0.3
  },
  {
    // memory_item_tag의 외래키
    sql: `
      SELECT COUNT(*) as count
      FROM memory_item_tag mit
      LEFT JOIN memory_item mi ON mit.memory_id = mi.id
      LEFT JOIN memory_tag mt ON mit.tag_id = mt.id
      WHERE mi.id IS NULL OR mt.id IS NULL
    `,
    passes: countIsZero,
    failPenalty: 0.2,
    errorPenalty: 0.1
  },
  {
    // memory_link의 외래키
    sql: `
      SELECT COUNT(*) as count
      FROM memory_link ml
      LEFT JOIN memory_item mi1 ON ml.source_id = mi1.id
      LEFT JOIN memory_item mi2 ON ml.target_id = mi2.id
      WHERE mi1.id IS NULL OR mi2.id IS NULL
    `,
    passes: countIsZero,
    failPenalty: 0.2,
    errorPenalty: 0.1
  },
  {
    // feedback_event의 외래키
    sql: `
      SELECT COUNT(*) as count
      FROM feedback_event fe
      LEFT JOIN memory_item mi ON fe.memory_id = mi.id
      WHERE mi.id IS NULL
    `,
    passes: countIsZero,
    failPenalty: 0.1,
    errorPenalty: 0.05
  },
  {
    // memory_embedding의 외래키
    sql: `
      SELECT COUNT(*) as count
      FROM memory_embedding me
      LEFT JOIN memory_item mi ON me.memory_id = mi.id
      WHERE mi.id IS NULL
    `,
    passes: countIsZero,
    failPenalty: 0.2,
    errorPenalty: 0.1
  }
];

/** 스키마 준수율: 필수 필드·type enum·importance 범위·privacy_scope enum */
const SCHEMA_CHECKS: readonly ScoreCheck[] = [
  {
    sql: `
      SELECT COUNT(*) as count
      FROM memory_item
      WHERE id IS NULL OR id = '' OR
            type IS NULL OR type = '' OR
            content IS NULL OR content = ''
    `,
    passes: countIsZero,
    failPenalty: 0.3,
    errorPenalty: 0.1
  },
  {
    sql: `
      SELECT COUNT(*) as count
      FROM memory_item
      WHERE type NOT IN ('working', 'episodic', 'semantic', 'procedural', 'core', 'vault')
    `,
    passes: countIsZero,
    failPenalty: 0.2,
    errorPenalty: 0.1
  },
  {
    sql: `
      SELECT COUNT(*) as count
      FROM memory_item
      WHERE importance IS NOT NULL AND (importance < 0 OR importance > 1)
    `,
    passes: countIsZero,
    failPenalty: 0.1,
    errorPenalty: 0.05
  },
  {
    sql: `
      SELECT COUNT(*) as count
      FROM memory_item
      WHERE privacy_scope IS NOT NULL AND 
            privacy_scope NOT IN ('private', 'team', 'public')
    `,
    passes: countIsZero,
    failPenalty: 0.1,
    errorPenalty: 0.05
  }
];

/** 검사를 순서대로 돌려 감점한 점수(0~1 로 자름)와 통과 수를 낸다. */
function runScoreChecks(
  db: Database.Database,
  checks: readonly ScoreCheck[]
): { score: number; checks: number; passed: number } {
  let score = 1.0;
  let passed = 0;
  for (const check of checks) {
    try {
      if (check.passes(db.prepare(check.sql).get())) {
        passed++;
      } else {
        score -= check.failPenalty;
      }
    } catch {
      score -= check.errorPenalty;
    }
  }
  return { score: Math.max(0, Math.min(score, 1.0)), checks: checks.length, passed };
}

/** embedding 이 없는 memory_item 비율. 실패하면 0. */
function dataLossRate(db: Database.Database, totalItems: number): number {
  try {
    if (totalItems === 0) return 0;
    const itemsWithoutEmbedding = db.prepare(SELECT_ITEMS_WITHOUT_EMBEDDING_SQL).get() as { count: number };
    return itemsWithoutEmbedding.count / totalItems;
  } catch {
    return 0;
  }
}

export class StorageMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(context: string = 'default'): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    try {
      // 1. 중복 비율 = (중복 관계 수 * 2) / 전체 메모리 아이템 수, 최대 1.0
      // 각 중복 관계는 2개의 메모리를 연결하므로, 중복된 메모리 수는 관계 수 * 2
      const totalMemoryItems = this.db.prepare(SELECT_MEMORY_ITEM_COUNT_SQL).get() as { count: number };
      const duplicateLinks = this.db.prepare(SELECT_DUPLICATE_LINK_COUNT_SQL).get() as { count: number };
      metrics.duplication_rate = totalMemoryItems.count > 0
        ? Math.min((duplicateLinks.count * 2) / totalMemoryItems.count, 1.0)
        : 0;

      // 2. 데이터 무결성, 3. 스키마 준수율
      const integrity = runScoreChecks(this.db, INTEGRITY_CHECKS);
      metrics.data_integrity = integrity.score;
      const schema = runScoreChecks(this.db, SCHEMA_CHECKS);
      metrics.schema_compliance = schema.score;

      // 4. 데이터 손실률
      metrics.data_loss_rate = dataLossRate(this.db, totalMemoryItems.count);

      logger.info('저장 품질 지표 수집 완료', {
        context,
        metrics_count: Object.keys(metrics).length,
        duplication_rate: metrics.duplication_rate,
        data_integrity: metrics.data_integrity,
        schema_compliance: metrics.schema_compliance,
        data_loss_rate: metrics.data_loss_rate,
        integrity_checks: integrity.checks,
        integrity_passed: integrity.passed,
        schema_checks: schema.checks,
        schema_passed: schema.passed
      });

    } catch (error) {
      logger.error('저장 품질 지표 수집 중 오류 발생', {
        context,
        error: error instanceof Error ? error.message : String(error)
      });
      // 오류 발생 시 기본값 반환
      metrics.duplication_rate = 0;
      metrics.data_integrity = 0;
      metrics.schema_compliance = 0;
      metrics.data_loss_rate = 0;
    }

    return {
      namespace: 'storage',
      context,
      measured_at: new Date().toISOString(),
      metrics,
      metadata: {
        note: '저장 품질 지표 수집 완료'
      }
    };
  }
}
