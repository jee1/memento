/**
 * VEC 가용성·인덱스 상태
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import { VECTOR_SEARCH_CONFIG } from '../../../../shared/config/vector-search.config.js';
import type { VectorIndexStatus } from '../../../../shared/types/vector-search.types.js';
import { getTableName, resolveRuntimeVectorContext } from './vector-search-runtime-context.js';

export function isVecTableRegistered(db: Database.Database, tableName: string): boolean {
  try {
    const statement = db.prepare(
      `SELECT 1 as ok FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ? LIMIT 1`
    );
    if (typeof statement.get !== 'function') {
      return false;
    }
    const row = statement.get(tableName) as { ok: number } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

export function checkVecAvailability(db: Database.Database | null): boolean {
  if (!db) {
    mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.', {
      category: 'VEC_UNAVAILABLE'
    });
    return false;
  }

  try {
    const hasAnyWhitelistedVecTable = db.prepare(`
        SELECT 1 as ok FROM sqlite_master
        WHERE type IN ('table', 'virtual')
          AND name IN (
            'memory_item_vec',
            'memory_item_vec_tfidf',
            'memory_item_vec_minilm',
            'memory_item_vec_openai',
            'memory_item_vec_gemini',
            'memory_item_vec_mock'
          )
        LIMIT 1
      `);
    const anyRow =
      typeof hasAnyWhitelistedVecTable.get === 'function'
        ? (hasAnyWhitelistedVecTable.get() as { ok: number } | undefined)
        : undefined;
    if (!anyRow) {
      mcpLogger.logServer('warn', 'VEC 테이블이 없습니다. 벡터 검색이 비활성화됩니다.', {
        category: 'VEC_UNAVAILABLE'
      });
      return false;
    }

    const vecProbeProviders = ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini', 'mock'] as const;
    let lastError: string | undefined;

    for (const probeProvider of vecProbeProviders) {
      const runtimeContext = resolveRuntimeVectorContext(db, probeProvider);
      if (!isVecTableRegistered(db, runtimeContext.tableName)) {
        continue;
      }
      try {
        const testStatement = db.prepare(
          `SELECT distance FROM ${runtimeContext.tableName} WHERE embedding MATCH ? LIMIT 0`
        );

        if (typeof testStatement.get !== 'function') {
          lastError = 'VEC 테스트 쿼리를 실행할 수 없습니다: get() 메서드가 없습니다.';
          continue;
        }

        testStatement.get(JSON.stringify(new Array(runtimeContext.targetDimensions).fill(0)));

        mcpLogger.logServer('info', 'VEC (Vector Search) 사용 가능', {
          provider: runtimeContext.provider,
          tableName: runtimeContext.tableName
        });
        return true;
      } catch (probeErr) {
        lastError = probeErr instanceof Error ? probeErr.message : String(probeErr);
      }
    }

    mcpLogger.logServer('warn', 'VEC 함수를 사용할 수 없습니다', {
      category: 'VEC_UNAVAILABLE',
      error: lastError ?? 'no vec table succeeded for any known embedding provider'
    });
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.logServer('warn', 'VEC 함수를 사용할 수 없습니다', {
      category: 'VEC_UNAVAILABLE',
      error: message
    });
    return false;
  }
}

export function getIndexStatus(
  db: Database.Database | null,
  isVecAvailable: boolean
): VectorIndexStatus {
  if (!db) {
    return {
      available: false,
      tableExists: false,
      recordCount: 0,
      dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
      vecExtensionLoaded: false
    };
  }

  try {
    const tableExists = isVecAvailable;
    let recordCount = 0;

    if (tableExists) {
      const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
      for (const provider of providers) {
        const tableName = getTableName(provider);
        try {
          const statement = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`);
          if (typeof statement.get !== 'function') {
            continue;
          }
          const result = statement.get() as { count: number } | undefined;
          if (result && typeof result.count === 'number') {
            recordCount += result.count;
          }
        } catch {
          // 테이블이 존재하지 않는 경우 무시
        }
      }
    }

    return {
      available: isVecAvailable,
      tableExists,
      recordCount,
      dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
      vecExtensionLoaded: isVecAvailable
    };
  } catch (error) {
    mcpLogger.logServer('error', '인덱스 상태 확인 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      available: false,
      tableExists: false,
      recordCount: 0,
      dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
      vecExtensionLoaded: false
    };
  }
}

export async function rebuildIndex(
  db: Database.Database | null,
  isVecAvailable: boolean
): Promise<boolean> {
  if (!db || !isVecAvailable) {
    mcpLogger.logServer('warn', 'VEC를 사용할 수 없습니다.');
    return false;
  }

  try {
    mcpLogger.logServer('info', '벡터 인덱스 재구성 시작');
    mcpLogger.logServer('info', '벡터 인덱스 재구성 완료 (sqlite-vec는 자동 인덱스 관리)');
    return true;
  } catch (error) {
    mcpLogger.logServer('error', '벡터 인덱스 재구성 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
