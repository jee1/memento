import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import type { CollectedMetrics } from './quality-metrics-types.js';

export class StorageMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(context: string = 'default'): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    try {
      // 1. 중복 비율 계산 (memory_link 테이블에서 duplicates 관계 비율)
      const totalMemoryItems = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_item
      `).get() as { count: number };

      const duplicateLinks = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_link
        WHERE relation_type = 'duplicates'
      `).get() as { count: number };

      // 중복 비율 = (중복 관계 수 * 2) / (전체 메모리 아이템 수 * 2)
      // 각 중복 관계는 2개의 메모리를 연결하므로, 중복된 메모리 수는 관계 수 * 2
      // 전체 메모리 아이템이 0인 경우 0으로 처리
      if (totalMemoryItems.count > 0) {
        metrics.duplication_rate = Math.min(
          (duplicateLinks.count * 2) / totalMemoryItems.count,
          1.0
        );
      } else {
        metrics.duplication_rate = 0;
      }

      // 2. 데이터 무결성 검증
      let integrityScore = 1.0;
      let integrityChecks = 0;
      let integrityPassed = 0;

      // 2.1 PRAGMA integrity_check
      try {
        const integrityResult = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        integrityChecks++;
        if (integrityResult.integrity_check === 'ok') {
          integrityPassed++;
        } else {
          integrityScore -= 0.3; // 무결성 검사 실패 시 큰 패널티
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.3;
      }

      // 2.2 외래키 제약 조건 검증
      // memory_item_tag의 외래키 검증
      try {
        const orphanedTags = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item_tag mit
          LEFT JOIN memory_item mi ON mit.memory_id = mi.id
          LEFT JOIN memory_tag mt ON mit.tag_id = mt.id
          WHERE mi.id IS NULL OR mt.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedTags.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // memory_link의 외래키 검증
      try {
        const orphanedLinks = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_link ml
          LEFT JOIN memory_item mi1 ON ml.source_id = mi1.id
          LEFT JOIN memory_item mi2 ON ml.target_id = mi2.id
          WHERE mi1.id IS NULL OR mi2.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedLinks.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // feedback_event의 외래키 검증
      try {
        const orphanedFeedback = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM feedback_event fe
          LEFT JOIN memory_item mi ON fe.memory_id = mi.id
          WHERE mi.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedFeedback.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.1;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.05;
      }

      // memory_embedding의 외래키 검증
      try {
        const orphanedEmbeddings = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_embedding me
          LEFT JOIN memory_item mi ON me.memory_id = mi.id
          WHERE mi.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedEmbeddings.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // 무결성 점수는 0 이상 1 이하로 정규화
      metrics.data_integrity = Math.max(0, Math.min(integrityScore, 1.0));

      // 3. 스키마 준수율 계산
      let schemaComplianceScore = 1.0;
      let schemaChecks = 0;
      let schemaPassed = 0;

      // 3.1 필수 필드 존재 여부 (id, type, content)
      try {
        const missingRequiredFields = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE id IS NULL OR id = '' OR
                type IS NULL OR type = '' OR
                content IS NULL OR content = ''
        `).get() as { count: number };
        schemaChecks++;
        if (missingRequiredFields.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.3;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.1;
      }

      // 3.2 타입 검증 (type은 enum 값)
      try {
        const invalidTypes = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE type NOT IN ('working', 'episodic', 'semantic', 'procedural', 'core', 'vault')
        `).get() as { count: number };
        schemaChecks++;
        if (invalidTypes.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.2;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.1;
      }

      // 3.3 importance 범위 검증 (0-1)
      try {
        const invalidImportance = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE importance IS NOT NULL AND (importance < 0 OR importance > 1)
        `).get() as { count: number };
        schemaChecks++;
        if (invalidImportance.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.1;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.05;
      }

      // 3.4 privacy_scope enum 검증
      try {
        const invalidPrivacyScope = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE privacy_scope IS NOT NULL AND 
                privacy_scope NOT IN ('private', 'team', 'public')
        `).get() as { count: number };
        schemaChecks++;
        if (invalidPrivacyScope.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.1;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.05;
      }

      // 스키마 준수율은 0 이상 1 이하로 정규화
      metrics.schema_compliance = Math.max(0, Math.min(schemaComplianceScore, 1.0));

      // 4. 데이터 손실률 계산
      // memory_embedding 테이블에 embedding이 없는 memory_item 비율
      try {
        const totalItems = totalMemoryItems.count;
        if (totalItems > 0) {
          const itemsWithoutEmbedding = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM memory_item mi
            LEFT JOIN memory_embedding me ON mi.id = me.memory_id
            WHERE me.memory_id IS NULL
          `).get() as { count: number };
          metrics.data_loss_rate = itemsWithoutEmbedding.count / totalItems;
        } else {
          metrics.data_loss_rate = 0;
        }
      } catch (error) {
        metrics.data_loss_rate = 0;
      }

      logger.info('저장 품질 지표 수집 완료', {
        context,
        metrics_count: Object.keys(metrics).length,
        duplication_rate: metrics.duplication_rate,
        data_integrity: metrics.data_integrity,
        schema_compliance: metrics.schema_compliance,
        data_loss_rate: metrics.data_loss_rate,
        integrity_checks: integrityChecks,
        integrity_passed: integrityPassed,
        schema_checks: schemaChecks,
        schema_passed: schemaPassed
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
