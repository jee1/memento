/**
 * #1445: 5줄 템플릿 라벨이 검색 신호에 남기는 차이를 숫자로 만든다.
 * 임베딩 호출과 DB 접근은 스크립트에 두고, 여기에는 비교 함수만 둔다.
 */

import { stripMemoryTemplateLabels } from './template-label-normalizer.js';

export const TEMPLATE_LABELS = ['결정', '근거', '버린 대안', '안 통한 것', '다음 걸림돌'] as const;

export type TemplateLabel = (typeof TEMPLATE_LABELS)[number];

const LINE_RE =
  /^[ \t]*(?:-[ \t]*)?(결정|근거|버린 대안|안 통한 것|다음 걸림돌)[ \t]*:[ \t]*(.*)$/;

export type TemplateFields = Record<TemplateLabel, string>;

/** 다섯 라벨이 모두 있으면 필드를 돌려준다. 하나라도 없으면 null. */
export function parseTemplateFields(text: string): TemplateFields | null {
  const found = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(LINE_RE);
    if (!match) continue;
    const label = match[1];
    const value = match[2];
    if (!label || value === undefined) continue;
    found.set(label, value.trim());
  }
  if (!TEMPLATE_LABELS.every((label) => found.has(label))) return null;
  const fields = {} as TemplateFields;
  for (const label of TEMPLATE_LABELS) {
    fields[label] = found.get(label) ?? '';
  }
  return fields;
}

/** `calculateTextSimilarity` 와 같은 공백 토큰 자카드. 검색 랭킹의 duplication_penalty 입력이다. */
export function jaccardTokens(left: string, right: string): number {
  const words1 = new Set(left.toLowerCase().split(/\s+/).filter(Boolean));
  const words2 = new Set(right.toLowerCase().split(/\s+/).filter(Boolean));
  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection += 1;
  }
  const union = words1.size + words2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface PairwiseJaccardSummary {
  pairCount: number;
  mean: number;
  p50: number;
  p90: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** 문서 쌍의 자카드 분포. 한 문서가 선택된 뒤 나머지가 받는 페널티의 재료다. */
export function summarizePairwiseJaccard(texts: string[]): PairwiseJaccardSummary {
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const leftText = texts[i];
      const rightText = texts[j];
      if (leftText === undefined || rightText === undefined) continue;
      scores.push(jaccardTokens(leftText, rightText));
    }
  }
  scores.sort((a, b) => a - b);
  const mean = scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return {
    pairCount: scores.length,
    mean,
    p50: quantile(scores, 0.5),
    p90: quantile(scores, 0.9),
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < length; i++) {
    const leftValue = left[i] ?? 0;
    const rightValue = right[i] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** 1-based rank of `selfIndex` when documents are ordered by cosine to `query`. */
export function rankOfSelf(query: number[], documents: number[][], selfIndex: number): number {
  const selfVector = documents[selfIndex];
  if (!selfVector) return documents.length;
  const self = cosineSimilarity(query, selfVector);
  let better = 0;
  for (let i = 0; i < documents.length; i++) {
    if (i === selfIndex) continue;
    const other = documents[i];
    if (!other) continue;
    const score = cosineSimilarity(query, other);
    if (score > self) better += 1;
  }
  return better + 1;
}

export function meanReciprocalRank(ranks: number[]): number {
  if (ranks.length === 0) return 0;
  const total = ranks.reduce((sum, rank) => sum + 1 / rank, 0);
  return total / ranks.length;
}

export function stripTemplate(text: string): string {
  return stripMemoryTemplateLabels(text).replace(/[ \t]+\n/g, '\n').trim();
}
