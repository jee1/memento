/**
 * LLM 관계 추출 응답 파싱 결과
 */
import type { RelationType } from '../../../../shared/types/relation.js';

export interface ParseResult {
  success: boolean;
  relations: Array<{
    target_id: string;
    relation_type: RelationType;
    confidence: number;
    reasoning?: string;
  }>;
  error?: string;
}
