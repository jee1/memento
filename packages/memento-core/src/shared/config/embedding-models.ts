/**
 * 로컬 임베딩 모델 정의 단일 원본 (#889, #1729)
 *
 * 임베딩 제공자 값 `minilm` 뒤에서 도는 모델은 한 번에 하나다. 모델에 따라 달라지는 값은
 * 이 객체에 둔다. `storedName` 은 두 곳에서 같은 값이어야 한다.
 * 1. 임베딩 생성 시 `memory_embedding.model`에 기록되는 값
 * 2. 벡터 검색이 "같은 모델로 만든 벡터끼리만 비교"하도록 거르는 기준
 *
 * 모델을 바꾸면 `storedName` 이 달라져 옛 모델로 만든 행은 검색에서 빠진다.
 * 재색인이 끝나기 전에도 검색이 깨지지 않는다.
 *
 * 다국어 모델을 쓰는 이유: `all-MiniLM-L6-v2`는 영어 전용이라 한국어 쿼리가
 * 관련성과 무관한 문서를 상위에 올렸다. 측정은 #889 참조.
 */
/** 질의 벡터(검색어)와 기억 벡터(저장하는 글). 저장하는 것은 기억 벡터뿐이다. */
export type EmbeddingRole = 'query' | 'passage';

export interface LocalEmbeddingModel {
  /** memory_embedding.model 에 저장되는 이름. 벡터 공간의 정체성이다. 위치(source)에서 떼어 내지 않는다. */
  readonly storedName: string;
  /** 파일 위치. 지금은 transformers.js 가 내려받는 원격 저장소다. */
  readonly source: { readonly repo: string; readonly dtype: 'q8' };
  readonly dimensions: 384;
  /** 역할마다 창 앞에 붙이는 글. 창 크기는 510 에서 이 접두의 토큰 수를 뺀 값이다. */
  readonly prefixes: Readonly<Record<EmbeddingRole, string>>;
}

export const LOCAL_EMBEDDING_MODEL: LocalEmbeddingModel = {
  storedName: 'paraphrase-multilingual-MiniLM-L12-v2',
  source: { repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dtype: 'q8' },
  dimensions: 384,
  prefixes: { query: '', passage: '' },
};

/**
 * provider별로 "이 모델로 만든 벡터만 비교하라"는 필터 값. null이면 거르지 않는다.
 * minilm은 빌드 시점에 모델이 고정이라 거를 수 있다. openai·gemini는 모델이
 * 런타임 설정이라 여기서 단정하지 않는다(#889 범위 밖).
 */
export function getEmbeddingModelFilter(provider: string | undefined): string | null {
  return provider === 'minilm' ? LOCAL_EMBEDDING_MODEL.storedName : null;
}
