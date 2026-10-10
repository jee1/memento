import { ALL_RELATION_TYPES, type RelationType } from '../../../../shared/types/relation.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { ParseResult } from './types.js';
import { extractJsonObjectFromLlmText as extractBalancedJsonObject } from '../llm-json.js';

function extractJsonObjectFromLlmText(text: string): string | null {
    const extracted = extractBalancedJsonObject(text);
    if (extracted === null) {
      logger.warn('JSON 객체 시작 문자({)를 찾을 수 없습니다', {
        textLength: text.length,
        textPreview: text.substring(0, 200)
      });
      return null;
    }

    if (!extracted.endsWith('}')) {
      logger.warn('JSON 객체가 완전히 닫히지 않았습니다', {
        textLength: text.length,
        extractedPreview: extracted.substring(0, 200)
      });
    }

    try {
      JSON.parse(extracted);
    } catch (error) {
      logger.warn('추출된 JSON이 유효하지 않습니다', {
        error: error instanceof Error ? error.message : String(error),
        extractedLength: extracted.length,
        extractedPreview: extracted.substring(0, 200),
        originalPreview: text.substring(0, 300)
      });
    }
    return extracted;
  }

/** 첫 '{'부터 마지막 '}'까지 자른다. 짝이 없으면 그대로 둔다. */
function sliceOuterBraces(text: string): string {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return text;
  return text.substring(firstBrace, lastBrace + 1).trim();
}

/** 끝을 줄여 가며 JSON.parse 가 성공하는 가장 긴 객체를 찾는다. 없으면 바깥 중괄호까지만 자른 값. */
function trimToValidJsonObject(content: string): string {
  const sliced = sliceOuterBraces(content);
  for (let i = sliced.length; i > 0; i--) {
    const candidate = sliced.substring(0, i).trim();
    if (!candidate.endsWith('}')) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 계속 시도
    }
  }
  return sliced;
}

export function prepareOllamaRelationJsonContent(content: string): string {
  return trimToValidJsonObject(extractJsonObjectFromLlmText(content) ?? sliceOuterBraces(content));
}

type RawRelation = {
  target_id: string;
  relation_type: string;
  confidence: number;
  reasoning?: string;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const parseFailure = (error: unknown): ParseResult => ({
  success: false,
  relations: [],
  error: `JSON 파싱 실패: ${errorMessage(error)}`
});

/**
 * 바깥 중괄호까지 잘라 파싱하고, 실패하면 끝을 줄여 다시 파싱한다.
 * 두 번째도 실패하면 그 오류를 던진다.
 */
function parseRelationsJson(jsonText: string): { relations?: RawRelation[] } {
  const trimmed = jsonText.trim();
  try {
    return JSON.parse(sliceOuterBraces(trimmed));
  } catch (firstError) {
    logger.warn('JSON 파싱 실패, 추가 정리 후 재시도', {
      error: errorMessage(firstError),
      jsonLength: jsonText.length,
      jsonPreview: jsonText.substring(0, 300)
    });
    return JSON.parse(trimToValidJsonObject(trimmed));
  }
}

function isValidRelation(rel: RawRelation): boolean {
  return (
    ALL_RELATION_TYPES.includes(rel.relation_type as RelationType) &&
    typeof rel.confidence === 'number' &&
    rel.confidence >= 0 &&
    rel.confidence <= 1
  );
}

export function parseLlmRelationsResponse(responseText: string): ParseResult {
  let jsonText = extractJsonObjectFromLlmText(responseText);
  if (!jsonText) {
    logger.warn('JSON 추출 실패, 원본 텍스트에서 직접 파싱 시도', {
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200)
    });
    jsonText = responseText.trim();
  }

  let parsed: { relations?: RawRelation[] };
  try {
    parsed = parseRelationsJson(jsonText);
  } catch (error) {
    logger.error('JSON 파싱 최종 실패', {
      error: errorMessage(error),
      originalLength: responseText.length,
      originalPreview: responseText.substring(0, 500)
    });
    return parseFailure(error);
  }

  try {
    if (!Array.isArray(parsed.relations)) {
      return {
        success: false,
        relations: [],
        error: '응답 구조가 올바르지 않습니다: relations 배열이 없거나 배열이 아닙니다.'
      };
    }
    const relations = parsed.relations.filter(isValidRelation).map(rel => ({
      target_id: rel.target_id,
      relation_type: rel.relation_type as RelationType,
      confidence: Math.max(0, Math.min(1, rel.confidence)), // -0 → 0
      reasoning: rel.reasoning
    }));
    return { success: true, relations };
  } catch (error) {
    logger.error('LLM 응답 파싱 실패', {
      error: errorMessage(error),
      responseText: responseText.substring(0, 500)
    });
    return parseFailure(error);
  }
}
