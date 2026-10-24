import type { SystemOneClient, SystemOneFailureReason } from '../../../shared/services/typesafe/system-one-client.js';
import { LIMITS } from '../../../shared/constants/relation-constants.js';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import type { RelationCandidate, RelationType } from '../../../shared/types/relation.js';
import { MEMORY_TYPE_RELATION_MAP } from '../../../shared/types/relation.js';
import type { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import {
  clipRelationText,
  prepareRelationCandidatePool,
  RELATION_TEXT_CHARS,
} from './relation-candidate-pool.js';

export const JEV_RELATION_TYPES = [
  'CAUSES',
  'DEPENDS_ON',
  'FOLLOWS',
  'CONTRASTS_WITH',
  'REFERENCES',
  'BELONGS_TO',
] as const satisfies readonly RelationType[];

export type JevRelationType = (typeof JEV_RELATION_TYPES)[number];

/**
 * #1410: linked pairs cleared 0.5 and random pairs did not.
 * Not the search gate (0.4) and not the cluster judge (0.6).
 */
export const RELATION_JEV_TYPE_MIN = 0.5;

/** A pair below this floor is not sent into the type round. */
const RELATION_JEV_RELEVANCE_MIN = 0.5;

export const RELATION_JEV_TIMEOUT_MS = 10_000;

const TYPE_QUESTION: Record<JevRelationType, string> = {
  CAUSES: '새 기억(s)이 기존 기억({target})의 원인이다',
  DEPENDS_ON: '새 기억(s)이 설명하는 대상이나 절차가 성립·실행되려면 기존 기억({target})의 대상이 필수 전제로 필요하다. 단순 참조·내용 반복·시간 순서는 의존이 아니다',
  FOLLOWS: '새 기억(s)의 사건·단계는 기존 기억({target})과 같은 작업 흐름에서 그 뒤에 발생·실행된다. 인과는 필요 없다. 저장 순서·내용 반복·무관한 사건의 시간 인접만으로는 성립하지 않는다',
  CONTRASTS_WITH: '새 기억(s)과 기존 기억({target})은 같은 대상의 같은 비교 축에서 서로 다른 주장·선택지·조건을 대조한다. 같은 내용 반복·동급 작업·단순 후속 실행은 대조가 아니다',
  REFERENCES: '새 기억(s)이 기존 기억({target})을 가리킨다',
  BELONGS_TO: '새 기억(s)이 기존 기억({target})에 속한다',
};

const RELEVANCE_QUESTION = '기존 기억({target})은 새 기억(s)과 같은 구체적 작업 흐름이나 사건의 맥락으로 이어 볼 만하다';

export type JevJudgeResult =
  | { readonly ok: true; readonly candidates: readonly RelationCandidate[] }
  | { readonly ok: false; readonly reason: SystemOneFailureReason };

export function selectWinningType(
  scores: ReadonlyMap<JevRelationType, number>,
  typeMin: number,
): { readonly type: JevRelationType; readonly confidence: number } | null {
  let winner: { type: JevRelationType; confidence: number } | null = null;
  for (const type of JEV_RELATION_TYPES) {
    const score = scores.get(type);
    if (typeof score !== 'number' || !Number.isFinite(score) || score < typeMin) {
      continue;
    }
    if (winner === null || score > winner.confidence) {
      winner = { type, confidence: score };
    }
  }
  return winner;
}

function allowedTypes(sourceType: MemoryItem['type']): JevRelationType[] {
  const applicable = new Set<RelationType>(MEMORY_TYPE_RELATION_MAP[sourceType]);
  return JEV_RELATION_TYPES.filter((type) => applicable.has(type));
}

function fill(template: string, targetKey: string): string {
  return template.replace('{target}', targetKey);
}

export class JevRelationJudge {
  constructor(
    private readonly client: SystemOneClient,
    private readonly embedding: UnifiedEmbeddingService,
  ) {}

  /**
   * Never throws. No chat client and no provider fallback.
   * Both rounds succeed, or nothing is persistable.
   */
  async judge(source: MemoryItem, existing: readonly MemoryItem[]): Promise<JevJudgeResult> {
    try {
      const pool = await prepareRelationCandidatePool(
        this.embedding,
        source,
        existing,
        LIMITS.LLM_CANDIDATE_DEFAULT,
      );
      if (pool.length === 0) {
        return { ok: true, candidates: [] };
      }

      const state: Record<string, string> = {
        s: clipRelationText(source.content, RELATION_TEXT_CHARS),
      };
      pool.forEach((memory, index) => {
        state[`t${index}`] = memory.content;
      });

      const relevance = await this.client.ask(
        state,
        pool.map((_, index) => ({
          id: `r${index}`,
          instructions: fill(RELEVANCE_QUESTION, `t${index}`),
        })),
      );
      if (relevance.ok === false) {
        return { ok: false, reason: relevance.reason };
      }

      const survivors = pool.flatMap((memory, index) => {
        const score = relevance.noulById.get(`r${index}`);
        if (score === undefined || score < RELATION_JEV_RELEVANCE_MIN) {
          return [];
        }
        return [{ memory, index }];
      });
      if (survivors.length === 0) {
        return { ok: true, candidates: [] };
      }

      const types = allowedTypes(source.type);
      if (types.length === 0) {
        return { ok: true, candidates: [] };
      }

      const typed = await this.client.ask(
        state,
        survivors.flatMap(({ index }) => types.map((type) => ({
          id: `y${index}_${type}`,
          instructions: fill(TYPE_QUESTION[type], `t${index}`),
        }))),
      );
      if (typed.ok === false) {
        return { ok: false, reason: typed.reason };
      }

      const candidates: RelationCandidate[] = [];
      for (const survivor of survivors) {
        const scores = new Map<JevRelationType, number>();
        for (const type of types) {
          const noul = typed.noulById.get(`y${survivor.index}_${type}`);
          if (noul !== undefined) {
            scores.set(type, noul);
          }
        }
        const winner = selectWinningType(scores, RELATION_JEV_TYPE_MIN);
        if (winner === null) {
          continue;
        }
        candidates.push({
          source_id: source.id,
          target_id: survivor.memory.id,
          relation_type: winner.type,
          confidence: winner.confidence,
          method: 'jev',
          evidence: `${winner.type} ${winner.confidence}`,
        });
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
      return { ok: true, candidates };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }
}
