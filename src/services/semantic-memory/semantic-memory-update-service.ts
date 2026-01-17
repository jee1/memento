/**
 * Semantic Memory 갱신 서비스
 * 
 * Triple 추출 결과를 기반으로 Semantic Memory를 생성하거나 업데이트합니다.
 * 
 * 주요 기능:
 * - Triple 기반 Semantic Memory 생성/업데이트
 * - 중복 판단 및 병합
 * - Confidence 계산 (구조적 검증 기반)
 * - 중요도 계산
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { RelationGraph } from '../../domains/relation/services/relation-graph.js';
import { UnifiedEmbeddingService } from '../../domains/embedding/services/unified-embedding-service.js';
import { PredicateCanonicalizer } from '../triple-extraction/predicate-canonicalizer.js';
import { EntityLinker } from '../triple-extraction/entity-linker.js';
import type { Triple, TripleExtractionResult, ExtractionInfo } from '../../shared/types/triple-extraction.js';
import { logger } from '../../shared/utils/logger.js';
/**
 * Memory ID 생성 유틸리티
 */
function generateId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `mem_${timestamp}_${random}`;
}
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';

/**
 * Semantic Memory 업데이트 결과
 */
export interface SemanticMemoryUpdateResult {
  created: number;           // 생성된 Semantic Memory 수
  updated: number;           // 업데이트된 Semantic Memory 수
  skipped: number;           // 건너뛴 Semantic Memory 수 (중복 또는 낮은 confidence)
  semanticMemoryIds: string[]; // 생성/업데이트된 Semantic Memory ID 목록
}

/**
 * Semantic Memory 업데이트 옵션
 */
export interface SemanticMemoryUpdateOptions {
  /**
   * Episodic Memory ID (관계 생성용)
   */
  episodicMemoryId: string;
  
  /**
   * Episodic Memory 중요도 (중요도 계산용)
   */
  episodicImportance?: number;
  
  /**
   * Confidence 임계값 (기본값: 0.7)
   * 
   * PRD 2.4: 신뢰도가 일정 수준 이상인 경우만 Semantic Memory 생성
   * 이 값보다 낮은 confidence를 가진 triple은 Semantic Memory로 변환하지 않음
   * 설정 가능하며, 미지정 시 기본값 0.7 사용
   */
  confidenceThreshold?: number;
  
  /**
   * Subject/Object 유사도 임계값 (기본값: 0.9)
   */
  similarityThreshold?: number;
}

/**
 * Semantic Memory 갱신 서비스
 */
export class SemanticMemoryUpdateService {
  private readonly canonicalizer: PredicateCanonicalizer;
  private readonly entityLinker: EntityLinker;
  private readonly embeddingService: UnifiedEmbeddingService;
  private readonly relationGraph: RelationGraph;
  private readonly statistics: SemanticMemoryStatisticsService; // PRD 8.2: Semantic Memory 생성 통계 수집

  // 기본 설정
  /**
   * Confidence 임계값 기본값 (PRD 2.4 참고)
   * 신뢰도가 이 값 이상인 경우만 Semantic Memory 생성
   */
  private readonly DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
  
  /**
   * Subject/Object 유사도 임계값 기본값
   * 중복 판단 시 사용되는 유사도 임계값
   */
  private readonly DEFAULT_SIMILARITY_THRESHOLD = 0.9;

  constructor(
    private db: Database.Database,
    embeddingService?: UnifiedEmbeddingService,
    relationGraph?: RelationGraph
  ) {
    this.canonicalizer = new PredicateCanonicalizer();
    this.entityLinker = new EntityLinker();
    
    // UnifiedEmbeddingService 주입 또는 기본값 생성
    // 왜 필요한가? 의존성 주입을 통해 테스트 가능성 향상 및 인터페이스 기반 설계 준수 (DIP 원칙)
    // 타입 안정성: 주입된 서비스가 EmbeddingServiceInterface를 구현하는지 검증
    if (embeddingService) {
      // 주입된 서비스가 UnifiedEmbeddingService 인터페이스를 구현하는지 확인
      // "generateEmbedding is not a function" 에러 방지를 위해 필수
      if (typeof embeddingService.generateEmbedding !== 'function') {
        throw new Error('Invalid embeddingService: generateEmbedding method is missing');
      }
      if (typeof embeddingService.isAvailable !== 'function') {
        throw new Error('Invalid embeddingService: isAvailable method is missing');
      }
      this.embeddingService = embeddingService;
    } else {
      // 기본값으로 UnifiedEmbeddingService 인스턴스 생성
      this.embeddingService = new UnifiedEmbeddingService();
    }
    
    this.relationGraph = relationGraph || new RelationGraph(db);
    
    // PRD 8.2: Semantic Memory 생성 통계 수집
    this.statistics = new SemanticMemoryStatisticsService();
    
    // 런타임 relation_type_registry 등록 (없을 경우 자동 등록)
    this.ensureRelationTypes();
  }

  /**
   * 런타임 relation_type_registry 등록
   * 
   * extracted_from와 supported_by 관계 타입이 없을 경우 자동 등록합니다.
   * 마이그레이션에서 초기 데이터 삽입은 처리되지만, 런타임에 없을 경우를 대비합니다.
   */
  private ensureRelationTypes(): void {
    try {
      // extracted_from 관계 타입 확인 및 등록
      const extractedFrom = DatabaseUtils.get(this.db, `
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `, ['extracted_from']) as { type_name: string } | undefined;

      if (!extractedFrom) {
        DatabaseUtils.run(this.db, `
          INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          'extracted_from',
          'Structural',
          '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨',
          JSON.stringify(['episodic', 'semantic']),
          0.7,
          1.1
        ]);
        logger.debug('SemanticMemoryUpdateService: extracted_from 관계 타입 등록');
      }

      // supported_by 관계 타입 확인 및 등록
      const supportedBy = DatabaseUtils.get(this.db, `
        SELECT type_name FROM relation_type_registry WHERE type_name = ?
      `, ['supported_by']) as { type_name: string } | undefined;

      if (!supportedBy) {
        DatabaseUtils.run(this.db, `
          INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          'supported_by',
          'Structural',
          '근거 관계: Semantic Memory가 Episodic Memory에 의해 근거를 가짐',
          JSON.stringify(['episodic', 'semantic']),
          0.7,
          1.1
        ]);
        logger.debug('SemanticMemoryUpdateService: supported_by 관계 타입 등록');
      }
    } catch (error) {
      // relation_type_registry 테이블이 없을 수 있으므로 에러는 무시
      logger.warn('SemanticMemoryUpdateService: relation_type_registry 등록 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Triple 배열을 기반으로 Semantic Memory를 생성하거나 업데이트합니다.
   * 
   * @param extractionResult Triple 추출 결과
   * @param options 업데이트 옵션
   * @returns 업데이트 결과
   */
  async updateSemanticMemory(
    extractionResult: TripleExtractionResult,
    options: SemanticMemoryUpdateOptions
  ): Promise<SemanticMemoryUpdateResult> {
    const processingStartTime = Date.now(); // PRD 8.2: 처리 시간 측정 시작
    
    // Given: 입력 검증
    const validationResult = this.validateInput(extractionResult);
    if (validationResult) {
      return validationResult;
    }

    // Given: 업데이트 데이터 준비
    const preparedData = this.prepareUpdateData(options);
    
    // When: 각 Triple 처리
    const { result, confidences, hasError } = await this.applyUpdates(
      extractionResult,
      options,
      preparedData
    );

    // Then: 통계 수집 및 리스너 알림
    this.notifyListeners(
      result,
      extractionResult.triples.length,
      confidences,
      processingStartTime,
      hasError
    );

    return result;
  }

  /**
   * 입력 검증
   * 
   * Given: extractionResult가 주어졌을 때
   * When: triples 배열이 비어있는지 검증
   * Then: 비어있으면 빈 결과 반환, 아니면 null 반환
   * 
   * @param extractionResult Triple 추출 결과
   * @returns 빈 결과 또는 null
   */
  private validateInput(
    extractionResult: TripleExtractionResult
  ): SemanticMemoryUpdateResult | null {
    if (extractionResult.triples.length === 0) {
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        semanticMemoryIds: []
      };
    }
    return null;
  }

  /**
   * 업데이트 데이터 준비
   * 
   * Given: options가 주어졌을 때
   * When: 임계값 설정 및 초기 데이터 준비
   * Then: 준비된 데이터 반환
   * 
   * @param options 업데이트 옵션
   * @returns 준비된 데이터
   */
  private prepareUpdateData(options: SemanticMemoryUpdateOptions): {
    confidenceThreshold: number;
    similarityThreshold: number;
    result: SemanticMemoryUpdateResult;
    confidences: number[];
    hasError: boolean;
  } {
    return {
      confidenceThreshold: options.confidenceThreshold ?? this.DEFAULT_CONFIDENCE_THRESHOLD,
      similarityThreshold: options.similarityThreshold ?? this.DEFAULT_SIMILARITY_THRESHOLD,
      result: {
        created: 0,
        updated: 0,
        skipped: 0,
        semanticMemoryIds: []
      },
      confidences: [],
      hasError: false
    };
  }

  /**
   * 각 Triple 처리
   * 
   * Given: extractionResult, options, preparedData가 주어졌을 때
   * When: 각 triple을 순차적으로 처리
   * Then: 처리 결과 반환
   * 
   * @param extractionResult Triple 추출 결과
   * @param options 업데이트 옵션
   * @param preparedData 준비된 데이터
   * @returns 처리 결과
   */
  private async applyUpdates(
    extractionResult: TripleExtractionResult,
    options: SemanticMemoryUpdateOptions,
    preparedData: {
      confidenceThreshold: number;
      similarityThreshold: number;
      result: SemanticMemoryUpdateResult;
      confidences: number[];
      hasError: boolean;
    }
  ): Promise<{
    result: SemanticMemoryUpdateResult;
    confidences: number[];
    hasError: boolean;
  }> {
    const { confidenceThreshold, similarityThreshold, result, confidences } = preparedData;
    let hasError = false;

    // 각 Triple에 대해 Semantic Memory 생성/업데이트
    for (const triple of extractionResult.triples) {
      try {
        const processed = await this.processSingleTriple(
          triple,
          extractionResult.extractionInfo,
          options,
          confidenceThreshold,
          similarityThreshold,
          result
        );
        
        // PRD 8.2: Confidence 통계 수집
        confidences.push(processed.confidence);
      } catch (error) {
        // PRD 8.2: 에러 통계 수집
        hasError = true;
        
        // 관계 방향 검증 실패는 상위로 전파
        if (error instanceof Error && error.message.includes('관계 방향 오류')) {
          throw error;
        }
        
        logger.error('SemanticMemoryUpdateService: Triple 처리 실패', {
          error: error instanceof Error ? error.message : String(error),
          triple
        });
        result.skipped++;
      }
    }

    return { result, confidences, hasError };
  }

  /**
   * 단일 Triple 처리
   * 
   * Given: triple, extractionInfo, options, 임계값들이 주어졌을 때
   * When: 단일 triple을 처리하여 Semantic Memory 생성/업데이트
   * Then: 처리 결과 반환
   * 
   * @param triple 처리할 Triple
   * @param extractionInfo 추출 정보
   * @param options 업데이트 옵션
   * @param confidenceThreshold Confidence 임계값
   * @param similarityThreshold 유사도 임계값
   * @param result 결과 객체 (수정됨)
   * @returns 처리된 confidence
   */
  private async processSingleTriple(
    triple: Triple,
    extractionInfo: ExtractionInfo,
    options: SemanticMemoryUpdateOptions,
    confidenceThreshold: number,
    similarityThreshold: number,
    result: SemanticMemoryUpdateResult
  ): Promise<{ confidence: number }> {
    // Confidence 계산 (구조적 검증 기반, PRD 2.4 참고)
    const confidence = this.calculateConfidence(triple, extractionInfo);
    
    // PRD 2.4: 신뢰도가 일정 수준 이상인 경우만 Semantic Memory 생성
    // Confidence 임계값 필터링 (기본값: 0.7, 설정 가능)
    if (confidence < confidenceThreshold) {
      result.skipped++;
      logger.debug('SemanticMemoryUpdateService: Confidence가 임계값 미만', {
        triple,
        confidence,
        threshold: confidenceThreshold,
        reason: 'confidence_below_threshold'
      });
      return { confidence };
    }

    // 중복 Semantic Memory 검색 (PRD 2.2 참고)
    const duplicate = await this.findDuplicateSemanticMemory(triple, similarityThreshold);

    if (duplicate) {
      // PRD 2.3: 유사도가 임계값 이상인 경우 새로운 항목을 생성하지 않고 기존 항목 업데이트 (병합)
      // 완전히 동일한 Semantic Memory는 생성하지 않음
      await this.updateExistingSemanticMemory(duplicate.id, triple, options, confidence);
      result.updated++;
      result.semanticMemoryIds.push(duplicate.id);
    } else {
      // 새로운 Semantic Memory 생성 (중복이 없는 경우)
      const semanticMemoryId = await this.createSemanticMemory(triple, options, confidence);
      result.created++;
      result.semanticMemoryIds.push(semanticMemoryId);
    }

    // Episodic-Edge 관계 생성 (각 triple마다 별도 relation)
    // 관계 방향 검증은 createEpisodicEdge 내부에서 수행되지만,
    // 방향 검증 실패는 상위로 전파되어야 함
    try {
      const semanticMemoryId = duplicate?.id || result.semanticMemoryIds[result.semanticMemoryIds.length - 1];
      if (!semanticMemoryId) {
        throw new Error('Semantic memory ID is required for creating episodic edge');
      }
      await this.createEpisodicEdge(
        options.episodicMemoryId,
        semanticMemoryId,
        triple,
        extractionInfo,
        confidence
      );
    } catch (edgeError) {
      // 관계 방향 검증 실패는 상위로 전파
      if (edgeError instanceof Error && edgeError.message.includes('관계 방향 오류')) {
        throw edgeError;
      }
      // 기타 관계 생성 실패는 무시 (Semantic Memory 생성에는 영향 없음)
      logger.warn('SemanticMemoryUpdateService: 관계 생성 실패 (무시)', {
        error: edgeError instanceof Error ? edgeError.message : String(edgeError),
        triple
      });
    }

    return { confidence };
  }

  /**
   * 통계 수집 및 리스너 알림
   * 
   * Given: 처리 결과가 주어졌을 때
   * When: 통계를 수집하고 리스너에게 알림
   * Then: statistics.recordUpdate가 호출됨
   * 
   * @param result 처리 결과
   * @param totalTriples 전체 Triple 개수
   * @param confidences Confidence 배열
   * @param processingStartTime 처리 시작 시간
   * @param hasError 에러 발생 여부
   */
  private notifyListeners(
    result: SemanticMemoryUpdateResult,
    totalTriples: number,
    confidences: number[],
    processingStartTime: number,
    hasError: boolean
  ): void {
    // PRD 8.2: Semantic Memory 생성 통계 수집
    const processingTime = Date.now() - processingStartTime;
    const duplicates = totalTriples - (result.created + result.updated + result.skipped);
    this.statistics.recordUpdate(
      result.created,
      result.updated,
      result.skipped,
      duplicates,
      confidences,
      processingTime,
      hasError
    );
  }

  /**
   * Semantic Memory 생성 통계 조회
   * 
   * PRD 8.2: Semantic Memory 생성 통계
   * - 생성된 Semantic Memory 수
   * - 업데이트된 Semantic Memory 수
   * - 중복 제거된 항목 수
   * 
   * @returns Semantic Memory 생성 통계
   */
  getStatistics() {
    return this.statistics.getStatistics();
  }

  /**
   * Triple을 자연어로 변환
   * 
   * @param subject 정규화된 subject
   * @param predicate 정규화된 predicate
   * @param object 정규화된 object
   * @returns 자연어 문장
   */
  private tripleToNaturalLanguage(
    subject: string,
    predicate: string,
    object: string
  ): string {
    // 간단한 자연어 변환: "subject는 object를 predicate합니다" 형식
    return `${subject}는 ${object}를 ${predicate}합니다`;
  }

  /**
   * 새로운 Semantic Memory 생성
   * 
   * Triple의 predicate, subject, object를 정규화하여 저장합니다.
   * 
   * @param triple Triple
   * @param options 업데이트 옵션
   * @param confidence Confidence
   * @returns 생성된 Semantic Memory ID
   */
  private async createSemanticMemory(
    triple: Triple,
    options: SemanticMemoryUpdateOptions,
    confidence: number
  ): Promise<string> {
    // Predicate 정규화 (표준 predicate 사용)
    const predicateResult = this.canonicalizer.canonicalize(triple.predicate);
    const normalizedPredicate = predicateResult.canonical;

    // Subject/Object Entity Linking (정규화된 엔티티 사용)
    const subjectResult = this.entityLinker.link(triple.subject);
    const objectResult = this.entityLinker.link(triple.object);
    const normalizedSubject = subjectResult.linked;
    const normalizedObject = objectResult.linked;

    // 정규화된 값들로 자연어 문장 생성
    const content = this.tripleToNaturalLanguage(
      normalizedSubject,
      normalizedPredicate,
      normalizedObject
    );

    const id = generateId();
    const importance = this.calculateImportance(options.episodicImportance || 0.5, 1);
    const createdAt = new Date().toISOString();

    // Semantic Memory 생성 (정규화된 subject, predicate, object 컬럼에 저장)
    await DatabaseUtils.run(this.db, `
      INSERT INTO memory_item (
        id, type, content, subject, predicate, object,
        importance, privacy_scope, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      'semantic',
      content,
      normalizedSubject,  // 정규화된 subject
      normalizedPredicate, // 정규화된 predicate
      normalizedObject,    // 정규화된 object
      importance,
      'private',
      createdAt
    ]);

    logger.debug('SemanticMemoryUpdateService: Semantic Memory 생성', {
      id,
      originalTriple: triple,
      normalizedTriple: {
        subject: normalizedSubject,
        predicate: normalizedPredicate,
        object: normalizedObject
      },
      confidence,
      importance
    });

    return id;
  }

  /**
   * 기존 Semantic Memory 업데이트 (병합 전략)
   * 
   * PRD 2.3 중복 방지 및 병합 전략에 따라:
   * - 유사도가 임계값 이상인 경우 새로운 항목을 생성하지 않고 기존 항목 업데이트
   * - 기존 항목의 중요도 업데이트
   * - Episode Weight 누적: 동일 triple이 여러 Episodic Memory에서 추출된 경우 가중치 증가
   *   * recall_count를 증가시켜 Episode Weight를 추적
   *   * 중요도는 Episode Weight를 반영하여 재계산
   * - 완전히 동일한 Semantic Memory는 생성하지 않음 (중복 판단 로직에서 처리)
   * 
   * @param semanticMemoryId Semantic Memory ID
   * @param triple Triple
   * @param options 업데이트 옵션
   * @param confidence Confidence
   */
  private async updateExistingSemanticMemory(
    semanticMemoryId: string,
    triple: Triple,
    options: SemanticMemoryUpdateOptions,
    confidence: number
  ): Promise<void> {
    // 기존 Semantic Memory 조회
    const existing = DatabaseUtils.get(this.db, `
      SELECT id, importance, recall_count
      FROM memory_item
      WHERE id = ?
    `, [semanticMemoryId]) as { id: string; importance: number; recall_count: number } | undefined;

    if (!existing) {
      throw new Error(`Semantic Memory를 찾을 수 없습니다: ${semanticMemoryId}`);
    }

    // Episode Weight 누적: 동일 triple이 여러 Episodic Memory에서 추출된 경우 가중치 증가
    // recall_count를 증가시켜 Episode Weight를 추적
    const episodeWeight = (existing.recall_count || 0) + 1;

    // 중요도 업데이트 (Episode Weight 반영)
    // 여러 Episodic Memory에서 동일한 Semantic Memory가 추출된 경우 중요도 증가
    const newImportance = this.calculateImportance(
      options.episodicImportance || 0.5,
      episodeWeight
    );

    // 기존 항목 업데이트 (병합)
    await DatabaseUtils.run(this.db, `
      UPDATE memory_item
      SET importance = ?,
          recall_count = recall_count + 1,
          last_accessed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newImportance, semanticMemoryId]);

    logger.debug('SemanticMemoryUpdateService: Semantic Memory 업데이트 (병합)', {
      id: semanticMemoryId,
      triple,
      episodeWeight,
      oldImportance: existing.importance,
      newImportance,
      confidence
    });
  }

  /**
   * 중복 Semantic Memory 검색
   * 
   * Triple 요소별 비교 기준 (PRD 2.2 참고):
   * - Predicate: Canonicalization 후 정확히 일치하면 동일한 것으로 처리 (정확 일치만)
   * - Subject: 문자열 정규화 후 일치 여부를 기본으로, 임베딩 유사도를 보조 기준으로 사용
   * - Object: Subject와 동일한 방식 (정규화 + 유사도)
   * 
   * 중복 판단 로직:
   * ```
   * if (predicate == predicate' AND 
   *     (subject.normalized() == subject'.normalized() OR subject.similarity(subject') > threshold) AND
   *     (object.normalized() == object'.normalized() OR object.similarity(object') > threshold))
   *   → 중복으로 판단
   * ```
   * 
   * @param triple Triple
   * @param similarityThreshold 유사도 임계값 (기본값: 0.9)
   * @returns 중복 Semantic Memory (없으면 null)
   */
  private async findDuplicateSemanticMemory(
    triple: Triple,
    similarityThreshold: number
  ): Promise<{ id: string; subject: string; predicate: string; object: string } | null> {
    // Predicate 정규화 (표준 predicate 사용)
    const predicateResult = this.canonicalizer.canonicalize(triple.predicate);
    const normalizedPredicate = predicateResult.canonical;

    // Subject/Object Entity Linking (정규화된 엔티티 사용)
    const subjectResult = this.entityLinker.link(triple.subject);
    const objectResult = this.entityLinker.link(triple.object);
    const normalizedSubject = subjectResult.linked;
    const normalizedObject = objectResult.linked;

    // 1. 정확한 매칭 우선 (정규화 후 완전 일치)
    // 완전히 동일한 triple (subject, predicate, object 모두 정규화 후 일치)은 즉시 중복으로 판단
    const exactMatch = DatabaseUtils.get(this.db, `
      SELECT id, subject, predicate, object
      FROM memory_item
      WHERE type = 'semantic'
        AND predicate = ?
        AND subject = ?
        AND object = ?
      LIMIT 1
    `, [normalizedPredicate, normalizedSubject, normalizedObject]) as {
      id: string;
      subject: string;
      predicate: string;
      object: string;
    } | undefined;

    if (exactMatch) {
      return exactMatch;
    }

    // 2. Predicate 정확 일치 + Subject/Object 유사도 검사
    // Predicate는 정규화 과정을 거쳤으므로 유사도 비교가 아닌 정확 일치가 기본
    const candidates = DatabaseUtils.all(this.db, `
      SELECT id, subject, predicate, object, content
      FROM memory_item
      WHERE type = 'semantic'
        AND predicate = ?
    `, [normalizedPredicate]) as Array<{
      id: string;
      subject: string;
      predicate: string;
      object: string;
      content: string;
    }>;

    if (candidates.length === 0) {
      return null;
    }

    // Subject/Object 유사도 계산
    // 문자열 정규화 후 일치 여부를 기본으로, 임베딩 유사도를 보조 기준으로 사용
    for (const candidate of candidates) {
      const subjectSimilar = await this.checkSimilarity(
        normalizedSubject,
        candidate.subject,
        similarityThreshold
      );
      const objectSimilar = await this.checkSimilarity(
        normalizedObject,
        candidate.object,
        similarityThreshold
      );

      // Subject와 Object 모두 유사도 임계값 이상이면 중복으로 판단
      if (subjectSimilar && objectSimilar) {
        return {
          id: candidate.id,
          subject: candidate.subject,
          predicate: candidate.predicate,
          object: candidate.object
        };
      }
    }

    return null;
  }

  /**
   * 두 엔티티의 유사도 확인
   * 
   * PRD 2.2 중복 판단 기준표에 따라:
   * - 기본 기준: 문자열 정규화 후 일치 여부 (lowercasing, 공백 제거)
   * - 보조 기준: 임베딩 유사도 (임계값 이상이면 유사한 것으로 판단)
   * 
   * 정규화: lowercasing, 공백 제거, 한글/영문 혼용 통일 (EntityLinker에서 이미 수행됨)
   * 
   * @param entity1 첫 번째 엔티티 (이미 정규화된 값)
   * @param entity2 두 번째 엔티티 (DB에서 조회한 값)
   * @param threshold 유사도 임계값 (기본값: 0.9)
   * @returns 유사도가 임계값 이상이면 true
   */
  private async checkSimilarity(
    entity1: string,
    entity2: string,
    threshold: number
  ): Promise<boolean> {
    // 기본 기준: 문자열 정규화 후 일치 여부 확인
    // (EntityLinker에서 이미 정규화되었지만, 안전장치로 추가 정규화 수행)
    const normalized1 = entity1.toLowerCase().trim();
    const normalized2 = entity2.toLowerCase().trim();
    
    if (normalized1 === normalized2) {
      return true;
    }

    // 보조 기준: 임베딩 유사도 계산
    // 왜 null 체크가 필요한가? 생성자에서 기본값을 제공하지만, 런타임에 변경될 수 있음
    // 방어적 코딩: "generateEmbedding is not a function" 에러 방지
    if (!this.embeddingService) {
      logger.warn('SemanticMemoryUpdateService: embeddingService is not available', {
        entity1,
        entity2
      });
      return false;
    }

    // isAvailable() 호출 전 타입 가드
    // 왜 필요한가? 런타임에 메서드가 없을 수 있음 (잘못된 의존성 주입 시)
    if (typeof this.embeddingService.isAvailable !== 'function') {
      logger.warn('SemanticMemoryUpdateService: embeddingService.isAvailable is not a function', {
        entity1,
        entity2
      });
      return false;
    }

    if (!this.embeddingService.isAvailable()) {
      // 임베딩 서비스가 사용 불가능하면 정규화 일치만 확인
      return false;
    }

    // generateEmbedding 메서드 존재 여부 확인 (타입 가드)
    // 왜 필요한가? "generateEmbedding is not a function" 에러 방지
    if (typeof this.embeddingService.generateEmbedding !== 'function') {
      logger.error('SemanticMemoryUpdateService: embeddingService.generateEmbedding is not a function', {
        entity1,
        entity2,
        embeddingServiceType: typeof this.embeddingService
      });
      return false;
    }

    try {
      const embedding1 = await this.embeddingService.generateEmbedding(entity1);
      const embedding2 = await this.embeddingService.generateEmbedding(entity2);

      if (!embedding1 || !embedding2) {
        return false;
      }

      const similarity = this.cosineSimilarity(embedding1.embedding, embedding2.embedding);
      return similarity >= threshold;
    } catch (error) {
      logger.warn('SemanticMemoryUpdateService: 유사도 계산 실패', {
        error: error instanceof Error ? error.message : String(error),
        entity1,
        entity2
      });
      return false;
    }
  }

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * 구조적 검증 기반 Confidence 계산
   * 
   * PRD 2.4 신뢰도 기반 필터링 (구조적 검증 방식)에 따라:
   * - LLM 응답에서 confidence 추출은 신뢰할 수 없음 (대부분의 LLM은 신뢰할 수 있는 confidence를 제공하지 않음)
   * - 구조적 검증 기반 confidence 계산 (AriGraph 방식) 사용
   * 
   * 각 검증 단계별 점수 부여:
   * 1. Triple 구조의 완전성 검증 (subject, predicate, object 모두 존재): 0.3
   * 2. Predicate 정규화 성공 여부: 0.3
   * 3. Entity linking 성공 여부: 0.4
   *    - Subject와 Object 모두 성공: 0.4
   *    - 하나만 성공: 0.2 (부분 성공)
   * 
   * 최종 confidence는 0.0~1.0 범위로 정규화됩니다.
   * 신뢰도가 일정 수준 이상인 경우만 Semantic Memory 생성 (기본 임계값: 0.7)
   * 
   * @param triple Triple
   * @param extractionInfo 추출 정보 (steps 정보 포함)
   * @returns Confidence (0.0~1.0)
   */
  private calculateConfidence(
    triple: Triple,
    extractionInfo: ExtractionInfo
  ): number {
    let confidence = 0.0;

    // 1. Triple 구조 완전성 검증 (0.3)
    // subject, predicate, object 모두 존재하는지 확인
    if (triple.subject && triple.predicate && triple.object) {
      confidence += 0.3;
    }

    // 2. Predicate 정규화 성공 여부 (0.3)
    // 표준 predicate 사전에 있는 경우 높은 confidence 부여
    const predicateResult = this.canonicalizer.canonicalize(triple.predicate);
    if (predicateResult.success) {
      confidence += 0.3;
    }
    // extractionInfo.steps는 보조 검증으로만 사용 (실제 결과가 우선)

    // 3. Entity Linking 성공 여부 (0.4)
    // Subject와 Object 모두 정규화 성공 시 최대 점수 부여
    const subjectResult = this.entityLinker.link(triple.subject);
    const objectResult = this.entityLinker.link(triple.object);
    
    if (subjectResult.success && objectResult.success) {
      // Subject와 Object 모두 성공: 0.4
      confidence += 0.4;
    } else {
      // 부분 성공: 하나만 성공한 경우 0.2 부여
      if (subjectResult.success || objectResult.success) {
        confidence += 0.2;
      }
    }
    // extractionInfo.steps는 보조 검증으로만 사용 (실제 결과가 우선)

    // 0.0~1.0 범위로 정규화
    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Semantic Memory 중요도 계산
   * 
   * PRD 2.5 Semantic Memory 중요도 계산에 따라:
   * - Triple이 추출된 Episodic Memory의 중요도 반영
   * - 여러 Episodic Memory에서 동일한 Semantic Memory가 추출된 경우 중요도 증가
   *   * Episode Weight 누적: 동일 triple이 여러 Episodic Memory에서 추출된 경우 가중치 증가
   *   * 로그 스케일을 사용하여 증가폭을 제어 (과도한 증가 방지)
   * - 중요도 Decay: 시간이 지나면서 중요도가 감쇠하는지 여부 결정 (초기에는 decay 없음)
   * - 중요도는 0.0~1.0 범위로 정규화
   * 
   * 계산 공식:
   * - 기본 중요도 = Episodic Memory 중요도
   * - Episode Weight가 1보다 큰 경우: importance += log(episodeCount + 1) / log(10) * 0.1
   * - 최종 중요도 = min(1.0, max(0.0, importance))
   * 
   * @param episodicImportance Triple이 추출된 Episodic Memory의 중요도
   * @param episodeCount Episode Weight (여러 Episodic Memory에서 추출된 횟수)
   * @returns 계산된 중요도 (0.0~1.0)
   */
  private calculateImportance(
    episodicImportance: number,
    episodeCount: number
  ): number {
    // 기본 중요도는 Episodic Memory 중요도 사용
    // Triple이 추출된 Episodic Memory의 중요도를 반영
    let importance = episodicImportance;

    // 여러 Episodic Memory에서 동일한 Semantic Memory가 추출된 경우 중요도 증가
    // Episode Weight 누적: episodeCount가 많을수록 중요도 증가 (로그 스케일)
    // 로그 스케일을 사용하여 증가폭을 제어 (과도한 증가 방지)
    if (episodeCount > 1) {
      const boost = Math.log(episodeCount + 1) / Math.log(10); // 로그 스케일 (base 10)
      importance = Math.min(1.0, importance + (boost * 0.1));
    }

    // 중요도는 0.0~1.0 범위로 정규화
    // 중요도 Decay는 초기에는 없음 (시간에 따른 감쇠 없음)
    return Math.min(1.0, Math.max(0.0, importance));
  }

  /**
   * 관계 방향 검증
   * 
   * PRD 3.2 관계 타입 정의에 따라:
   * - extracted_from: source가 Episodic, target이 Semantic이어야 함
   * - supported_by: source가 Semantic, target이 Episodic이어야 함
   * 
   * @param sourceId 소스 Memory ID
   * @param targetId 타겟 Memory ID
   * @param relationType 관계 타입
   * @throws Error 관계 방향이 올바르지 않은 경우
   */
  private async validateRelationDirection(
    sourceId: string,
    targetId: string,
    relationType: 'extracted_from' | 'supported_by'
  ): Promise<void> {
    // 소스와 타겟 Memory 타입 확인
    const sourceMemory = DatabaseUtils.get(this.db, `
      SELECT id, type FROM memory_item WHERE id = ?
    `, [sourceId]) as { id: string; type: string } | undefined;

    const targetMemory = DatabaseUtils.get(this.db, `
      SELECT id, type FROM memory_item WHERE id = ?
    `, [targetId]) as { id: string; type: string } | undefined;

    if (!sourceMemory || !targetMemory) {
      throw new Error(`Memory를 찾을 수 없습니다: source=${sourceId}, target=${targetId}`);
    }

    // 관계 방향 검증
    if (relationType === 'extracted_from') {
      // extracted_from: source가 Episodic, target이 Semantic이어야 함
      if (sourceMemory.type !== 'episodic' || targetMemory.type !== 'semantic') {
        throw new Error(
          `extracted_from 관계 방향 오류: source는 'episodic'이어야 하고 target은 'semantic'이어야 합니다. ` +
          `현재: source=${sourceMemory.type}, target=${targetMemory.type}`
        );
      }
    } else if (relationType === 'supported_by') {
      // supported_by: source가 Semantic, target이 Episodic이어야 함
      if (sourceMemory.type !== 'semantic' || targetMemory.type !== 'episodic') {
        throw new Error(
          `supported_by 관계 방향 오류: source는 'semantic'이어야 하고 target은 'episodic'이어야 합니다. ` +
          `현재: source=${sourceMemory.type}, target=${targetMemory.type}`
        );
      }
    }
  }

  /**
   * Episodic-Edge 관계 생성
   * 
   * PRD 2.4 Confidence 저장 위치 및 연계 방식에 따라:
   * - **주 저장 위치**: `memory_relation` 테이블의 `confidence` 필드
   *   - Episodic Memory와 Semantic Memory 간 관계의 신뢰도로 저장
   *   - 검색/가중치 계산 시: `memory_relation.confidence` 참조
   * - 각 relation 생성 시 계산된 confidence 값을 저장
   * 
   * 두 가지 관계를 생성:
   * 1. extracted_from (Episodic → Semantic): Episodic Memory에서 Semantic Memory로 추출된 관계
   * 2. supported_by (Semantic → Episodic): Semantic Memory가 Episodic Memory에 의해 지원되는 관계 (역방향)
   * 
   * 각 관계는 동일한 confidence 값을 가지며, 각 triple별로 독립적인 relation으로 저장됩니다.
   * 
   * PRD 3.4 관계 중복 방지:
   * - UNIQUE(source_id, target_id, relation_type) 제약 조건 활용
   * - 동일한 Episodic Memory와 Semantic Memory 간의 동일한 관계 타입은 중복 생성하지 않음
   * 
   * @param episodicMemoryId Episodic Memory ID
   * @param semanticMemoryId Semantic Memory ID
   * @param triple Triple
   * @param extractionInfo 추출 정보
   * @param confidence 계산된 Confidence (구조적 검증 기반, 0.0~1.0)
   */
  private async createEpisodicEdge(
    episodicMemoryId: string,
    semanticMemoryId: string,
    triple: Triple,
    extractionInfo: ExtractionInfo,
    confidence: number
  ): Promise<void> {
    // 관계 방향 검증 (PRD 3.2 참고)
    // 검증 실패 시 에러를 상위로 전파
    await this.validateRelationDirection(episodicMemoryId, semanticMemoryId, 'extracted_from');
    await this.validateRelationDirection(semanticMemoryId, episodicMemoryId, 'supported_by');
    
    try {
      // extracted_from 관계 생성 (Episodic → Semantic)
      // Note: 'extracted_from'와 'supported_by'는 relation_type_registry에 등록되어 있지만
      // RelationType 타입에는 아직 포함되지 않았으므로 타입 단언 사용
      // confidence는 memory_relation.confidence 필드에 저장됨
      await this.relationGraph.addRelation(
        episodicMemoryId,
        semanticMemoryId,
        'extracted_from' as any, // TODO: RelationType 타입 확장 필요
        {
          confidence, // memory_relation.confidence 필드에 저장
          metadata: {
            method: 'llm',
            triple: {
              subject: triple.subject,
              predicate: triple.predicate,
              object: triple.object
            },
            // 각 triple별 독립적인 metadata 저장
            failureReason: extractionInfo.failureReason,
            steps: extractionInfo.steps
          },
          allowCyclic: true // Episodic-Semantic 간 양방향 관계 허용
        }
      );

      // supported_by 관계 생성 (Semantic → Episodic, 역방향)
      // 동일한 confidence 값을 저장
      await this.relationGraph.addRelation(
        semanticMemoryId,
        episodicMemoryId,
        'supported_by' as any, // TODO: RelationType 타입 확장 필요
        {
          confidence, // memory_relation.confidence 필드에 저장
          metadata: {
            method: 'llm',
            triple: {
              subject: triple.subject,
              predicate: triple.predicate,
              object: triple.object
            },
            // 각 triple별 독립적인 metadata 저장
            failureReason: extractionInfo.failureReason,
            steps: extractionInfo.steps
          },
          allowCyclic: true // Episodic-Semantic 간 양방향 관계 허용
        }
      );
    } catch (error) {
      // UNIQUE 제약 조건 위반은 무시 (이미 관계가 존재하는 경우)
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        logger.debug('SemanticMemoryUpdateService: 관계 중복 (무시)', {
          episodicMemoryId,
          semanticMemoryId,
          relationType: 'extracted_from/supported_by'
        });
        return;
      }
      
      logger.error('SemanticMemoryUpdateService: 관계 생성 실패', {
        error: error instanceof Error ? error.message : String(error),
        episodicMemoryId,
        semanticMemoryId,
        confidence
      });
      // 기타 관계 생성 실패는 무시 (Semantic Memory 생성에는 영향 없음)
    }
  }
}

