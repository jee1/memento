/**
 * 로컬 임베딩 모델 정의 단일 원본 (#889, #1729)
 *
 * 임베딩 제공자 값 `minilm` 뒤에서 도는 모델은 한 번에 하나다. 모델에 따라 달라지는 값은
 * 이 객체에 둔다. `storedName` 은 두 곳에서 같은 값이어야 한다.
 * 1. 임베딩 생성 시 `memory_embedding.model`에 기록되는 값
 * 2. 벡터 검색이 "같은 모델로 만든 벡터끼리만 비교"하도록 거르는 기준
 *
 * 모델을 바꾸면 `storedName` 이 달라져 옛 모델로 만든 행은 검색에서 빠지고, 기동 뒤 모델 이주가
 * 다시 만든다(BatchScheduler.startModelMigration). 이주가 끝나기 전에도 검색이 깨지지 않는다.
 *
 * 지금 모델은 한국어 검색용으로 다듬은 dragonkue/multilingual-e5-small-ko-v2 다(#1729). 앞 모델
 * paraphrase-multilingual-MiniLM-L12-v2 는 운영 질문 262개의 의미 후보 상위 20 에 정답을 23% 만 올렸다(이 모델 85%).
 */
/** 질의 벡터(검색어)와 기억 벡터(저장하는 글). 저장하는 것은 기억 벡터뿐이다. */
export type EmbeddingRole = 'query' | 'passage';

export interface LocalEmbeddingModel {
  /** memory_embedding.model 에 저장되는 이름. 벡터 공간의 정체성이다. 위치(source)에서 떼어 내지 않는다. */
  readonly storedName: string;
  /**
   * 파일 위치. 앱이 정확한 버전으로 의존하는 모델 전용 npm 패키지다. 패키지 안 폴더 이름이 storedName 이고
   * transformers.js 의 모델 id 다. 원격 내려받기는 끈다.
   */
  readonly source: { readonly packageName: string; readonly dtype: 'q8' };
  readonly dimensions: 384;
  /** 역할마다 창 앞에 붙이는 글. 창 크기는 510 에서 이 접두의 토큰 수를 뺀 값이다. */
  readonly prefixes: Readonly<Record<EmbeddingRole, string>>;
  /** 질의-기억 코사인을 검색 상수가 맞춰진 척도로 옮기는 1차 변환. 기억끼리 비교에는 쓰지 않는다. */
  readonly queryScoreMapping: { readonly a: number; readonly b: number };
  /** 기억끼리 비교의 raw 코사인 기준값. env 덮어쓰기가 있는 셋도 이 값이 기본값이다. */
  readonly memorySimilarity: {
    /** Sleep consolidation 군집(env CONSOLIDATION_SIMILARITY_THRESHOLD) */
    readonly consolidationCluster: number;
    /** 요약 합침 대상(env CONSOLIDATION_MERGE_SIMILARITY_THRESHOLD) */
    readonly consolidationMerge: number;
    /** remember 중복 판정과 자동 합침(env MEMENTO_REMEMBER_DEDUP_THRESHOLD) */
    readonly rememberDedup: number;
    /** supersede 후보 탐색 */
    readonly supersedeCandidate: number;
    /** 이웃 기억 기본 임계값 */
    readonly neighbor: number;
    /** 앵커 슬롯별 벡터 임계값 */
    readonly anchorSlots: { readonly A: number; readonly B: number; readonly C: number };
  };
}

export const LOCAL_EMBEDDING_MODEL: LocalEmbeddingModel = {
  storedName: 'multilingual-e5-small-ko-v2',
  source: { packageName: '@jee1/memento-embedding-e5-small-ko-v2', dtype: 'q8' },
  dimensions: 384,
  prefixes: { query: 'query: ', passage: 'passage: ' },
  queryScoreMapping: { a: 1.9943, b: -0.6838 },
  memorySimilarity: {
    consolidationCluster: 0.668,
    consolidationMerge: 0.794,
    rememberDedup: 0.794,
    supersedeCandidate: 0.668,
    neighbor: 0.745,
    anchorSlots: { A: 0.745, B: 0.649, C: 0.566 },
  },
};

/**
 * 질의 점수 사상 (#1729). `embedQuery` 로 만든 질의 벡터와 기억 벡터의 코사인에만 건다.
 * 계수는 로컬 임베딩 모델의 것이라 다른 제공자 점수는 그대로 둔다. 기억끼리 비교(중복 판정 등)에는 쓰지 않는다.
 */
export function mapQueryScore(provider: string | undefined, score: number): number {
  if (provider !== 'minilm') return score;
  const { a, b } = LOCAL_EMBEDDING_MODEL.queryScoreMapping;
  return Math.min(1, Math.max(0, a * score + b));
}

/**
 * provider별로 "이 모델로 만든 벡터만 비교하라"는 필터 값. null이면 거르지 않는다.
 * minilm은 빌드 시점에 모델이 고정이라 거를 수 있다. openai·gemini는 모델이
 * 런타임 설정이라 여기서 단정하지 않는다(#889 범위 밖).
 */
export function getEmbeddingModelFilter(provider: string | undefined): string | null {
  return provider === 'minilm' ? LOCAL_EMBEDDING_MODEL.storedName : null;
}
