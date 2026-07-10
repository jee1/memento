import type {
  LinkResult,
  ExportResult,
  FeedbackResult,
  FeedbackCallOptions,
  RecordRecallFeedbackOptions,
  SearchResult,
  ContextInjectionParams,
  ContextInjectionResult,
} from '../types.js';
import type { MementoClientCore } from './client-context.js';

/**
 * 기억 간 관계 생성
 */
export async function link(
  client: MementoClientCore,
  sourceId: string,
  targetId: string,
  relationType: 'cause_of' | 'derived_from' | 'duplicates' | 'contradicts',
): Promise<LinkResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/link', {
    source_id: sourceId,
    target_id: targetId,
    relation_type: relationType,
  });

  return response.data;
}

/**
 * 기억보내기
 */
export async function exportMemories(
  client: MementoClientCore,
  format: 'json' | 'csv' | 'markdown',
  filters?: import('../types.js').SearchFilters,
): Promise<ExportResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/export', {
    format,
    filters,
  });

  return response.data;
}

/**
 * 피드백 제공
 */
export async function feedback(
  client: MementoClientCore,
  memoryId: string,
  helpful: boolean,
  comment?: string,
  score?: number,
  score_breakdown?: unknown,
  options?: FeedbackCallOptions,
): Promise<FeedbackResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/feedback', {
    memory_id: memoryId,
    helpful,
    comment,
    score,
    ...(score_breakdown !== undefined ? { score_breakdown } : {}),
    ...(options?.session_id !== undefined ? { session_id: options.session_id } : {}),
    ...(options?.agent_id !== undefined ? { agent_id: options.agent_id } : {}),
  });

  const result = response.data.result;
  return result;
}

/**
 * recall 결과 항목의 score_breakdown을 추출해 feedback()을 호출합니다 (Issue #666).
 */
export async function recordRecallFeedback(
  client: MementoClientCore,
  recallResult: SearchResult,
  memoryId: string,
  helpful: boolean,
  options?: RecordRecallFeedbackOptions,
): Promise<FeedbackResult> {
  const item = recallResult.items.find(i => i.id === memoryId);
  const scoreBreakdown = item?.score_breakdown;
  return feedback(
    client,
    memoryId,
    helpful,
    options?.comment,
    options?.score,
    scoreBreakdown,
    options,
  );
}

/**
 * 컨텍스트 주입
 */
export async function injectContext(
  client: MementoClientCore,
  params: ContextInjectionParams,
): Promise<ContextInjectionResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/prompts/memory_injection', params);
  return response.data;
}
