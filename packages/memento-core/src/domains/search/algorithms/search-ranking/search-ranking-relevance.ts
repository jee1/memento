/**
 * 검색 관련성(relevance) 점수 계산
 */

import type { RelevanceInput } from './search-ranking.types.js';
import { cosineSimilarity } from '../../../../shared/utils/vector-math.js';

/**
 * 단일 지표만으로는 검색 관련성을 정확히 평가할 수 없으므로, 다양한 관련성 지표를 가중 평균하여 종합적인 관련성 점수를 계산합니다.
 * 임베딩 유사도, BM25, 태그 매칭, 타이틀 히트를 결합하여 검색 정확도를 향상시킵니다.
 */
export function calculateRelevance(input: RelevanceInput): number {
  const { query, content, title, tags, embeddingSimilarity, bm25Result } = input;

  // 잘못된 입력으로 인한 오류를 방지하고 안정적인 점수 계산을 보장합니다.
  if (!query || !content) return 0;

  // 의미적 유사성을 가장 중요하게 평가하여 사용자의 의도와 가장 가까운 결과를 찾습니다.
  const embeddingScore = embeddingSimilarity
    ? calculateEmbeddingSimilarity(embeddingSimilarity.queryEmbedding, embeddingSimilarity.docEmbedding)
    : 0;

  // 키워드 빈도 기반의 전통적인 검색 알고리즘을 활용하여 정확한 키워드 매칭을 보장합니다.
  const bm25Score = bm25Result
    ? normalizeBM25(bm25Result.score)
    : calculateSimpleBM25(query, content);

  // 사용자가 명시적으로 설정한 태그를 활용하여 메타데이터 기반 관련성을 평가합니다.
  const tagScore = calculateTagMatch(query, tags);

  // 문서의 제목이 검색어와 일치하는 경우 높은 관련성을 부여하여 정확한 매칭을 우선 제공합니다.
  const titleScore = title ? calculateTitleHit(query, title) : 0;

  // 각 지표의 중요도에 따라 가중 평균을 적용하여 종합적인 관련성 점수를 계산합니다.
  return 0.60 * embeddingScore +
         0.30 * bm25Score +
         0.05 * tagScore +
         0.05 * titleScore;
}

/**
 * 기존 API와의 호환성을 유지하면서 간단한 관련성 계산을 제공합니다.
 * 임베딩이나 BM25가 없는 경우에도 기본적인 텍스트 매칭을 수행합니다.
 */
export function calculateRelevanceSimple(query: string, content: string, tags: string[] = []): number {
  return calculateRelevance({
    query,
    content,
    tags,
    embeddingSimilarity: undefined,
    bm25Result: undefined
  });
}

/**
 * 벡터 공간에서의 의미적 유사성을 정량화하여 검색 정확도를 향상시킵니다.
 * 코사인 유사도를 사용하여 벡터의 방향성을 비교하고 크기 차이의 영향을 제거합니다.
 */
function calculateEmbeddingSimilarity(queryEmbedding: number[], docEmbedding: number[]): number {
  if (queryEmbedding.length !== docEmbedding.length) return 0;

  const cosine = cosineSimilarity(queryEmbedding, docEmbedding);
  return Math.max(0, cosine); // 음수 유사도를 0으로 제한하여 점수 범위의 일관성을 유지합니다.
}

/**
 * BM25 점수를 0-1 범위로 정규화하여 다른 점수 지표와 일관된 비교가 가능하도록 합니다.
 */
function normalizeBM25(bm25Score: number, kNorm: number = 2.0): number {
  return bm25Score / (bm25Score + kNorm);
}

/**
 * 외부 BM25 라이브러리가 없는 경우에도 기본적인 키워드 빈도 기반 검색을 제공합니다.
 * 간소화된 BM25 알고리즘을 구현하여 검색 기능의 안정성을 보장합니다.
 */
function calculateSimpleBM25(query: string, content: string): number {
  // 잘못된 입력으로 인한 오류를 방지하고 안정적인 점수 계산을 보장합니다.
  if (!query || !content) return 0;

  const queryTerms = query.toLowerCase().split(/\s+/);
  const contentTerms = content.toLowerCase().split(/\s+/);
  const termFreq = new Map<string, number>();

  // 문서 내 각 용어의 출현 빈도를 계산하여 키워드 매칭 점수를 산출합니다.
  for (const term of contentTerms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  }

  let score = 0;
  const k1 = 1.2;
  const b = 0.75;
  const docLength = contentTerms.length;
  const avgDocLength = 100; // 문서 길이 정규화를 위한 평균값을 사용하여 긴 문서의 불공정한 우위를 방지합니다.

  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf > 0) {
      const idf = Math.log(2); // 간단한 IDF를 사용하여 희귀 용어에 더 높은 가중치를 부여합니다. (실제 구현에서는 전체 문서 수가 필요)
      const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
      score += idf * normalizedTf;
    }
  }

  return Math.min(1.0, score / 10); // 점수를 0-1 범위로 정규화하여 다른 지표와 일관된 비교가 가능하도록 합니다.
}

/**
 * 검색어와 태그 간의 집합 유사도를 계산하여 메타데이터 기반 관련성을 평가합니다.
 * 자카드 유사도를 사용하여 교집합과 합집합의 비율로 관련성을 정량화합니다.
 */
function calculateTagMatch(query: string, tags: string[]): number {
  if (tags.length === 0) return 0;

  const queryTerms = new Set(query.toLowerCase().split(/\s+/));
  const tagTerms = new Set(tags.map(tag => tag.toLowerCase()));

  const intersection = new Set([...queryTerms].filter(x => tagTerms.has(x)));
  const union = new Set([...queryTerms, ...tagTerms]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 문서 제목이 검색어와 일치하는 정도를 평가하여 정확한 매칭을 우선 제공합니다.
 * 제목은 문서의 핵심 내용을 요약하므로 높은 관련성 지표로 활용합니다.
 */
function calculateTitleHit(query: string, title: string): number {
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();

  let score = 0;

  // 정확한 일치를 최우선으로 평가하여 가장 관련성 높은 결과를 제공합니다.
  if (titleLower === queryLower) score += 1.0;
  // 부분 일치도 일정한 관련성을 인정하여 유연한 검색을 지원합니다.
  else if (titleLower.startsWith(queryLower)) score += 0.5;
  // N-gram 기반 유사 매칭을 통해 오타나 변형된 검색어도 처리합니다.
  else if (hasNgramMatch(queryLower, titleLower)) score += 0.2;

  return Math.min(1.0, score);
}

/**
 * 연속된 문자 시퀀스의 일치 여부를 확인하여 부분 문자열 매칭을 지원합니다.
 * 오타나 변형된 검색어에 대해서도 관련 결과를 찾을 수 있도록 합니다.
 */
function hasNgramMatch(query: string, text: string, n: number = 3): boolean {
  if (query.length < n || text.length < n) return false;

  const queryNgrams = generateNgrams(query, n);
  const textNgrams = generateNgrams(text, n);

  for (const ngram of queryNgrams) {
    if (textNgrams.has(ngram)) return true;
  }

  return false;
}

/**
 * 텍스트를 연속된 N개의 문자로 분할하여 부분 문자열 매칭을 수행합니다.
 * 다양한 길이의 N-gram을 생성하여 유연한 패턴 매칭을 지원합니다.
 */
function generateNgrams(text: string, n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.add(text.substring(i, i + n));
  }
  return ngrams;
}
