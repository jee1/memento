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
import {
  findRecentSupersedeScopeMemories,
  forEachSupersedeScopeMemory,
  getMemoryContentById,
  type SupersedeScopeMemoryRow,
} from '../repositories/memory-item-repository.js';
import { SupersedeCandidateRepository } from './supersede-candidate-repository.js';
import {
  SUPERSEDE_PROMPT_VERSION,
  computeSupersedeInputHash,
  judgeSupersedePair,
  sha256Hex,
  type ScopedMemory,
  type SupersedeVerdict,
} from './supersede-judge.js';
import { LOCAL_EMBEDDING_MODEL } from '../../../shared/config/embedding-models.js';
import { SUPERSEDE_DEFAULT_MAX_PAIRS } from '../../../shared/config/constants.js';

const SUPERSEDE_DEFAULT_LOOKBACK_DAYS = 7;
const TOP_OLD_PER_NEW = 3;
/** #1840: 제공자 장애(5xx, 시간 초과) 때 상한까지 같은 실패를 되풀이하지 않는다. 남은 쌍은 다음 스캔이 맡는다. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** sleep consolidation 의 seed 유사도에서 출발한 탐색 신호다. 대체 판정이 맞다는 근거가 아니다. */
const MIN_COSINE = LOCAL_EMBEDDING_MODEL.memorySimilarity.supersedeCandidate;

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
  /** 거절 당시와 같은 old/new 내용 해시인 쌍. */
  skippedDismissed: number;
  skippedNoEmbedding: number;
  failed: number;
  byVerdict: Record<SupersedeVerdict, number>;
}

/** 쌍을 짓고 나면 벡터는 쓰지 않으므로 쥐지 않는다. */
type PairMemory = Omit<SupersedeScopeMemoryRow, 'embedding'>;

interface CandidatePair {
  old: PairMemory;
  next: PairMemory;
}

function toScoped(row: PairMemory, content: string): ScopedMemory {
  return {
    id: row.id,
    content,
    type: row.type,
    ownerId: row.ownerId,
    projectId: row.projectId,
    privacyScope: row.privacyScope,
    createdAt: row.createdAt,
  };
}

/** 범위가 같은 기억끼리만 짝을 짓는다. null 은 null 끼리만 같다. */
function groupKey(row: PairMemory): string {
  return JSON.stringify([row.ownerId, row.projectId, row.privacyScope, row.type, row.embeddingModel]);
}

/**
 * #1622: consolidation 요약은 에피소드에서 뽑아낸 파생물이라 사용자가 직접 남긴 기억을 대체할 근거가 못 된다.
 * 사용자 기억이 요약을 대체하는 쌍과 요약끼리의 쌍(다시 요약한 결과)은 그대로 판정한다.
 * 출처 미상의 옛 기억은 사용자 것인지 알 수 없어 막지 않는다.
 */
function canSupersede(old: PairMemory, next: PairMemory): boolean {
  return !(next.origin === 'consolidation' && old.origin === 'user');
}

/**
 * 최근 기억마다 같은 범위의 더 오래된 기억 중 유사도 상위 TOP_OLD_PER_NEW 개와 짝을 짓는다.
 * 옛 기억은 한 행씩 훑으며 최근 기억별 상위 목록만 갱신해, 전체를 메모리에 올리지 않는다 (#1789).
 * 같은 유사도는 훑은 순서가 앞선 쪽이 먼저다.
 */
function buildPairs(db: Database.Database, lookbackDays: number): { pairs: CandidatePair[]; withoutEmbedding: number } {
  const recent = findRecentSupersedeScopeMemories(db, lookbackDays).sort((a, b) => b.createdJd - a.createdJd);
  const tops = recent.map(() => [] as Array<{ old: PairMemory; similarity: number }>);
  const recentByGroup = new Map<string, number[]>();
  recent.forEach((next, index) => {
    const key = groupKey(next);
    const indexes = recentByGroup.get(key);
    if (indexes) {
      indexes.push(index);
    } else {
      recentByGroup.set(key, [index]);
    }
  });

  const { withoutEmbedding } = forEachSupersedeScopeMemory(db, ({ embedding, ...old }) => {
    for (const index of recentByGroup.get(groupKey(old)) ?? []) {
      const next = recent[index]!;
      if (old.createdJd >= next.createdJd || !canSupersede(old, next)) {
        continue;
      }
      const similarity = cosineSimilarity(next.embedding, embedding);
      const top = tops[index]!;
      if (!(similarity >= MIN_COSINE) || (top.length === TOP_OLD_PER_NEW && similarity <= top[top.length - 1]!.similarity)) {
        continue;
      }
      let at = top.length;
      while (at > 0 && top[at - 1]!.similarity < similarity) {
        at -= 1;
      }
      top.splice(at, 0, { old, similarity });
      top.length = Math.min(top.length, TOP_OLD_PER_NEW);
    }
  });

  const pairs: CandidatePair[] = [];
  recent.forEach(({ embedding: _embedding, ...next }, index) => {
    for (const { old } of tops[index]!) {
      pairs.push({ old, next });
    }
  });
  return { pairs, withoutEmbedding };
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
      skippedDismissed: 0,
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
    const { pairs, withoutEmbedding } = buildPairs(this.deps.db, lookbackDays);
    summary.skippedNoEmbedding = withoutEmbedding;
    summary.pairsConsidered = pairs.length;

    let attempts = 0;
    let consecutiveFailures = 0;
    let nextId: string | null = null;
    let nextText: string | undefined;
    for (const { old, next } of pairs) {
      if (nextId !== next.id) {
        nextId = next.id;
        nextText = getMemoryContentById(this.deps.db, next.id);
      }
      const oldText = getMemoryContentById(this.deps.db, old.id);
      if (oldText === undefined || nextText === undefined) {
        continue;
      }
      const oldScoped = toScoped(old, oldText);
      const nextScoped = toScoped(next, nextText);
      const inputHash = computeSupersedeInputHash({
        promptVersion: SUPERSEDE_PROMPT_VERSION,
        provider: port.provider,
        model,
        old: oldScoped,
        next: nextScoped,
      });
      const oldContentSha256 = sha256Hex(oldText);
      const newContentSha256 = sha256Hex(nextText);
      if (this.repository.hasDismissedPair(old.id, next.id, oldContentSha256, newContentSha256)) {
        summary.skippedDismissed += 1;
        continue;
      }
      // #1840: 본문이 같은 쌍은 제공자나 프롬프트가 바뀌어도 다시 판정하지 않는다. 검토 목록이 쌍을 묶지 않는다.
      if (
        this.repository.hasJudgedPair({
          oldMemoryId: old.id,
          newMemoryId: next.id,
          oldContentSha256,
          newContentSha256,
          ownerId: next.ownerId,
          projectId: next.projectId,
          privacyScope: next.privacyScope,
          memoryType: next.type,
        })
      ) {
        summary.skippedDuplicate += 1;
        continue;
      }
      if (attempts >= maxPairs) {
        break;
      }
      attempts += 1;

      const step = await runWithLlmUsageLogicalContext('supersede_judge', options.runId, async (): Promise<'judged' | 'rate_limited' | 'failed'> => {
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
            oldContentSha256,
            newContentSha256,
            provider: port.provider,
            model,
            promptVersion: SUPERSEDE_PROMPT_VERSION,
            inputHash,
            llmLogicalRequestId: getLlmUsageLogicalContext()?.logicalRequestId ?? null,
          });
          summary.judged += 1;
          summary.byVerdict[judgment.verdict] += 1;
          recordLlmUsageLogicalFinal({ finalPath: 'llm', ...usage });
          return 'judged';
        }
        if (outcome.kind === 'rate_limited') {
          recordLlmUsageLogicalFinal({ finalPath: 'deferred', finalReason: 'rate_limited', ...usage });
          return 'rate_limited';
        }
        recordLlmUsageLogicalFinal({ finalPath: 'failed', finalReason: outcome.reason, ...usage });
        summary.failed += 1;
        return 'failed';
      });

      consecutiveFailures = step === 'failed' ? consecutiveFailures + 1 : 0;
      if (step === 'rate_limited' || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.status = 'deferred';
        break;
      }
    }
    return summary;
  }
}
