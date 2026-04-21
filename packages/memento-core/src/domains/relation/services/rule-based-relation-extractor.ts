/**
 * 규칙 기반 관계 추출기
 * 키워드 패턴 매칭을 통해 기억 간의 관계를 추출합니다.
 */

import { CONFIDENCE,LIMITS } from '../../../shared/constants/relation-constants.js';
import type { MemoryItem } from '../../../shared/types/index.js';
import type {
ExtractOptions,
IRelationExtractor,
RelationCandidate,
RelationType
} from '../../../shared/types/relation.js';
import { isApplicableRelationType,MEMORY_TYPE_RELATION_MAP } from '../../../shared/types/relation.js';

/**
 * 키워드 패턴 정의
 * 각 관계 유형별로 매칭할 키워드 패턴을 정의합니다.
 */
interface KeywordPattern {
  keywords: string[]; // 키워드 목록
  weight: number; // 패턴 가중치 (0.0~1.0)
}

/**
 * 관계 유형별 키워드 패턴 맵
 */
const RELATION_KEYWORD_PATTERNS: Record<RelationType, KeywordPattern[]> = {
  CAUSES: [
    {
      keywords: ['때문에', '로 인해', '로 인하여', '덕분에', '결과로', '따라서', '그래서', '때문이다', '원인', '인해'],
      weight: 0.8
    },
    {
      keywords: ['causes', 'caused by', 'due to', 'because of', 'as a result', 'therefore', 'thus', 'hence'],
      weight: 0.8
    },
    {
      keywords: ['발생', '초래', '야기', '유발'],
      weight: 0.7
    },
    {
      keywords: ['leads to', 'results in', 'triggers', 'brings about'],
      weight: 0.7
    }
  ],
  DEPENDS_ON: [
    {
      keywords: ['필요', '요구', '의존', '기반', '바탕', '근거'],
      weight: 0.8
    },
    {
      keywords: ['depends on', 'requires', 'needs', 'relies on', 'based on', 'depends upon'],
      weight: 0.8
    },
    {
      keywords: ['필수', '전제', '조건'],
      weight: 0.7
    },
    {
      keywords: ['prerequisite', 'requirement', 'dependency'],
      weight: 0.7
    }
  ],
  FOLLOWS: [
    {
      keywords: ['이후', '다음', '그 다음', '이어서', '후에', '뒤에', '나중에'],
      weight: 0.8
    },
    {
      keywords: ['after', 'following', 'next', 'subsequently', 'then', 'later', 'afterwards'],
      weight: 0.8
    },
    {
      keywords: ['이어', '계속', '연속'],
      weight: 0.7
    },
    {
      keywords: ['follows', 'succeeds', 'comes after'],
      weight: 0.7
    }
  ],
  CONTRASTS_WITH: [
    {
      keywords: ['반대로', '그러나', '하지만', '다만', '대신', '반면', '반대'],
      weight: 0.8
    },
    {
      keywords: ['however', 'but', 'instead', 'on the contrary', 'conversely', 'in contrast', 'whereas'],
      weight: 0.8
    },
    {
      keywords: ['차이', '다르게', '상반'],
      weight: 0.7
    },
    {
      keywords: ['differs from', 'opposite', 'contrary to'],
      weight: 0.7
    }
  ],
  REFERENCES: [
    {
      keywords: ['참고', '참조', '인용', '언급', '언급한', '언급된'],
      weight: 0.8
    },
    {
      keywords: ['references', 'refers to', 'mentions', 'cites', 'according to', 'based on'],
      weight: 0.8
    },
    {
      keywords: ['관련', '연관', '관련된'],
      weight: 0.6
    },
    {
      keywords: ['related to', 'associated with', 'linked to'],
      weight: 0.6
    }
  ],
  BELONGS_TO: [
    {
      keywords: ['포함', '속한', '소속', '일부', '부분'],
      weight: 0.8
    },
    {
      keywords: ['belongs to', 'part of', 'member of', 'included in', 'contained in'],
      weight: 0.8
    },
    {
      keywords: ['구성', '구성 요소'],
      weight: 0.7
    },
    {
      keywords: ['component of', 'element of', 'constituent of'],
      weight: 0.7
    }
  ],
  VERSION_OF: [
    {
      keywords: ['버전', '개정', '수정', '업데이트', '개선', '변경'],
      weight: 0.8
    },
    {
      keywords: ['version of', 'revision of', 'update of', 'improvement of', 'variant of', 'modified version'],
      weight: 0.8
    },
    {
      keywords: ['개선된', '수정된', '업데이트된', '변경된'],
      weight: 0.7
    },
    {
      keywords: ['updated', 'revised', 'improved', 'modified', 'enhanced'],
      weight: 0.7
    }
  ],
  extracted_from: [],
  supported_by: []
};

/**
 * 규칙 기반 관계 추출기
 */
export class RuleBasedRelationExtractor implements IRelationExtractor {
  /**
   * 한글 키워드 매칭
   * 한글의 경우 단어 경계가 제대로 작동하지 않으므로 직접 포함 여부 확인
   * 
   * @param text 검색할 텍스트 (소문자로 정규화됨)
   * @param keyword 키워드 (소문자로 정규화됨)
   * @returns 매칭 여부
   */
  private matchKoreanKeyword(text: string, keyword: string): boolean {
    return text.includes(keyword);
  }

  /**
   * 영문 키워드 매칭
   * 단어 경계를 고려하여 정확한 매칭 수행
   * 
   * @param text 검색할 텍스트 (소문자로 정규화됨)
   * @param keyword 키워드 (소문자로 정규화됨)
   * @returns 매칭 여부
   */
  private matchEnglishKeyword(text: string, keyword: string): boolean {
    const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
    return wordBoundaryRegex.test(text);
  }

  /**
   * 키워드가 한글인지 확인
   * 
   * @param keyword 키워드
   * @returns 한글 여부
   */
  private isKoreanKeyword(keyword: string): boolean {
    return /[\u3131-\uD79D]/.test(keyword);
  }

  /**
   * 텍스트에서 키워드 패턴을 찾고 매칭 강도를 계산합니다.
   * 
   * @param text 검색할 텍스트
   * @param patterns 키워드 패턴 배열
   * @returns 매칭된 패턴과 강도 (0.0~1.0)
   */
  private findPatternMatch(text: string, patterns: KeywordPattern[]): {
    matched: boolean;
    strength: number;
    evidence: string;
  } {
    const normalizedText = text.toLowerCase();
    let maxStrength = 0;
    let _matchedPattern: KeywordPattern | null = null;
    let matchedKeyword = '';

    for (const pattern of patterns) {
      for (const keyword of pattern.keywords) {
        const normalizedKeyword = keyword.toLowerCase();
        
        // 언어별 매칭 로직 분리
        const isMatched = this.isKoreanKeyword(keyword)
          ? this.matchKoreanKeyword(normalizedText, normalizedKeyword)
          : this.matchEnglishKeyword(normalizedText, normalizedKeyword);
        
        if (isMatched) {
          const strength = pattern.weight;
          if (strength > maxStrength) {
            maxStrength = strength;
            _matchedPattern = pattern;
            matchedKeyword = keyword;
          }
        }
      }
    }

    return {
      matched: maxStrength > 0,
      strength: maxStrength,
      evidence: matchedKeyword || ''
    };
  }

  /**
   * 정규식 특수 문자 이스케이프
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 패턴 매칭 강도를 신뢰도로 변환합니다.
   * 패턴 매칭 강도(0.0~1.0)를 신뢰도(0.5~0.8) 범위로 변환합니다.
   * 
   * @param strength 패턴 매칭 강도 (0.0~1.0)
   * @returns 신뢰도 (0.5~0.8)
   */
  private calculateConfidence(strength: number): number {
    // strength를 0.5~0.8 범위로 선형 변환
    // strength 0.0 → confidence 0.5
    // strength 1.0 → confidence 0.8
    return CONFIDENCE.MIN_PATTERN_MATCH + (strength * (CONFIDENCE.MAX_PATTERN_MATCH - CONFIDENCE.MIN_PATTERN_MATCH));
  }

  /**
   * 새로운 기억과 기존 기억들 간의 관계를 추출합니다.
   * 
   * @param newMemory 새로운 기억
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션
   * @returns 관계 후보 목록
   */
  async extractRelations(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    options?: ExtractOptions
  ): Promise<RelationCandidate[]> {
    const candidates: RelationCandidate[] = [];
    const minConfidence = options?.minConfidence ?? CONFIDENCE.MIN_RULE_BASED;
    const candidateLimit = options?.candidateLimit ?? LIMITS.RULE_CANDIDATE_DEFAULT;
    const allowedRelationTypes = options?.relationTypes;

    // 후보 기억 수 제한
    const limitedMemories = existingMemories.slice(0, candidateLimit);

    // 새로운 기억의 타입에 적용 가능한 관계 유형 필터링
    const applicableTypes = allowedRelationTypes
      ? allowedRelationTypes.filter(type => isApplicableRelationType(newMemory.type, type))
      : MEMORY_TYPE_RELATION_MAP[newMemory.type];

    // 각 기존 기억에 대해 관계 추출 시도
    for (const existingMemory of limitedMemories) {
      // 새로운 기억과 기존 기억의 내용을 결합하여 분석
      const combinedText = `${newMemory.content} ${existingMemory.content}`;

      // 각 관계 유형별로 패턴 매칭
      for (const relationType of applicableTypes) {
        const patterns = RELATION_KEYWORD_PATTERNS[relationType];
        const match = this.findPatternMatch(combinedText, patterns);

        if (match.matched) {
          const confidence = this.calculateConfidence(match.strength);

          // 최소 신뢰도 임계값 확인
          if (confidence >= minConfidence) {
            candidates.push({
              source_id: newMemory.id,
              target_id: existingMemory.id,
              relation_type: relationType,
              confidence,
              method: 'rule',
              evidence: match.evidence
            });
          }
        }
      }
    }

    // 신뢰도 내림차순 정렬
    candidates.sort((a, b) => b.confidence - a.confidence);

    return candidates;
  }
}
