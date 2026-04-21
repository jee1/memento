/**
 * 반복 메타데이터 갱신 서비스 (Issue #20)
 *
 * 유사 기억을 대표 1건으로 병합할 때 num_times·last_mentioned_at을 보존하여
 * "반복 = 중요도" 신호가 recall 랭킹에 반영되도록 한다.
 *
 * - 배치 병합: updateRepresentativeRepetitionMeta(db, representativeId, mergedIds)
 * - 단일 병합(1건 추가): SemanticMemoryUpdateService 등에서 num_times + 1, last_mentioned_at 갱신
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';

export interface RepetitionMetaUpdateResult {
  representativeId: string;
  previousNumTimes: number;
  previousLastMentionedAt: string | null;
  newNumTimes: number;
  newLastMentionedAt: string | null;
  mergedCount: number;
}

/**
 * 대표 항목에 병합된 N건의 num_times·last_mentioned_at을 반영하여 대표의 반복 메타를 갱신한다.
 * (Issue #20: 병합 시 반복 정보 보존)
 *
 * @param db 데이터베이스 연결
 * @param representativeId 대표 memory_item ID
 * @param mergedIds 병합되어 대표로 흡수된 memory_item ID 목록 (대표 자신은 제외)
 * @returns 갱신 결과. 스키마에 num_times/last_mentioned_at이 없으면 no-op 후 반환
 */
export function updateRepresentativeRepetitionMeta(
  db: Database.Database,
  representativeId: string,
  mergedIds: string[]
): RepetitionMetaUpdateResult | null {
  if (mergedIds.length === 0) {
    return null;
  }

  const hasColumns = DatabaseUtils.get(db, `
    SELECT 1 FROM pragma_table_info('memory_item') WHERE name = 'num_times'
  `) as { '1': number } | undefined;
  if (!hasColumns) {
    logger.debug('RepetitionMetaUpdateService: num_times 컬럼 없음, 스킵 (Issue #88 미적용)');
    return null;
  }

  const rep = DatabaseUtils.get(db, `
    SELECT id, num_times, last_mentioned_at, created_at
    FROM memory_item WHERE id = ?
  `, [representativeId]) as { id: string; num_times: number | null; last_mentioned_at: string | null; created_at: string } | undefined;

  if (!rep) {
    throw new Error(`대표 항목을 찾을 수 없습니다: ${representativeId}`);
  }

  const _prevNumTimes = rep.num_times ?? 1;
  const prevLastMentioned = rep.last_mentioned_at ?? rep.created_at ?? null;
  const timestamps: (string | null)[] = [prevLastMentioned];

  let totalNumTimes = rep.num_times ?? 1;
  for (const id of mergedIds) {
    if (id === representativeId) continue;
    const row = DatabaseUtils.get(db, `
      SELECT num_times, last_mentioned_at, created_at FROM memory_item WHERE id = ?
    `, [id]) as { num_times: number | null; last_mentioned_at: string | null; created_at: string } | undefined;
    if (row) {
      totalNumTimes += row.num_times ?? 1;
      const t = row.last_mentioned_at ?? row.created_at ?? null;
      if (t) timestamps.push(t);
    }
  }

  const maxTs = timestamps.filter(Boolean).sort().pop() as string | null ?? new Date().toISOString();

  DatabaseUtils.run(db, `
    UPDATE memory_item
    SET num_times = ?, last_mentioned_at = ?
    WHERE id = ?
  `, [totalNumTimes, maxTs, representativeId]);

  logger.debug('RepetitionMetaUpdateService: 대표 반복 메타 갱신 (Issue #20)', {
    representativeId,
    mergedCount: mergedIds.length,
    newNumTimes: totalNumTimes,
    newLastMentionedAt: maxTs
  });

  return {
    representativeId,
    previousNumTimes: rep.num_times ?? 1,
    previousLastMentionedAt: prevLastMentioned,
    newNumTimes: totalNumTimes,
    newLastMentionedAt: maxTs,
    mergedCount: mergedIds.length
  };
}
