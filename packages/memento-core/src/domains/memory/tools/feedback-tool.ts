/**
 * Feedback MCP 도구 — recall 결과에 대한 helpful/not_helpful 기록
 * (FR-004: 에이전트 오케스트레이션에서 recall 완료 후 비동기 호출하는 것을 권장; MCP 도구 자체는 독립 호출)
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { CommonSchemas } from '../../../tools/types.js';
import { FeedbackRepositorySQLite } from '../../../infrastructure/database/repositories/feedback-repository-sqlite.impl.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  formatMementoResourceUri,
  memoryItemResourceKind,
} from '../../../shared/utils/memento-resource-uri.js';

/** SQLite CURRENT_TIMESTAMP 등 비 ISO 문자열을 RFC3339(UTC)로 통일 */
function normalizeFeedbackCreatedAtToIso(createdAt: string): string {
  const s = String(createdAt).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(s);
  if (m) {
    return new Date(`${m[1]}T${m[2]}Z`).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 코멘트·JSON 페이로드·출처 ID 상한 (PII·악용·디스크 사용 완화) */
const FEEDBACK_COMMENT_MAX_LEN = 4096;
const FEEDBACK_SCORE_BREAKDOWN_JSON_MAX = 32_768;
const FEEDBACK_ATTRIBUTION_ID_MAX_LEN = 512;

function findApprovedPromotionCandidate(
  db: NonNullable<ToolContext['db']>,
  memoryId: string,
): { id: string } | null {
  const tableExists = db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'agent_memory_promotion_candidate'
  `).get();
  if (!tableExists) return null;
  const candidate = db.prepare(`
    SELECT id FROM agent_memory_promotion_candidate
    WHERE memory_id = ? AND status = 'approved'
    ORDER BY reviewed_at DESC, id
    LIMIT 1
  `).get(memoryId) as { id: string } | undefined;
  return candidate ?? null;
}

const FeedbackSchema = z.object({
  memory_id: CommonSchemas.MemoryId,
  helpful: z.boolean(),
  comment: z.string().max(FEEDBACK_COMMENT_MAX_LEN).optional(),
  score: z.number().optional(),
  session_id: z.string().max(FEEDBACK_ATTRIBUTION_ID_MAX_LEN).optional(),
  agent_id: z.string().max(FEEDBACK_ATTRIBUTION_ID_MAX_LEN).optional(),
  /**
   * recall 응답 항목의 score_breakdown 스냅샷(US3). JSON 직렬화 가능·크기 상한.
   */
  score_breakdown: z
    .unknown()
    .optional()
    .refine(
      (v) => {
        if (v === undefined || v === null) {
          return true;
        }
        try {
          return JSON.stringify(v).length <= FEEDBACK_SCORE_BREAKDOWN_JSON_MAX;
        } catch {
          return false;
        }
      },
      {
        message: `score_breakdown must be JSON-serializable and at most ${FEEDBACK_SCORE_BREAKDOWN_JSON_MAX} characters`
      }
    )
});

export class FeedbackTool extends BaseTool {
  constructor() {
    super(
      'feedback',
      'recall 결과에 대해 helpful/not_helpful 피드백을 기록합니다',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '피드백 대상 기억 ID',
            pattern: '^mem_[a-zA-Z0-9_]+$'
          },
          helpful: { type: 'boolean', description: 'true=helpful, false=not_helpful' },
          comment: {
            type: 'string',
            description: `선택 코멘트 (@memento/client feedback과 동일), 최대 ${FEEDBACK_COMMENT_MAX_LEN}자`,
            maxLength: FEEDBACK_COMMENT_MAX_LEN
          },
          score: { type: 'number', description: '선택 점수' },
          session_id: {
            type: 'string',
            description: 'MCP 세션 ID (선택)',
            maxLength: FEEDBACK_ATTRIBUTION_ID_MAX_LEN
          },
          agent_id: {
            type: 'string',
            description: '에이전트 식별자 (선택)',
            maxLength: FEEDBACK_ATTRIBUTION_ID_MAX_LEN
          },
          score_breakdown: {
            type: 'object',
            description:
              `선택 recall score_breakdown 스냅샷(US3). JSON으로 직렬화 시 최대 ${FEEDBACK_SCORE_BREAKDOWN_JSON_MAX}자`,
            additionalProperties: true
          }
        },
        required: ['memory_id', 'helpful']
      }
    );
  }

  /** contracts/mcp-tools.md — MCP JSON 본문 계약(success:false, error 키) */
  private feedbackContractError(kind: 'memory not found' | 'storage error'): ToolResult {
    const payload = { success: false, error: kind };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2)
        }
      ],
      error: kind
    };
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const t0 = Date.now();
    const parsed = FeedbackSchema.parse(params);
    this.validateDatabase(context);

    try {
      const row = context.db!
        .prepare('SELECT id, owner_id, type FROM memory_item WHERE id = ?')
        .get(parsed.memory_id) as { id: string; owner_id: string | null; type: string } | undefined;
      if (!row) {
        return this.feedbackContractError('memory not found');
      }

      let scoreBreakdownJson: string | null = null;
      if (parsed.score_breakdown !== undefined && parsed.score_breakdown !== null) {
        scoreBreakdownJson = JSON.stringify(parsed.score_breakdown);
      }

      const repo = new FeedbackRepositorySQLite(context.db!);
      const event = parsed.helpful ? 'helpful' : 'not_helpful';
      const inserted = repo.insertFeedback({
        memory_id: parsed.memory_id,
        event,
        score: parsed.score,
        comment: parsed.comment,
        session_id: parsed.session_id,
        agent_id: parsed.agent_id,
        score_breakdown_json: scoreBreakdownJson
      });

      const ownerForTel = parsed.agent_id ?? context.agentId ?? null;
      context.services?.telemetryService?.record({
        eventType: parsed.helpful ? 'memory.feedback.positive' : 'memory.feedback.negative',
        outcome: 'success',
        ownerId: ownerForTel,
        latencyMs: Date.now() - t0,
        extraData: { memory_id: parsed.memory_id }
      });
      const promotionCandidate = findApprovedPromotionCandidate(context.db!, parsed.memory_id);
      if (promotionCandidate) {
        context.services?.telemetryService?.record({
          eventType: 'agent.promotion.usage',
          outcome: parsed.helpful ? 'success' : 'failure',
          ownerId: ownerForTel,
          latencyMs: Date.now() - t0,
          extraData: {
            candidateId: promotionCandidate.id,
            memoryId: parsed.memory_id,
            usageOutcome: parsed.helpful ? 'used' : 'negative'
          }
        });
      }

      return this.createSuccessResult({
        success: true,
        memory_id: parsed.memory_id,
        uri: formatMementoResourceUri({
          ownerId: row.owner_id,
          kind: memoryItemResourceKind(row.type),
          id: parsed.memory_id,
        }),
        feedback_id: String(inserted.id),
        helpful: parsed.helpful,
        created_at: normalizeFeedbackCreatedAtToIso(inserted.created_at)
      });
    } catch (error) {
      const iso = new Date().toISOString();
      logger.warn('feedback_event 저장 실패', {
        memory_id: parsed.memory_id,
        session_id: parsed.session_id,
        agent_id: parsed.agent_id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: iso
      });
      return this.feedbackContractError('storage error');
    }
  }
}
