/**
 * 데이터베이스 의존성 검증 유틸리티
 * 마이그레이션 후 기존 의존성(외래키, 트리거 등)이 정상적으로 작동하는지 검증
 */

import type Database from 'better-sqlite3';

export interface DependencyValidationResult {
  /**
   * 검증 항목 이름
   */
  name: string;

  /**
   * 검증 성공 여부
   */
  success: boolean;

  /**
   * 에러 메시지 (실패 시)
   */
  error?: string;

  /**
   * 검증 상세 정보
   */
  details?: Record<string, any>;
}

/**
 * 의존성 검증 결과
 */
export interface DependencyValidationReport {
  /**
   * 전체 검증 성공 여부
   */
  success: boolean;

  /**
   * 검증 결과 목록
   */
  results: DependencyValidationResult[];

  /**
   * 실패한 검증 개수
   */
  failureCount: number;
}

/**
 * 데이터베이스 의존성 검증기
 */
export class DependencyValidator {
  /**
   * 모든 의존성 검증 수행
   */
  static async validateAll(db: Database.Database): Promise<DependencyValidationReport> {
    const results: DependencyValidationResult[] = [];

    // 1. memory_embedding 외래키 검증
    results.push(await this.validateMemoryEmbeddingForeignKey(db));

    // 2. FTS5 트리거 검증
    results.push(await this.validateFTS5Triggers(db));

    // 3. VEC 트리거 검증
    results.push(await this.validateVECTriggers(db));

    const failureCount = results.filter(r => !r.success).length;

    return {
      success: failureCount === 0,
      results,
      failureCount
    };
  }

  /**
   * memory_embedding 테이블의 외래키 검증
   */
  static async validateMemoryEmbeddingForeignKey(
    db: Database.Database
  ): Promise<DependencyValidationResult> {
    try {
      // memory_embedding 테이블 존재 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();

      if (!tableExists) {
        return {
          name: 'memory_embedding_foreign_key',
          success: false,
          error: 'memory_embedding table does not exist'
        };
      }

      // 외래키 제약 조건 확인
      const fkInfo = db.prepare(`
        SELECT * FROM pragma_foreign_key_list('memory_embedding')
        WHERE "table" = 'memory_item'
      `).all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>;

      if (fkInfo.length === 0) {
        return {
          name: 'memory_embedding_foreign_key',
          success: false,
          error: 'Foreign key constraint from memory_embedding.memory_id to memory_item.id is missing'
        };
      }

      const fk = fkInfo[0];
      if (!fk) {
        return {
          name: 'memory_embedding_foreign_key',
          success: false,
          error: 'Foreign key constraint information is missing'
        };
      }

      if (fk.from !== 'memory_id' || fk.to !== 'id') {
        return {
          name: 'memory_embedding_foreign_key',
          success: false,
          error: `Foreign key constraint mismatch: expected memory_id -> id, got ${fk.from} -> ${fk.to}`
        };
      }

      if (fk.on_delete !== 'CASCADE') {
        return {
          name: 'memory_embedding_foreign_key',
          success: false,
          error: `Foreign key on_delete action should be CASCADE, got ${fk.on_delete}`
        };
      }

      return {
        name: 'memory_embedding_foreign_key',
        success: true,
        details: {
          from: fk.from,
          to: fk.to,
          on_delete: fk.on_delete,
          on_update: fk.on_update
        }
      };
    } catch (error: any) {
      return {
        name: 'memory_embedding_foreign_key',
        success: false,
        error: error.message || 'Unknown error during foreign key validation'
      };
    }
  }

  /**
   * FTS5 트리거 검증
   */
  static async validateFTS5Triggers(
    db: Database.Database
  ): Promise<DependencyValidationResult> {
    try {
      const requiredTriggers = [
        'memory_item_fts_insert',
        'memory_item_fts_update',
        'memory_item_fts_delete'
      ];

      const missingTriggers: string[] = [];
      const foundTriggers: string[] = [];

      for (const triggerName of requiredTriggers) {
        const trigger = db.prepare(`
          SELECT name, sql FROM sqlite_master 
          WHERE type='trigger' AND name=?
        `).get(triggerName) as { name: string; sql: string } | undefined;

        if (!trigger) {
          missingTriggers.push(triggerName);
        } else {
          foundTriggers.push(triggerName);
        }
      }

      if (missingTriggers.length > 0) {
        return {
          name: 'fts5_triggers',
          success: false,
          error: `Missing FTS5 triggers: ${missingTriggers.join(', ')}`,
          details: {
            found: foundTriggers,
            missing: missingTriggers
          }
        };
      }

      // FTS5 가상 테이블 존재 확인
      const ftsTable = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get();

      if (!ftsTable) {
        return {
          name: 'fts5_triggers',
          success: false,
          error: 'FTS5 virtual table memory_item_fts does not exist'
        };
      }

      return {
        name: 'fts5_triggers',
        success: true,
        details: {
          triggers: foundTriggers,
          fts_table_exists: true
        }
      };
    } catch (error: any) {
      return {
        name: 'fts5_triggers',
        success: false,
        error: error.message || 'Unknown error during FTS5 trigger validation'
      };
    }
  }

  /**
   * VEC 트리거 검증
   */
  static async validateVECTriggers(
    db: Database.Database
  ): Promise<DependencyValidationResult> {
    try {
      // 먼저 VEC 확장이 사용 가능한지 확인
      let vecExtensionAvailable = false;
      try {
        const vecTable = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE '%vec%'
        `).get();
        vecExtensionAvailable = !!vecTable;
      } catch {
        // VEC 확장이 없을 수 있음
        vecExtensionAvailable = false;
      }

      // VEC 확장이 없으면 검증을 건너뜀 (선택적 의존성)
      if (!vecExtensionAvailable) {
        return {
          name: 'vec_triggers',
          success: true,
          details: {
            note: 'VEC extension not available, skipping trigger validation'
          }
        };
      }

      const requiredTriggers = [
        'memory_embedding_vec_insert',
        'memory_embedding_vec_update',
        'memory_embedding_vec_delete'
      ];

      const missingTriggers: string[] = [];
      const foundTriggers: string[] = [];

      for (const triggerName of requiredTriggers) {
        const trigger = db.prepare(`
          SELECT name, sql FROM sqlite_master 
          WHERE type='trigger' AND name=?
        `).get(triggerName) as { name: string; sql: string } | undefined;

        if (!trigger) {
          missingTriggers.push(triggerName);
        } else {
          foundTriggers.push(triggerName);
        }
      }

      if (missingTriggers.length > 0) {
        return {
          name: 'vec_triggers',
          success: false,
          error: `Missing VEC triggers: ${missingTriggers.join(', ')}`,
          details: {
            found: foundTriggers,
            missing: missingTriggers
          }
        };
      }

      // VEC 가상 테이블 존재 확인 (선택적, sqlite-vec 확장이 설치되어 있을 때만)
      const vecTables = [
        'memory_item_vec',
        'memory_item_vec_tfidf',
        'memory_item_vec_minilm',
        'memory_item_vec_openai',
        'memory_item_vec_gemini'
      ];

      const existingVecTables: string[] = [];
      const missingVecTables: string[] = [];

      for (const tableName of vecTables) {
        try {
          const table = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name=?
          `).get(tableName);

          if (table) {
            existingVecTables.push(tableName);
          } else {
            missingVecTables.push(tableName);
          }
        } catch {
          // sqlite-vec 확장이 없을 수 있으므로 에러는 무시
          missingVecTables.push(tableName);
        }
      }

      // VEC 테이블이 하나도 없으면 경고 (sqlite-vec 확장이 설치되지 않았을 수 있음)
      if (existingVecTables.length === 0) {
        return {
          name: 'vec_triggers',
          success: true, // 트리거는 존재하므로 성공으로 처리
          details: {
            triggers: foundTriggers,
            vec_tables: {
              existing: existingVecTables,
              missing: missingVecTables,
              note: 'sqlite-vec extension may not be installed'
            }
          }
        };
      }

      return {
        name: 'vec_triggers',
        success: true,
        details: {
          triggers: foundTriggers,
          vec_tables: {
            existing: existingVecTables,
            missing: missingVecTables
          }
        }
      };
    } catch (error: any) {
      return {
        name: 'vec_triggers',
        success: false,
        error: error.message || 'Unknown error during VEC trigger validation'
      };
    }
  }
}

