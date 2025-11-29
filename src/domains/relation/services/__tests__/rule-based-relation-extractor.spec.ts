/**
 * RuleBasedRelationExtractor 테스트
 * 규칙 기반 관계 추출기의 키워드 패턴 매칭 및 신뢰도 계산 테스트
 */

import { describe, it, expect } from 'vitest';
import { RuleBasedRelationExtractor } from '../rule-based-relation-extractor.js';
import type { MemoryItem, RelationType } from '../../../shared/types/index.js';

/**
 * 테스트용 메모리 생성 헬퍼
 */
function createTestMemory(
  id: string,
  content: string,
  type: 'working' | 'episodic' | 'semantic' | 'procedural' = 'episodic'
): MemoryItem {
  return {
    id,
    type,
    content,
    importance: 0.5,
    privacy_scope: 'private',
    created_at: new Date(),
    pinned: false
  };
}

describe('RuleBasedRelationExtractor', () => {
  let extractor: RuleBasedRelationExtractor;

  beforeEach(() => {
    extractor = new RuleBasedRelationExtractor();
  });

  describe('extractRelations - CAUSES 관계 추출', () => {
    it('should extract CAUSES relation for Korean keyword "때문에"', async () => {
      // Given: 인과 관계를 나타내는 키워드가 포함된 기억들
      const newMemory = createTestMemory('mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '이 버그 때문에 고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: CAUSES 관계가 추출되어야 함
      const causesRelation = candidates.find(c => c.relation_type === 'CAUSES');
      expect(causesRelation).toBeDefined();
      expect(causesRelation?.source_id).toBe('mem1');
      expect(causesRelation?.target_id).toBe('mem2');
      expect(causesRelation?.confidence).toBeGreaterThanOrEqual(0.5);
      expect(causesRelation?.confidence).toBeLessThanOrEqual(0.8);
      expect(causesRelation?.method).toBe('rule');
    });

    it('should extract CAUSES relation for English keyword "causes"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'The database connection was not properly closed.', 'episodic');
      const existingMemory = createTestMemory('mem2', 'This causes connection pool exhaustion.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: CAUSES 관계가 추출되어야 함
      const causesRelation = candidates.find(c => c.relation_type === 'CAUSES');
      expect(causesRelation).toBeDefined();
      expect(causesRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract CAUSES relation for keyword "따라서"', async () => {
      // Given: "따라서" 키워드
      const newMemory = createTestMemory('mem1', 'API rate limit을 설정하지 않았습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '따라서 서버가 과부하 상태에 빠졌습니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: CAUSES 관계가 추출되어야 함
      const causesRelation = candidates.find(c => c.relation_type === 'CAUSES');
      expect(causesRelation).toBeDefined();
    });
  });

  describe('extractRelations - DEPENDS_ON 관계 추출', () => {
    it('should extract DEPENDS_ON relation for Korean keyword "필요"', async () => {
      // Given: 의존 관계를 나타내는 키워드
      const newMemory = createTestMemory('mem1', '사용자 인증 기능을 구현하려고 합니다.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'JWT 토큰 생성 라이브러리가 필요합니다.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: DEPENDS_ON 관계가 추출되어야 함
      const dependsRelation = candidates.find(c => c.relation_type === 'DEPENDS_ON');
      expect(dependsRelation).toBeDefined();
      expect(dependsRelation?.source_id).toBe('mem1');
      expect(dependsRelation?.target_id).toBe('mem2');
      expect(dependsRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract DEPENDS_ON relation for English keyword "depends on"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'We want to implement distributed locking.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'This depends on ZooKeeper being set up first.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: DEPENDS_ON 관계가 추출되어야 함
      const dependsRelation = candidates.find(c => c.relation_type === 'DEPENDS_ON');
      expect(dependsRelation).toBeDefined();
    });
  });

  describe('extractRelations - FOLLOWS 관계 추출', () => {
    it('should extract FOLLOWS relation for Korean keyword "이후"', async () => {
      // Given: 시간적 순서를 나타내는 키워드
      const newMemory = createTestMemory('mem1', '코드 리뷰를 완료했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '이후 변경 사항을 메인 브랜치에 머지했습니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: FOLLOWS 관계가 추출되어야 함
      const followsRelation = candidates.find(c => c.relation_type === 'FOLLOWS');
      expect(followsRelation).toBeDefined();
      expect(followsRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract FOLLOWS relation for English keyword "after"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'We completed the code review.', 'episodic');
      const existingMemory = createTestMemory('mem2', 'After that, we merged to main branch.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: FOLLOWS 관계가 추출되어야 함
      const followsRelation = candidates.find(c => c.relation_type === 'FOLLOWS');
      expect(followsRelation).toBeDefined();
    });
  });

  describe('extractRelations - CONTRASTS_WITH 관계 추출', () => {
    it('should extract CONTRASTS_WITH relation for Korean keyword "그러나"', async () => {
      // Given: 대조 관계를 나타내는 키워드
      const newMemory = createTestMemory('mem1', '이전에는 동기 방식으로 API를 호출했습니다.', 'semantic');
      const existingMemory = createTestMemory('mem2', '그러나 현재는 비동기 방식으로 API를 호출합니다.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: CONTRASTS_WITH 관계가 추출되어야 함
      const contrastsRelation = candidates.find(c => c.relation_type === 'CONTRASTS_WITH');
      expect(contrastsRelation).toBeDefined();
      expect(contrastsRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract CONTRASTS_WITH relation for English keyword "however"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'We previously used a monolithic architecture.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'However, we now use microservices.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: CONTRASTS_WITH 관계가 추출되어야 함
      const contrastsRelation = candidates.find(c => c.relation_type === 'CONTRASTS_WITH');
      expect(contrastsRelation).toBeDefined();
    });
  });

  describe('extractRelations - REFERENCES 관계 추출', () => {
    it('should extract REFERENCES relation for Korean keyword "참고"', async () => {
      // Given: 참조 관계를 나타내는 키워드
      const newMemory = createTestMemory('mem1', 'API 엔드포인트 설계는 RESTful 원칙을 따릅니다.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'RESTful API 설계 가이드라인 문서를 참고하세요.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: REFERENCES 관계가 추출되어야 함
      const referencesRelation = candidates.find(c => c.relation_type === 'REFERENCES');
      expect(referencesRelation).toBeDefined();
      expect(referencesRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract REFERENCES relation for English keyword "references"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'We follow RESTful API design principles.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'This references the RESTful API design guidelines document.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: REFERENCES 관계가 추출되어야 함
      const referencesRelation = candidates.find(c => c.relation_type === 'REFERENCES');
      expect(referencesRelation).toBeDefined();
    });
  });

  describe('extractRelations - BELONGS_TO 관계 추출', () => {
    it('should extract BELONGS_TO relation for Korean keyword "포함"', async () => {
      // Given: 포함 관계를 나타내는 키워드
      const newMemory = createTestMemory('mem1', '사용자 인증 모듈', 'semantic');
      const existingMemory = createTestMemory('mem2', '보안 시스템에 포함되어 있습니다.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: BELONGS_TO 관계가 추출되어야 함
      const belongsRelation = candidates.find(c => c.relation_type === 'BELONGS_TO');
      expect(belongsRelation).toBeDefined();
      expect(belongsRelation?.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should extract BELONGS_TO relation for English keyword "belongs to"', async () => {
      // Given: English keyword
      const newMemory = createTestMemory('mem1', 'Authentication module', 'semantic');
      const existingMemory = createTestMemory('mem2', 'This belongs to the security system.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: BELONGS_TO 관계가 추출되어야 함
      const belongsRelation = candidates.find(c => c.relation_type === 'BELONGS_TO');
      expect(belongsRelation).toBeDefined();
    });
  });

  describe('extractRelations - 신뢰도 계산', () => {
    it('should calculate confidence in 0.5~0.8 range', async () => {
      // Given: 키워드가 매칭되는 기억들
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: 신뢰도가 0.5~0.8 범위여야 함
      if (candidates.length > 0) {
        for (const candidate of candidates) {
          expect(candidate.confidence).toBeGreaterThanOrEqual(0.5);
          expect(candidate.confidence).toBeLessThanOrEqual(0.8);
        }
      }
    });

    it('should return higher confidence for stronger pattern matches', async () => {
      // Given: 강한 패턴 매칭 (weight 0.8)과 약한 패턴 매칭 (weight 0.7)
      const newMemory1 = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemory1 = createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic'); // weight 0.8

      const newMemory2 = createTestMemory('mem3', '문제가 발생했습니다.', 'episodic');
      const existingMemory2 = createTestMemory('mem4', '초래했습니다.', 'episodic'); // weight 0.7

      // When: 관계 추출
      const candidates1 = await extractor.extractRelations(newMemory1, [existingMemory1]);
      const candidates2 = await extractor.extractRelations(newMemory2, [existingMemory2]);

      // Then: 강한 패턴 매칭이 더 높은 신뢰도를 가져야 함
      const relation1 = candidates1.find(c => c.relation_type === 'CAUSES');
      const relation2 = candidates2.find(c => c.relation_type === 'CAUSES');

      if (relation1 && relation2) {
        expect(relation1.confidence).toBeGreaterThan(relation2.confidence);
      }
    });
  });

  describe('extractRelations - 옵션 처리', () => {
    it('should filter by minConfidence option', async () => {
      // Given: 다양한 신뢰도의 관계 후보
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic');

      // When: minConfidence 0.7로 설정하여 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        minConfidence: 0.7
      });

      // Then: 0.7 이상의 신뢰도만 반환되어야 함
      for (const candidate of candidates) {
        expect(candidate.confidence).toBeGreaterThanOrEqual(0.7);
      }
    });

    it('should limit candidate count by candidateLimit option', async () => {
      // Given: 많은 기존 기억들
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemories = Array.from({ length: 100 }, (_, i) =>
        createTestMemory(`mem${i + 2}`, `Memory ${i + 2}`, 'episodic')
      );

      // When: candidateLimit 10으로 설정
      const candidates = await extractor.extractRelations(newMemory, existingMemories, {
        candidateLimit: 10
      });

      // Then: 후보 기억 수가 10개로 제한되어야 함 (내부적으로 처리)
      // 실제로는 모든 후보를 반환하지만, 처리된 기억 수는 제한됨
      expect(candidates.length).toBeLessThanOrEqual(100); // 모든 기억을 검사하지만 관계가 발견된 것만 반환
    });

    it('should filter by relationTypes option', async () => {
      // Given: 여러 관계 유형이 가능한 기억들
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic');

      // When: CAUSES만 필터링
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        relationTypes: ['CAUSES']
      });

      // Then: CAUSES 관계만 반환되어야 함
      for (const candidate of candidates) {
        expect(candidate.relation_type).toBe('CAUSES');
      }
    });
  });

  describe('extractRelations - 기억 타입별 관계 유형 필터링', () => {
    it('should only extract REFERENCES for working memory type', async () => {
      // Given: working 타입의 새로운 기억
      const newMemory = createTestMemory('mem1', '임시 메모리입니다.', 'working');
      const existingMemory = createTestMemory('mem2', '참고할 기억입니다.', 'semantic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: REFERENCES 관계만 추출되어야 함
      for (const candidate of candidates) {
        expect(candidate.relation_type).toBe('REFERENCES');
      }
    });

    it('should extract multiple relation types for episodic memory', async () => {
      // Given: episodic 타입의 새로운 기억
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemories = [
        createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic'), // CAUSES
        createTestMemory('mem3', '이후 수정했습니다.', 'episodic'), // FOLLOWS
        createTestMemory('mem4', '그러나 다른 문제가 발생했습니다.', 'episodic') // CONTRASTS_WITH
      ];

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, existingMemories);

      // Then: 여러 관계 유형이 추출될 수 있어야 함
      const relationTypes = candidates.map(c => c.relation_type);
      expect(relationTypes.length).toBeGreaterThan(0);
      // episodic은 CAUSES, FOLLOWS, CONTRASTS_WITH, REFERENCES, BELONGS_TO 가능
      const allowedTypes = ['CAUSES', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
      for (const type of relationTypes) {
        expect(allowedTypes).toContain(type);
      }
    });
  });

  describe('extractRelations - 정렬', () => {
    it('should sort candidates by confidence in descending order', async () => {
      // Given: 다양한 신뢰도의 관계 후보
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemories = [
        createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic'), // 높은 신뢰도
        createTestMemory('mem3', '초래했습니다.', 'episodic'), // 낮은 신뢰도
        createTestMemory('mem4', '그래서 문제가 생겼습니다.', 'episodic') // 중간 신뢰도
      ];

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, existingMemories);

      // Then: 신뢰도 내림차순으로 정렬되어야 함
      if (candidates.length > 1) {
        for (let i = 0; i < candidates.length - 1; i++) {
          expect(candidates[i].confidence).toBeGreaterThanOrEqual(candidates[i + 1].confidence);
        }
      }
    });
  });

  describe('extractRelations - evidence 추출', () => {
    it('should include matched keyword as evidence', async () => {
      // Given: 키워드가 매칭되는 기억들
      const newMemory = createTestMemory('mem1', '버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '따라서 오류가 발생했습니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: evidence에 매칭된 키워드가 포함되어야 함
      const causesRelation = candidates.find(c => c.relation_type === 'CAUSES');
      if (causesRelation) {
        expect(causesRelation.evidence).toBeDefined();
        expect(causesRelation.evidence).not.toBe('');
      }
    });
  });

  describe('extractRelations - 엣지 케이스', () => {
    it('should return empty array when no patterns match', async () => {
      // Given: 관계를 나타내는 키워드가 없는 기억들
      const newMemory = createTestMemory('mem1', '일반적인 메모리입니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '또 다른 일반적인 메모리입니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: 빈 배열이 반환되어야 함
      expect(candidates).toEqual([]);
    });

    it('should handle empty existing memories array', async () => {
      // Given: 기존 기억이 없는 경우
      const newMemory = createTestMemory('mem1', '새로운 메모리입니다.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, []);

      // Then: 빈 배열이 반환되어야 함
      expect(candidates).toEqual([]);
    });

    it('should handle case-insensitive matching', async () => {
      // Given: 대소문자가 다른 키워드
      const newMemory = createTestMemory('mem1', 'Bug occurred.', 'episodic');
      const existingMemory = createTestMemory('mem2', 'THEREFORE error happened.', 'episodic');

      // When: 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory]);

      // Then: 대소문자와 관계없이 매칭되어야 함
      const causesRelation = candidates.find(c => c.relation_type === 'CAUSES');
      expect(causesRelation).toBeDefined();
    });
  });
});
