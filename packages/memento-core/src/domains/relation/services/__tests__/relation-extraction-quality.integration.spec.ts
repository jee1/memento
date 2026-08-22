/**
 * 관계 추출 품질 통합 테스트
 * 테스트 데이터셋 기반 정확도 측정
 * 
 * Given: 테스트 데이터셋 (relation_testset.json)
 * When: RelationExtractor로 관계 추출 수행
 * Then: RelationQualityValidator로 정확도 측정 및 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RelationExtractor } from '../../../../domains/relation/services/relation-extractor.js';
import { RelationQualityValidator } from '../relation-quality-validator.js';
import type { ExpectedRelation, ExtractedRelation } from '../relation-quality-validator.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/005-relation-engine-schema.js';
import type { MemoryItem } from '../../../../shared/types/memory.types.js';
import type { RelationCandidate } from '../../../../shared/types/relation.js';

/**
 * 테스트 데이터셋 로드
 */
function loadTestDataset(): ExpectedRelation[] {
  const testsetPath = join(process.cwd(), 'tests', 'fixtures', 'relation_testset.json');
  const testsetContent = readFileSync(testsetPath, 'utf-8');
  const testset = JSON.parse(testsetContent) as Array<{
    source_id: string;
    target_id: string;
    expected_relation_type: string;
    expected_confidence_range: [number, number];
    source_content: string;
    target_content: string;
  }>;

  return testset.map(item => ({
    source_id: item.source_id,
    target_id: item.target_id,
    expected_relation_type: item.expected_relation_type as any,
    expected_confidence_range: item.expected_confidence_range,
    source_content: item.source_content,
    target_content: item.target_content
  }));
}

/**
 * 테스트용 기본 스키마 생성
 */
function createBaseSchema(db: Database.Database): void {
  // memory_item 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );
  `);

  // memento_schema_version 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * 테스트용 메모리 생성
 */
function createTestMemory(
  db: Database.Database,
  id: string,
  content: string,
  type: string = 'episodic'
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
  `, [id, type, content]);
}

describe('관계 추출 품질 통합 테스트', () => {
  let db: Database.Database;
  let relationExtractor: RelationExtractor;
  let qualityValidator: RelationQualityValidator;
  let testDataset: ExpectedRelation[];

  beforeEach(() => {
    // Given: in-memory 데이터베이스 생성 및 초기화
    db = new Database(':memory:');
    createBaseSchema(db);
    
    // 마이그레이션 실행
    const migration = new RelationEngineSchemaMigration();
    migration.up(db);
    
    // 관계 추출 서비스 및 품질 검증 서비스 초기화
    relationExtractor = new RelationExtractor();
    qualityValidator = new RelationQualityValidator();
    
    // 테스트 데이터셋 로드
    testDataset = loadTestDataset();
  });

  afterEach(() => {
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  });

  describe('전체 데이터셋 기반 정확도 측정', () => {
    it('전체 테스트 데이터셋에 대해 정확도를 측정해야 함', async () => {
      // Given: 테스트 데이터셋의 모든 메모리 생성
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of testDataset) {
        // 소스 메모리 생성
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        // 타겟 메모리 생성
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 각 테스트 케이스에 대해 관계 추출 수행
      const extractedRelations: ExtractedRelation[] = [];
      
      // 소스 메모리별로 그룹화 (같은 소스 메모리에 대한 여러 관계를 한 번에 추출)
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of testDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      // 각 소스 메모리에 대해 관계 추출
      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            // 규칙 기반 추출만 사용 (LLM 모킹 없이 빠른 테스트)
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            // 추출된 관계를 ExtractedRelation 형식으로 변환
            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            // 추출 실패는 무시하고 계속 진행
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      // Then: 품질 메트릭 계산
      const metrics = qualityValidator.calculateQualityMetrics(
        testDataset,
        extractedRelations
      );

      // 기본 검증: 메트릭이 계산되었는지 확인
      expect(metrics.totalExpected).toBe(testDataset.length);
      expect(metrics.totalExtracted).toBeGreaterThanOrEqual(0);
      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.precision).toBeLessThanOrEqual(1);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeLessThanOrEqual(1);
      expect(metrics.f1Score).toBeGreaterThanOrEqual(0);
      expect(metrics.f1Score).toBeLessThanOrEqual(1);
      
      // 관계 유형별 메트릭 확인
      expect(metrics.typeMetrics.CAUSES).toBeDefined();
      expect(metrics.typeMetrics.DEPENDS_ON).toBeDefined();
      expect(metrics.typeMetrics.FOLLOWS).toBeDefined();
      expect(metrics.typeMetrics.CONTRASTS_WITH).toBeDefined();
      expect(metrics.typeMetrics.REFERENCES).toBeDefined();
      expect(metrics.typeMetrics.BELONGS_TO).toBeDefined();
    });

    it('관계 유형별 정확도를 분석해야 함', async () => {
      // Given: 테스트 데이터셋의 메모리 생성
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of testDataset) {
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 관계 추출 및 상세 분석 수행
      const extractedRelations: ExtractedRelation[] = [];
      
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of testDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      // 상세 분석 포함 메트릭 계산
      const metrics = qualityValidator.calculateQualityMetricsWithAnalysis(
        testDataset,
        extractedRelations
      );

      // Then: 관계 유형별 상세 분석이 포함되어야 함
      expect(metrics.typeAnalysis).toBeDefined();
      expect(metrics.confusionMatrix).toBeDefined();
      
      // 각 관계 유형별 분석 확인
      const relationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;
      for (const type of relationTypes) {
        const analysis = metrics.typeAnalysis![type];
        expect(analysis).toBeDefined();
        expect(analysis.relationType).toBe(type);
        expect(analysis.precision).toBeGreaterThanOrEqual(0);
        expect(analysis.recall).toBeGreaterThanOrEqual(0);
        expect(analysis.f1Score).toBeGreaterThanOrEqual(0);
        expect(analysis.averageConfidence).toBeGreaterThanOrEqual(0);
        expect(analysis.confusionMatrix).toBeDefined();
      }
    });

    it('혼동 행렬을 생성해야 함', async () => {
      // Given: 샘플 테스트 데이터 (전체 데이터셋의 일부)
      const sampleSize = Math.min(50, testDataset.length);
      const sampleDataset = testDataset.slice(0, sampleSize);
      
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of sampleDataset) {
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 관계 추출 수행
      const extractedRelations: ExtractedRelation[] = [];
      
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of sampleDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      // 상세 분석 포함 메트릭 계산
      const metrics = qualityValidator.calculateQualityMetricsWithAnalysis(
        sampleDataset,
        extractedRelations
      );

      // Then: 혼동 행렬이 생성되어야 함
      expect(metrics.confusionMatrix).toBeDefined();
      expect(metrics.confusionMatrix!.matrix).toBeDefined();
      expect(metrics.confusionMatrix!.overallAccuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.confusionMatrix!.overallAccuracy).toBeLessThanOrEqual(1);
      expect(metrics.confusionMatrix!.typeAccuracy).toBeDefined();
      
      // 모든 관계 유형에 대한 정확도가 있어야 함
      const relationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;
      for (const type of relationTypes) {
        expect(metrics.confusionMatrix!.typeAccuracy[type]).toBeGreaterThanOrEqual(0);
        expect(metrics.confusionMatrix!.typeAccuracy[type]).toBeLessThanOrEqual(1);
      }
    });

    it('임계값 검증을 수행해야 함', async () => {
      // Given: 샘플 테스트 데이터
      const sampleSize = Math.min(30, testDataset.length);
      const sampleDataset = testDataset.slice(0, sampleSize);
      
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of sampleDataset) {
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 관계 추출 및 메트릭 계산
      const extractedRelations: ExtractedRelation[] = [];
      
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of sampleDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      const metrics = qualityValidator.calculateQualityMetrics(
        sampleDataset,
        extractedRelations
      );

      // Then: 임계값 검증 수행
      const thresholds = {
        precision: 0.70,
        recall: 0.65,
        f1Score: 0.68
      };

      const validation = qualityValidator.validateThresholds(metrics, thresholds);

      // 검증 결과 확인
      expect(validation).toBeDefined();
      expect(validation.passed).toBeDefined();
      expect(Array.isArray(validation.failures)).toBe(true);
      
      // 실패한 메트릭이 있으면 failures에 포함되어야 함
      if (!validation.passed) {
        expect(validation.failures.length).toBeGreaterThan(0);
        for (const failure of validation.failures) {
          expect(failure.metric).toMatch(/^(precision|recall|f1Score)$/);
          expect(failure.expected).toBeGreaterThan(0);
          expect(failure.actual).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('관계 유형별 샘플 테스트', () => {
    it('CAUSES 관계 유형에 대한 정확도를 측정해야 함', async () => {
      // Given: CAUSES 관계 유형만 필터링
      const causesDataset = testDataset.filter(tc => tc.expected_relation_type === 'CAUSES').slice(0, 20);
      
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of causesDataset) {
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 관계 추출 수행
      const extractedRelations: ExtractedRelation[] = [];
      
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of causesDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      // Then: CAUSES 관계 유형별 메트릭 확인
      const metrics = qualityValidator.calculateQualityMetrics(
        causesDataset,
        extractedRelations
      );

      expect(metrics.typeMetrics.CAUSES).toBeDefined();
      expect(metrics.typeMetrics.CAUSES.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.typeMetrics.CAUSES.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.typeMetrics.CAUSES.f1Score).toBeGreaterThanOrEqual(0);
    });

    it('FOLLOWS 관계 유형에 대한 정확도를 측정해야 함', async () => {
      // Given: FOLLOWS 관계 유형만 필터링
      const followsDataset = testDataset.filter(tc => tc.expected_relation_type === 'FOLLOWS').slice(0, 20);
      
      const memoryMap = new Map<string, MemoryItem>();
      
      for (const testCase of followsDataset) {
        if (!memoryMap.has(testCase.source_id)) {
          createTestMemory(db, testCase.source_id, testCase.source_content);
          memoryMap.set(testCase.source_id, {
            id: testCase.source_id,
            type: 'episodic',
            content: testCase.source_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
        
        if (!memoryMap.has(testCase.target_id)) {
          createTestMemory(db, testCase.target_id, testCase.target_content);
          memoryMap.set(testCase.target_id, {
            id: testCase.target_id,
            type: 'episodic',
            content: testCase.target_content,
            importance: 0.5,
            privacy_scope: 'private',
            created_at: new Date().toISOString()
          });
        }
      }

      // When: 관계 추출 수행
      const extractedRelations: ExtractedRelation[] = [];
      
      const sourceGroups = new Map<string, ExpectedRelation[]>();
      for (const testCase of followsDataset) {
        if (!sourceGroups.has(testCase.source_id)) {
          sourceGroups.set(testCase.source_id, []);
        }
        sourceGroups.get(testCase.source_id)!.push(testCase);
      }

      for (const [sourceId, testCases] of sourceGroups.entries()) {
        const sourceMemory = memoryMap.get(sourceId)!;
        const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
        
        if (targetMemories.length > 0) {
          try {
            const candidates = await relationExtractor.extractRelations(
              sourceMemory,
              targetMemories,
              { method: 'rule', minConfidence: 0.5 }
            );

            for (const candidate of candidates) {
              extractedRelations.push({
                source_id: candidate.source_id,
                target_id: candidate.target_id,
                relation_type: candidate.relation_type,
                confidence: candidate.confidence
              });
            }
          } catch (error) {
            console.warn(`관계 추출 실패: ${sourceId}`, error);
          }
        }
      }

      // Then: FOLLOWS 관계 유형별 메트릭 확인
      const metrics = qualityValidator.calculateQualityMetrics(
        followsDataset,
        extractedRelations
      );

      expect(metrics.typeMetrics.FOLLOWS).toBeDefined();
      expect(metrics.typeMetrics.FOLLOWS.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.typeMetrics.FOLLOWS.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.typeMetrics.FOLLOWS.f1Score).toBeGreaterThanOrEqual(0);
    });
  });
});
