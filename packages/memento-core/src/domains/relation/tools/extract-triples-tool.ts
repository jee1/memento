/**
 * extract_triples MCP 도구 — 청킹·추출·병합 파이프라인, 선택적 kg_triple 저장
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { logger } from '../../../shared/utils/logger.js';
import { normalizeChatMessagesToText, type ChatMessageInput } from '../services/triple-extraction/triple-input-normalizer.js';
import { TripleExtractionService } from '../services/triple-extraction/triple-extraction-service.js';
import { TriplePipelineOrchestrator } from '../services/triple-extraction/triple-pipeline-orchestrator.js';
import { KgTripleRepository } from '../../memory/repositories/kg-triple-repository.js';
import type { TripleExtractionOptions } from '../../../shared/types/triple-extraction.js';

const ExtractTriplesSchema = z
  .object({
    content: z.string().optional(),
    messages: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .optional(),
    chunk_size: z.number().int().min(100).max(50000).optional(),
    chunk_overlap: z.number().int().min(0).max(10000).optional(),
    merge_strategy: z.enum(['dedupe_spo']).optional(),
    persist: z.boolean().optional(),
    process_id: z.string().optional(),
    session_id: z.string().optional(),
  })
  .refine(
    (d) => {
      const hasContent = d.content !== undefined && d.content.trim().length > 0;
      const hasMessages = Array.isArray(d.messages) && d.messages.length > 0;
      return hasContent !== hasMessages;
    },
    { message: 'Provide exactly one of content or non-empty messages' },
  );

export function resolveExtractTriplesOwner(context: ToolContext): string | null {
  return context.agentId ?? null;
}

/** chunk_overlap >= chunkSize 이면 splitTextIntoChunks가 실패하므로 조정한다. */
export function normalizeChunkOverlapForPipeline(
  chunkSize: number,
  chunkOverlap: number,
): number {
  if (chunkOverlap < chunkSize) {
    return chunkOverlap;
  }
  return Math.max(0, chunkSize - 1);
}

export class ExtractTriplesTool extends BaseTool {
  constructor() {
    super(
      'extract_triples',
      '대화 메시지 또는 단일 본문에서 트리플을 청킹·추출·병합합니다. 선택적으로 kg_triple에 저장합니다.',
      {
        type: 'object',
        properties: {
          content: { type: 'string', description: '추출할 단일 본문 (messages와 동시 사용 불가)' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
            description: '채팅 메시지 배열 (content와 동시 사용 불가)',
          },
          chunk_size: { type: 'number', description: '청크 크기 (기본 8000, 100~50000)' },
          chunk_overlap: { type: 'number', description: '청크 겹침 (기본 200, < chunk_size)' },
          merge_strategy: { type: 'string', enum: ['dedupe_spo'], description: '병합 전략 (선택)' },
          persist: { type: 'boolean', description: 'true면 kg_triple에 upsert' },
          process_id: { type: 'string', description: 'Memori Attribution process_id' },
          session_id: { type: 'string', description: 'Memori Attribution session_id' },
        },
      },
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const parsedResult = ExtractTriplesSchema.safeParse(params);
    if (!parsedResult.success) {
      logger.info('extract_triples: schema validation failed', {
        tool: 'extract_triples',
        error: 'INVALID_INPUT',
        issue_codes: parsedResult.error.issues.map((i) => i.code),
        issue_paths: parsedResult.error.issues.map((i) => i.path.join('.')),
      });
      return this.createErrorResult('INVALID_INPUT', parsedResult.error.message);
    }

    const d = parsedResult.data;
    void d.merge_strategy;

    let text: string;
    if (d.content !== undefined && d.content.trim().length > 0) {
      text = d.content.trim();
    } else {
      text = normalizeChatMessagesToText(toChatMessageInputs(d.messages));
    }

    const chunkSize = d.chunk_size ?? 8000;
    let chunkOverlap = d.chunk_overlap ?? 200;
    if (chunkOverlap >= chunkSize) {
      const before = chunkOverlap;
      chunkOverlap = normalizeChunkOverlapForPipeline(chunkSize, chunkOverlap);
      logger.info('extract_triples: adjusted chunk_overlap', {
        tool: 'extract_triples',
        chunk_size: chunkSize,
        chunk_overlap_before: before,
        chunk_overlap_after: chunkOverlap,
      });
    }

    const extractionOptions: TripleExtractionOptions = {};
    const extractionService = new TripleExtractionService();
    const orchestrator = new TriplePipelineOrchestrator();

    try {
      const result = await orchestrator.run(
        { text, chunkSize, chunkOverlap, extractionOptions },
        (chunk) => extractionService.extractTriples(chunk, extractionOptions),
      );

      let persistedCount: number | undefined;
      if (d.persist === true) {
        this.validateDatabase(context);
        const repo = new KgTripleRepository(context.db);
        const ownerId = resolveExtractTriplesOwner(context);
        const processId = d.process_id ?? context.processId ?? null;
        const sessionId = d.session_id ?? context.sessionId ?? null;
        persistedCount = 0;
        for (const t of result.triples) {
          repo.upsertTriple({
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
            owner_id: ownerId,
            process_id: processId,
            session_id: sessionId,
            representative_memory_id: null,
          });
          persistedCount++;
        }
      }

      const payload: Record<string, unknown> = {
        success: true,
        triples: result.triples,
        chunk_errors: result.chunkErrors.map((e) => ({
          chunk_index: e.chunkIndex,
          reason: e.reason,
          message: e.message,
        })),
        chunks_processed: result.chunksProcessed,
      };
      if (persistedCount !== undefined) {
        payload.persisted_count = persistedCount;
      }
      return this.createSuccessResult(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.info('extract_triples: pipeline error', {
        tool: 'extract_triples',
        error: message.slice(0, 500),
      });
      return this.createErrorResult('EXTRACTION_FAILED', message);
    }
  }
}

function toChatMessageInputs(messages: Array<{ role?: string; content?: string }> | undefined): ChatMessageInput[] {
  return (messages ?? []).flatMap((message) => (
    typeof message.role === 'string' && typeof message.content === 'string'
      ? [{ role: message.role, content: message.content }]
      : []
  ));
}
