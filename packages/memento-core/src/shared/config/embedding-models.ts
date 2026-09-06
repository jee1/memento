/**
 * 임베딩 모델 식별자 단일 원본 (#889)
 *
 * `MINILM_MODEL_NAME`은 두 곳에서 같은 값이어야 한다.
 * 1. 임베딩 생성 시 `memory_embedding.model`에 기록되는 값
 * 2. 벡터 검색이 "같은 모델로 만든 벡터끼리만 비교"하도록 거르는 기준
 *
 * 모델을 바꾸려면 `MINILM_MODEL_ID`만 바꾸고 `npm run reindex-embeddings`를 돌린다.
 * 재색인이 끝나기 전에도 옛 모델로 만든 행은 검색에서 제외되므로 검색이 깨지지 않는다.
 *
 * 다국어 모델을 쓰는 이유: `all-MiniLM-L6-v2`는 영어 전용이라 한국어 쿼리가
 * 관련성과 무관한 문서를 상위에 올렸다. 측정은 #889 참조.
 */
export const MINILM_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/** HuggingFace 조직 접두사를 뗀 이름. DB `model` 컬럼에 저장되는 값이다. */
export const MINILM_MODEL_NAME = MINILM_MODEL_ID.split('/').pop() as string;

/**
 * provider별로 "이 모델로 만든 벡터만 비교하라"는 필터 값. null이면 거르지 않는다.
 * minilm은 빌드 시점에 모델이 고정이라 거를 수 있다. openai·gemini는 모델이
 * 런타임 설정이라 여기서 단정하지 않는다(#889 범위 밖).
 */
export function getEmbeddingModelFilter(provider: string | undefined): string | null {
  return provider === 'minilm' ? MINILM_MODEL_NAME : null;
}
