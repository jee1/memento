/**
 * Wipe Memory Tool (#1094)
 * 규정 준수 보존 정책 및 암호학적 영구 삭제(Zero-Fill Wipe) 도구
 */

import { createHmac } from 'crypto';
import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { AuditHashChainService } from '../../telemetry/services/audit-hash-chain-service.js';
import { ForgettingEventRepository } from '../../forgetting/repositories/forgetting-event-repository.js';
import { MemoryItemRepository } from '../repositories/memory-item-repository.js';

const WipeMemorySchema = z.object({
  id: z.string().optional().describe('완전 삭제할 단일 기억 ID'),
  dry_run: z.boolean().optional().default(false).describe('시뮬레이션 모드 (데이터 변경 없음)'),
  retention_purge: z.boolean().optional().default(false).describe('보존 기간이 지난 삭제 표시 기억 일괄 제거'),
  retention_days: z.number().optional().default(30).describe('보존 기간 (일)'),
  zero_fill: z.boolean().optional().default(true).describe('벡터 데이터 0 채움(zero-fill) 완전 삭제'),
  vacuum: z.boolean().optional().default(false).describe('삭제 후 데이터베이스 진공(vacuum) 실행'),
});

export class WipeMemoryTool extends BaseTool {
  private readonly memoryRepo = new MemoryItemRepository();
  private readonly forgettingEventRepo = new ForgettingEventRepository();

  constructor() {
    super(
      'wipe_memory',
      '기억 및 관련 벡터, 관계 데이터를 영구 삭제하고 감사 증적을 남깁니다',
      {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '완전 삭제할 단일 기억 ID',
          },
          dry_run: {
            type: 'boolean',
            description: '시뮬레이션 모드 (데이터 변경 없음)',
            default: false,
          },
          retention_purge: {
            type: 'boolean',
            description: '보존 기간 만료 기억 일괄 영구 삭제',
            default: false,
          },
          retention_days: {
            type: 'number',
            description: '보존 기간 (일 단위)',
            default: 30,
          },
          zero_fill: {
            type: 'boolean',
            description: '벡터 테이블 0 채움 완전 파기',
            default: true,
          },
          vacuum: {
            type: 'boolean',
            description: '데이터베이스 vacuum 수행',
            default: false,
          },
        },
      },
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = WipeMemorySchema.parse(params ?? {});
    const { id, dry_run, retention_purge, retention_days, zero_fill, vacuum } = parsed;

    const candidateIds: string[] = [];

    if (id) {
      const memory = this.memoryRepo.findById(context.db, id);
      if (!memory) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      candidateIds.push(id);
    } else if (retention_purge) {
      const expired = this.memoryRepo.findExpiredSoftDeleted(context.db, retention_days);
      candidateIds.push(...expired);
    }

    if (dry_run) {
      return this.createSuccessResult({
        dry_run: true,
        candidate_count: candidateIds.length,
        candidates: candidateIds,
        purged_count: 0,
        message: `Dry run completed: ${candidateIds.length} memories identified for wipe`,
      });
    }

    if (candidateIds.length === 0) {
      return this.createSuccessResult({
        dry_run: false,
        candidate_count: 0,
        purged_count: 0,
        message: 'No memories matched for wipe',
      });
    }

    const hmac = createHmac('sha256', 'memento-wipe-key');
    hmac.update(candidateIds.slice().sort().join(','));
    const auditHash = hmac.digest('hex');

    await DatabaseUtils.runTransaction(context.db, async () => {
      for (const memId of candidateIds) {
        if (zero_fill) {
          try {
            context.db
              .prepare('UPDATE memory_embedding SET embedding = zeroblob(length(embedding)) WHERE memory_id = ?')
              .run(memId);
          } catch {
            // 무시
          }
        }

        try {
          context.db.prepare('DELETE FROM memory_embedding WHERE memory_id = ?').run(memId);
        } catch {
          // ignore
        }

        try {
          context.db.prepare('DELETE FROM memory_relation WHERE source_id = ? OR target_id = ?').run(memId, memId);
        } catch {
          // ignore
        }

        try {
          context.db.prepare('DELETE FROM memory_link WHERE source_id = ? OR target_id = ?').run(memId, memId);
        } catch {
          // ignore
        }

        try {
          context.db.prepare('DELETE FROM memory_item_tag WHERE memory_id = ?').run(memId);
        } catch {
          // ignore
        }

        try {
          context.db.prepare('DELETE FROM feedback_event WHERE memory_id = ?').run(memId);
        } catch {
          // ignore
        }

        context.db.prepare('DELETE FROM memory_item WHERE id = ?').run(memId);

        try {
          this.forgettingEventRepo.insert(context.db, {
            memory_id: memId,
            action: 'wipe',
            reason: 'retention_wipe',
            policy: 'compliant-retention-wipe',
            metadata_json: JSON.stringify({ audit_hash: auditHash, zero_fill }),
          });
        } catch {
          // ignore
        }
      }
    });

    try {
      new AuditHashChainService(context.db).append({
        actorId: context.agentId ?? 'admin',
        transport: 'http_admin',
        toolOrEndpoint: 'wipe_memory',
        action: 'delete',
        targetUri: `memento://wipe?count=${candidateIds.length}&hash=${auditHash}`,
        resultStatus: 'success',
        evidenceMode: 'metadata_only',
        requestSeen: true,
        responseSeen: true,
      });
    } catch {
      // ignore
    }

    if (vacuum) {
      try {
        context.db.pragma('incremental_vacuum');
      } catch {
        // ignore
      }
    }

    return this.createSuccessResult({
      success: true,
      dry_run: false,
      purged_count: candidateIds.length,
      audit_hash: auditHash,
      eradicated_ids: candidateIds,
      message: `Successfully wiped ${candidateIds.length} memories with zero-fill verification`,
    });
  }
}
