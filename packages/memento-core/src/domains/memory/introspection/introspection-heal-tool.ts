/**
 * Introspection Heal Tool (Issue #728)
 *
 * meta_memory_introspection 스캔(저신뢰·고실패 메모리)을 re-embed·demote·soft-delete·
 * review 액션으로 전환한다. `migrate_embeddings`·`convert_episodic_to_semantic`과 같은
 * 대량 스캔·치유형 운영 도구 컨벤션을 따라 MCP 레지스트리(tools/index.ts)에는 등록하지
 * 않고 admin HTTP route에서만 호출한다 (agent가 대량 importance/삭제를 스스로 트리거하지
 * 못하도록).
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { IntrospectionHealingService } from './introspection-healing-service.js';

const IntrospectionHealSchema = z.object({
  provider: z.enum(['tfidf', 'lightweight', 'minilm', 'openai', 'gemini']).optional(),
  // 안전 기본값: 명시적으로 false를 줘야 실제 DB가 바뀐다.
  dry_run: z.boolean().optional().default(true),
  low_confidence_threshold: z.number().min(0).max(1).optional(),
  high_failure_count_threshold: z.number().int().min(0).optional(),
  demote_factor: z.number().min(0).max(1).optional(),
  min_importance: z.number().min(0).max(1).optional(),
  soft_delete_importance_threshold: z.number().min(0).max(1).optional(),
});

export class IntrospectionHealTool extends BaseTool {
  constructor() {
    super(
      'introspection_heal',
      'meta_memory_introspection 스캔 결과(저신뢰·고실패 메모리)를 re-embed/demote/soft-delete/review 액션으로 전환합니다. dry_run 기본값 true.',
      {
        type: 'object',
        properties: {
          provider: {
            type: 'string',
            enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'],
            description: 're-embed 대상 판정·실행에 쓸 provider (기본: EMBEDDING_PROVIDER 설정값)',
          },
          dry_run: {
            type: 'boolean',
            default: true,
            description: 'true면 분류만 하고 DB를 바꾸지 않음 (기본값)',
          },
          low_confidence_threshold: { type: 'number', minimum: 0, maximum: 1 },
          high_failure_count_threshold: { type: 'number', minimum: 0 },
          demote_factor: { type: 'number', minimum: 0, maximum: 1 },
          min_importance: { type: 'number', minimum: 0, maximum: 1 },
          soft_delete_importance_threshold: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    this.logInfo('Introspection Heal 도구 호출됨', { params });

    try {
      const parsed = IntrospectionHealSchema.parse(params);
      this.validateDatabase(context);
      this.validateService(context.services.embeddingService, '임베딩 서비스');

      const service = new IntrospectionHealingService(context.db!, context.services.embeddingService!);
      const result = await service.heal({
        provider: parsed.provider,
        dryRun: parsed.dry_run,
        lowConfidenceThreshold: parsed.low_confidence_threshold,
        highFailureCountThreshold: parsed.high_failure_count_threshold,
        demoteFactor: parsed.demote_factor,
        minImportance: parsed.min_importance,
        softDeleteImportanceThreshold: parsed.soft_delete_importance_threshold,
      });

      return this.createSuccessResult(result);
    } catch (error) {
      this.logError(error as Error, 'Introspection Heal 도구 실행 실패', { params });

      if (error instanceof z.ZodError) {
        return this.createErrorResult(
          'INVALID_PARAMETERS',
          '파라미터 검증 실패',
          error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        );
      }

      return this.createErrorResult(
        'INTROSPECTION_HEAL_FAILED',
        'introspection heal 실행 실패',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
