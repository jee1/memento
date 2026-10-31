/**
 * #1548: 최근 기억마다 같은 범위의 옛 기억과 짝을 지어 대체 후보를 판정하고 기록한다.
 *
 * memory_item 은 읽기만 한다. 비활성화, 대체 포인터, 관계 추가는 하지 않는다.
 * 한도는 provider 의 429 로만 판단한다. 429 를 받으면 run 을 멈추고 남은 쌍은 다음 run 이 맡는다.
 */
import type Database from 'better-sqlite3';
import type { ChatLlmPort } from '../../../shared/services/chat-llm/chat-llm-port.js';
import { getLlmUsageLogicalContext, runWithLlmUsageLogicalContext } from '../../../shared/services/llm-usage/llm-usage-logical-context.js';
import { recordLlmUsageLogicalFinal } from '../../../shared/services/llm-usage/llm-usage-recorder.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import { findSupersedeScopeMemories, type SupersedeScopeMemoryRow } from '../repositories/memory-item-repository.js';
import { SupersedeCandidateRepository } from './supersede-candidate-repository.js';
import {
  SUPERSEDE_PROMPT_VERSION,
  computeSupersedeInputHash,
  judgeSupersedePair,
  sha256Hex,
  type ScopedMemory,
  type SupersedeVerdict,
} from './supersede-judge.js';

const SUPERSEDE_DEFAULT_LOOKBACK_DAYS = 7;
const SUPERSEDE_DEFAULT_MAX_PAIRS = 5;
const TOP_OLD_PER_NEW = 3;
/** sleep consolidation 의 seed 유사도에서 출발한 탐색 신호다. 대체 판정이 맞다는 근거가 아니다. */
const MIN_COSINE = 0.65;

export interface SupersedeScanOptions {
  lookbackDays?: number;
  /** run 하나의 판정 시도 수. 일일 상한이 아니다. */
  maxPairs?: number;
  runId: string;
}

export interface SupersedeScanSummary {
  status: 'completed' | 'deferred' | 'not_configured';
  pairsConsidered: number;
  judged: number;
  skippedDuplicate: number;
  skippedNoEmbedding: number;
  failed: number;
  byVerdict: Record<SupersedeVerdict, number>;
}

interface CandidatePair {
  old: SupersedeScopeMemoryRow;
  next: SupersedeScopeMemoryRow;
}

function toScoped(row: SupersedeScopeMemoryRow): ScopedMemory {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    ownerId: row.ownerId,
    projectId: row.projectId,
    privacyScope: row.privacyScope,
    createdAt: row.createdAt,
  };
}

/** 범위가 같은 기억끼리만 짝을 짓는다. null 은 null 끼리만 같다. */
function groupKey(row: SupersedeScopeMemoryRow): string {
  return JSON.stringify([row.ownerId, row.projectId, row.privacyScope, row.type, row.embeddingModel]);
}

function buildPairs(memories: SupersedeScopeMemoryRow[]): CandidatePair[] {
  const groups = new Map<string, SupersedeScopeMemoryRow[]>();
  for (const memory of memories) {
    const key = groupKey(memory);
    const group = groups.get(key);
    if (group) {
      group.push(memory);
    } else {
      groups.set(key, [memory]);
    }
  }

  const pairs: CandidatePair[] = [];
  const recent = memories.filter((m) => m.isRecent).sort((a, b) => b.createdJd - a.createdJd);
  for (const next of recent) {
    const olds = groups
      .get(groupKey(next))!
      .filter((candidate) => candidate.createdJd < next.createdJd)
      .map((old) => ({ old, similarity: cosineSimilarity(next.embedding, old.embedding) }))
      .filter(({ similarity }) => similarity >= MIN_COSINE)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, TOP_OLD_PER_NEW);
    for (const { old } of olds) {
      pairs.push({ old, next });
    }
  }
  return pairs;
}

export class SupersedeCandidateService {
  private readonly repository: SupersedeCandidateRepository;

  constructor(
    private readonly deps: {
      db: Database.Database;
      /** null 이면 LLM 을 호출하지 않는다. */
      port: ChatLlmPort | null;
      model: string | null;
    },
  ) {
    this.repository = new SupersedeCandidateRepository(deps.db);
  }

  async scan(options: SupersedeScanOptions): Promise<SupersedeScanSummary> {
    const summary: SupersedeScanSummary = {
      status: 'completed',
      pairsConsidered: 0,
      judged: 0,
      skippedDuplicate: 0,
      skippedNoEmbedding: 0,
      failed: 0,
      byVerdict: { confirmed: 0, pending: 0, compatible: 0 },
    };

    const { port, model } = this.deps;
    if (!port || !model) {
      summary.status = 'not_configured';
      await runWithLlmUsageLogicalContext('supersede_judge', options.runId, async () => {
        recordLlmUsageLogicalFinal({ finalPath: 'not_configured', finalReason: 'no_llm_client' });
      });
      return summary;
    }

    const lookbackDays = options.lookbackDays ?? SUPERSEDE_DEFAULT_LOOKBACK_DAYS;
    const maxPairs = options.maxPairs ?? SUPERSEDE_DEFAULT_MAX_PAIRS;
    const { memories, withoutEmbedding } = findSupersedeScopeMemories(this.deps.db, lookbackDays);
    summary.skippedNoEmbedding = withoutEmbedding;

    const pairs = buildPairs(memories);
    summary.pairsConsidered = pairs.length;

    let attempts = 0;
    for (const { old, next } of pairs) {
      const oldScoped = toScoped(old);
      const nextScoped = toScoped(next);
      const inputHash = computeSupersedeInputHash({
        promptVersion: SUPERSEDE_PROMPT_VERSION,
        provider: port.provider,
        model,
        old: oldScoped,
        next: nextScoped,
      });
      if (this.repository.hasInputHash(inputHash)) {
        summary.skippedDuplicate += 1;
        continue;
      }
      if (attempts >= maxPairs) {
        break;
      }
      attempts += 1;

      const rateLimited = await runWithLlmUsageLogicalContext('supersede_judge', options.runId, async () => {
        const outcome = await judgeSupersedePair(port, model, oldScoped, nextScoped);
        const usage = { provider: port.provider, model };
        if (outcome.kind === 'judged') {
          const { judgment } = outcome;
          this.repository.insertCandidate({
            oldMemoryId: old.id,
            newMemoryId: next.id,
            ownerId: next.ownerId,
            projectId: next.projectId,
            privacyScope: next.privacyScope,
            memoryType: next.type,
            verdict: judgment.verdict,
            rationale: judgment.rationale,
            evidenceQuote: judgment.evidenceQuote,
            oldContentSha256: sha256Hex(old.content),
            newContentSha256: sha256Hex(next.content),
            provider: port.provider,
            model,
            promptVersion: SUPERSEDE_PROMPT_VERSION,
            inputHash,
            llmLogicalRequestId: getLlmUsageLogicalContext()?.logicalRequestId ?? null,
          });
          summary.judged += 1;
          summary.byVerdict[judgment.verdict] += 1;
          recordLlmUsageLogicalFinal({ finalPath: 'llm', ...usage });
          return false;
        }
        if (outcome.kind === 'rate_limited') {
          recordLlmUsageLogicalFinal({ finalPath: 'deferred', finalReason: 'rate_limited', ...usage });
          return true;
        }
        recordLlmUsageLogicalFinal({ finalPath: 'failed', finalReason: outcome.reason, ...usage });
        summary.failed += 1;
        return false;
      });

      if (rateLimited) {
        summary.status = 'deferred';
        break;
      }
    }
    return summary;
  }
}
