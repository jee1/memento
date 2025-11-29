/**
 * RelationExtractor 통합 테스트
 * 하이브리드 관계 추출기의 통합 테스트
 * 
 * 테스트 항목:
 * - 하이브리드 추출 플로우 (규칙 기반 → LLM fallback)
 * - 타입별 필터링 검증
 * - MiniLM 필터링 효과 검증
 * - 캐싱 테스트
 * - 배치 처리 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelationExtractor } from './relation-extractor.js';
import { RuleBasedRelationExtractor } from './rule-based-relation-extractor.js';
import { LLMBasedRelationExtractor } from './llm-based-relation-extractor.js';
import type { MemoryItem, RelationType } from '../../../shared/types/index.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { CoreMemoryCacheService } from '../../memory/services/core-memory-cache-service.js';

// mementoConfig 모킹
vi.mock('../config/index.js', () => {
  const mockConfig = {
    openaiApiKey: undefined as string | undefined,
    geminiApiKey: undefined as string | undefined,
    openaiModel: 'gpt-4o-mini',
    geminiModel: 'gemini-1.5-flash'
  };
  return {
    mementoConfig: mockConfig
  };
});

// OpenAI 모킹
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    })),
    __mockCreate: mockCreate
  };
});

// GoogleGenerativeAI 모킹
vi.mock('@google/generative-ai', () => {
  const mockGenerateContent = vi.fn();
  const mockGetGenerativeModel = vi.fn(() => ({
    generateContent: mockGenerateContent
  }));
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel
    })),
    __mockGenerateContent: mockGenerateContent,
    __mockGetGenerativeModel: mockGetGenerativeModel
  };
});

/**
 * 테스트용 메모리 생성 헬퍼
 */
function createTestMemory(
  id: string,
  content: string,
  type: 'working' | 'episodic' | 'semantic' | 'procedural' = 'episodic',
  embedding?: number[]
): MemoryItem {
  return {
    id,
    type,
    content,
    importance: 0.5,
    privacy_scope: 'private',
    created_at: new Date(),
    pinned: false,
    embedding: embedding || new Array(384).fill(0.1) // MiniLM 기본 차원
  };
}

describe('RelationExtractor', () => {
  let extractor: RelationExtractor;
  let mockRuleExtractor: any;
  let mockLLMExtractor: any;
  let mockEmbeddingService: any;
  let mockCoreMemoryCacheService: any;
  let extractWithOpenAISpy: any;

  beforeEach(async () => {
    // RuleBasedRelationExtractor 모킹
    mockRuleExtractor = {
      extractRelations: vi.fn()
    };
    vi.spyOn(RuleBasedRelationExtractor.prototype, 'extractRelations').mockImplementation(
      mockRuleExtractor.extractRelations
    );

    // LLMBasedRelationExtractor 모킹
    mockLLMExtractor = {
      extractRelations: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true)
    };
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailable').mockImplementation(
      mockLLMExtractor.isAvailable
    );
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'extractRelations').mockImplementation(
      mockLLMExtractor.extractRelations
    );

    // UnifiedEmbeddingService 모킹
    mockEmbeddingService = {
      generateEmbedding: vi.fn(),
      searchSimilar: vi.fn()
    };
    vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockImplementation(
      mockEmbeddingService.generateEmbedding
    );
    vi.spyOn(UnifiedEmbeddingService.prototype, 'searchSimilar').mockImplementation(
      mockEmbeddingService.searchSimilar
    );

    // CoreMemoryCacheService 모킹
    mockCoreMemoryCacheService = {
      get: vi.fn(),
      set: vi.fn()
    };
    vi.spyOn(CoreMemoryCacheService.prototype, 'get').mockImplementation(mockCoreMemoryCacheService.get);
    vi.spyOn(CoreMemoryCacheService.prototype, 'set').mockImplementation(mockCoreMemoryCacheService.set);

    extractor = new RelationExtractor();

    // extractWithOpenAI spy 설정 (LLM 호출 테스트용)
    const extractorAny = extractor as any;
    if (extractorAny.llmExtractor) {
      const llmExtractorAny = extractorAny.llmExtractor as any;
      if (llmExtractorAny.extractWithOpenAI) {
        extractWithOpenAISpy = vi.spyOn(llmExtractorAny, 'extractWithOpenAI');
      }
    }
  });

  describe('하이브리드 추출 플로우', () => {
    it('should use rule-based extraction when results have high confidence', async () => {
      // Given: 규칙 기반 추출이 높은 신뢰도 결과를 반환하는 경우
      const newMemory = createTestMemory('mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '이 버그 때문에 고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '때문에'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);

      // When: 하이브리드 방식으로 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'hybrid',
        minConfidence: 0.5
      });

      // Then: 규칙 기반 결과가 반환되어야 함
      expect(candidates).toHaveLength(1);
      expect(candidates[0].method).toBe('rule');
      expect(candidates[0].confidence).toBe(0.8);
      // LLM은 호출되지 않아야 함
      expect(mockLLMExtractor.extractRelations).not.toHaveBeenCalled();
    });

    it('should fallback to LLM when rule-based results have low confidence', async () => {
      // Given: 규칙 기반 추출이 낮은 신뢰도 결과를 반환하는 경우
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능과 관련이 있을 수 있습니다.', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.4, // 낮은 신뢰도
          method: 'rule' as const,
          evidence: '관련'
        }
      ];

      const llmCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.7,
          method: 'llm' as const,
          evidence: 'LLM 분석 결과'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);
      mockLLMExtractor.extractRelations.mockResolvedValue(llmCandidates);
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: new Array(384).fill(0.1),
        provider: 'minilm'
      });
      mockEmbeddingService.searchSimilar.mockResolvedValue([
        { id: 'mem2', similarity: 0.9, score: 0.9 }
      ]);

      // When: 하이브리드 방식으로 관계 추출 (minConfidence 0.5)
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'hybrid',
        minConfidence: 0.5
      });

      // Then: LLM fallback이 발생하고 결과가 병합되어야 함
      expect(mockLLMExtractor.extractRelations).toHaveBeenCalled();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].method).toBe('llm');
      expect(candidates[0].confidence).toBe(0.7);
    });

    it('should return rule-based results when LLM is not available', async () => {
      // Given: LLM이 사용 불가능한 경우
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능과 관련이 있을 수 있습니다.', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.4,
          method: 'rule' as const,
          evidence: '관련'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);
      mockLLMExtractor.isAvailable.mockReturnValue(false);

      // When: 하이브리드 방식으로 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'hybrid',
        minConfidence: 0.5
      });

      // Then: 규칙 기반 결과가 반환되어야 함 (LLM 호출 없음)
      expect(mockLLMExtractor.extractRelations).not.toHaveBeenCalled();
      expect(candidates).toEqual(ruleCandidates);
    });
  });

  describe('타입별 필터링 검증', () => {
    it('should filter relation types for episodic memory', async () => {
      // Given: episodic 타입 기억
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '이후 테스트를 진행했습니다.', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'FOLLOWS' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '이후'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);

      // When: 특정 관계 유형만 요청
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        relationTypes: ['FOLLOWS', 'CAUSES']
      });

      // Then: 요청된 관계 유형만 포함되어야 함
      expect(mockRuleExtractor.extractRelations).toHaveBeenCalledWith(
        newMemory,
        [existingMemory],
        expect.objectContaining({
          relationTypes: ['FOLLOWS', 'CAUSES']
        })
      );
    });

    it('should filter out inapplicable relation types for semantic memory', async () => {
      // Given: semantic 타입 기억
      const newMemory = createTestMemory('mem1', '사용자 인증 기능을 구현하려고 합니다.', 'semantic');
      const existingMemory = createTestMemory('mem2', 'JWT 토큰 생성 라이브러리가 필요합니다.', 'semantic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'DEPENDS_ON' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '필요'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);

      // When: semantic에 적용 불가능한 관계 유형 요청 (예: CAUSES)
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        relationTypes: ['CAUSES', 'DEPENDS_ON'] // CAUSES는 semantic에 적용 불가
      });

      // Then: 적용 가능한 관계 유형만 필터링되어야 함
      expect(mockRuleExtractor.extractRelations).toHaveBeenCalledWith(
        newMemory,
        [existingMemory],
        expect.objectContaining({
          relationTypes: ['DEPENDS_ON'] // CAUSES는 제외됨
        })
      );
    });
  });

  describe('MiniLM 필터링 효과 검증', () => {
    it('should pass candidateLimit option to LLM extractor for MiniLM filtering', async () => {
      // Given: 많은 기존 기억들
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemories = Array.from({ length: 100 }, (_, i) =>
        createTestMemory(`mem${i + 2}`, `기존 기능 ${i}`, 'episodic')
      );

      mockRuleExtractor.extractRelations.mockResolvedValue([]);
      mockLLMExtractor.extractRelations.mockResolvedValue([]);
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: new Array(384).fill(0.1),
        provider: 'minilm'
      });
      mockEmbeddingService.searchSimilar.mockResolvedValue([
        { id: 'mem2', similarity: 0.9, score: 0.9 }
      ]);

      // When: candidateLimit 옵션과 함께 관계 추출
      await extractor.extractRelations(newMemory, existingMemories, {
        candidateLimit: 30
      });

      // Then: candidateLimit이 LLM extractor에 전달되어야 함
      expect(mockLLMExtractor.extractRelations).toHaveBeenCalledWith(
        newMemory,
        expect.any(Array),
        expect.objectContaining({
          candidateLimit: 30
        })
      );
    });

    it('should use default candidateLimit of 30 for MiniLM filtering', async () => {
      // Given: 많은 기존 기억들
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemories = Array.from({ length: 100 }, (_, i) =>
        createTestMemory(`mem${i + 2}`, `기존 기능 ${i}`, 'episodic')
      );

      mockRuleExtractor.extractRelations.mockResolvedValue([]);
      mockLLMExtractor.extractRelations.mockResolvedValue([]);
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: new Array(384).fill(0.1),
        provider: 'minilm'
      });
      mockEmbeddingService.searchSimilar.mockResolvedValue([
        { id: 'mem2', similarity: 0.9, score: 0.9 }
      ]);

      // When: candidateLimit 옵션 없이 관계 추출
      await extractor.extractRelations(newMemory, existingMemories);

      // Then: 기본값 30이 사용되어야 함
      expect(mockLLMExtractor.extractRelations).toHaveBeenCalledWith(
        newMemory,
        expect.any(Array),
        expect.objectContaining({
          candidateLimit: 30
        })
      );
    });
  });

  describe('캐싱 테스트', () => {
    it('should cache results when immediate option is true', async () => {
      // Given: 즉시 처리 옵션과 함께 관계 추출
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '관련'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);
      mockCoreMemoryCacheService.get.mockReturnValue(null);

      // When: immediate 옵션과 함께 관계 추출
      await extractor.extractRelations(newMemory, [existingMemory], {
        immediate: true
      });

      // Then: 결과가 캐시에 저장되어야 함
      expect(mockCoreMemoryCacheService.set).toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      // Given: 캐시에 저장된 결과
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const cachedCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: 'Cached'
        }
      ];

      mockCoreMemoryCacheService.get.mockReturnValue(cachedCandidates);

      // When: immediate 옵션과 함께 관계 추출
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        immediate: true
      });

      // Then: 캐시된 결과가 반환되어야 함
      expect(candidates).toEqual(cachedCandidates);
      expect(mockRuleExtractor.extractRelations).not.toHaveBeenCalled();
    });

    it('should not cache when immediate option is false', async () => {
      // Given: 즉시 처리 옵션이 false인 경우
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '관련'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);

      // When: immediate 옵션이 false로 관계 추출
      await extractor.extractRelations(newMemory, [existingMemory], {
        immediate: false
      });

      // Then: 캐시에 저장되지 않아야 함
      expect(mockCoreMemoryCacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('배치 처리 테스트', () => {
    it('should process multiple memories in batches', async () => {
      // Given: 여러 새로운 기억들
      const newMemories = Array.from({ length: 25 }, (_, i) =>
        createTestMemory(`mem${i + 1}`, `새로운 기능 ${i}`, 'episodic')
      );
      const existingMemories = [
        createTestMemory('existing1', '기존 기능 1', 'episodic'),
        createTestMemory('existing2', '기존 기능 2', 'episodic')
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue([]);

      // When: 배치 처리로 관계 추출
      const results = await extractor.extractRelationsBatch(newMemories, existingMemories);

      // Then: 모든 기억에 대한 결과가 반환되어야 함
      expect(results.size).toBe(25);
      // 배치 크기 10이므로 최소 3번 호출되어야 함 (25개 / 10 = 3 배치)
      expect(mockRuleExtractor.extractRelations).toHaveBeenCalledTimes(25);
    });

    it('should enable caching for batch processing', async () => {
      // Given: 여러 새로운 기억들
      const newMemories = [
        createTestMemory('mem1', '새로운 기능 1', 'episodic'),
        createTestMemory('mem2', '새로운 기능 2', 'episodic')
      ];
      const existingMemories = [
        createTestMemory('existing1', '기존 기능 1', 'episodic')
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue([]);
      mockCoreMemoryCacheService.get.mockReturnValue(null);

      // When: 배치 처리로 관계 추출
      await extractor.extractRelationsBatch(newMemories, existingMemories);

      // Then: 각 기억에 대해 캐싱이 활성화되어야 함 (immediate: true)
      expect(mockRuleExtractor.extractRelations).toHaveBeenCalledWith(
        expect.any(Object),
        existingMemories,
        expect.objectContaining({
          immediate: true
        })
      );
    });
  });

  describe('추출 방법 선택', () => {
    it('should use only rule-based extraction when method is "rule"', async () => {
      // Given: method가 "rule"인 경우
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const ruleCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.8,
          method: 'rule' as const,
          evidence: '관련'
        }
      ];

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);

      // When: method가 "rule"로 설정된 경우
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'rule'
      });

      // Then: 규칙 기반만 사용되어야 함
      expect(candidates).toEqual(ruleCandidates);
      expect(mockLLMExtractor.extractRelations).not.toHaveBeenCalled();
    });

    it('should use only LLM extraction when method is "llm"', async () => {
      // Given: method가 "llm"인 경우
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const llmCandidates = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'REFERENCES' as RelationType,
          confidence: 0.7,
          method: 'llm' as const,
          evidence: 'LLM 분석'
        }
      ];

      mockLLMExtractor.extractRelations.mockResolvedValue(llmCandidates);
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: new Array(384).fill(0.1),
        provider: 'minilm'
      });
      mockEmbeddingService.searchSimilar.mockResolvedValue([
        { id: 'mem2', similarity: 0.9, score: 0.9 }
      ]);

      // When: method가 "llm"으로 설정된 경우
      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'llm'
      });

      // Then: LLM만 사용되어야 함
      expect(candidates).toEqual(llmCandidates);
      expect(mockRuleExtractor.extractRelations).not.toHaveBeenCalled();
    });
  });
});
