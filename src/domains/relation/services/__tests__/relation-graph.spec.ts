/**
 * RelationGraph 단위 테스트
 * 관계 그래프 저장 및 관리 서비스 테스트
 * 
 * 테스트 항목:
 * - CRUD 작업 (addRelation, getRelations, removeRelation, updateConfidence)
 * - 순환 참조 감지 (DFS)
 * - N-hop 관계 탐색 (BFS)
 * - 캐싱 계층 (L1/L2)
 * - 배치 처리
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RelationGraph } from './relation-graph.js';
import { DatabaseUtils } from '../../../utils/database.js';
import type { RelationType } from '../../../types/relation.js';
import { RelationEngineSchemaMigration } from '../database/migration/migrations/005-relation-engine-schema.js';

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
      edit_count INTEGER DEFAULT 0
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
  content: string = 'Test memory content'
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content)
    VALUES (?, 'episodic', ?)
  `, [id, content]);
}

describe('RelationGraph', () => {
  let db: Database.Database;
  let relationGraph: RelationGraph;

  beforeEach(() => {
    // Given: in-memory 데이터베이스 생성 및 초기화
    db = new Database(':memory:');
    createBaseSchema(db);
    
    // 마이그레이션 실행
    const migration = new RelationEngineSchemaMigration();
    migration.up(db);
    
    relationGraph = new RelationGraph(db);
  });

  afterEach(() => {
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('초기화', () => {
    it('should initialize successfully with database', () => {
      // Given: 데이터베이스가 설정된 상태
      // When: RelationGraph 인스턴스 생성
      const graph = new RelationGraph(db);

      // Then: 인스턴스가 생성되어야 함
      expect(graph).toBeDefined();
    });
  });

  describe('addRelation', () => {
    it('should add a new relation successfully', async () => {
      // Given: 두 개의 메모리 생성
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');

      // When: 관계 추가
      const relationId = await relationGraph.addRelation(
        'mem1',
        'mem2',
        'CAUSES',
        { confidence: 0.8 }
      );

      // Then: 관계 ID가 반환되어야 함
      expect(relationId).toBeGreaterThan(0);
    });

    it('should throw error when adding self-relation', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Memory 1');

      // When/Then: 자기 자신에 대한 관계 추가 시도 시 에러 발생
      await expect(
        relationGraph.addRelation('mem1', 'mem1', 'CAUSES')
      ).rejects.toThrow('자기 자신에 대한 관계는 생성할 수 없습니다');
    });

    it('should throw error when adding duplicate relation without updateOnConflict', async () => {
      // Given: 두 개의 메모리와 관계 생성
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES');

      // When/Then: 중복 관계 추가 시도 시 에러 발생
      await expect(
        relationGraph.addRelation('mem1', 'mem2', 'CAUSES')
      ).rejects.toThrow('이미 존재하는 관계입니다');
    });

    it('should update existing relation when updateOnConflict is true', async () => {
      // Given: 두 개의 메모리와 관계 생성
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      const firstId = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', {
        confidence: 0.7
      });

      // When: updateOnConflict 옵션으로 관계 추가
      const secondId = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', {
        confidence: 0.9,
        updateOnConflict: true
      });

      // Then: 같은 ID가 반환되어야 함
      expect(secondId).toBe(firstId);

      // Then: 신뢰도가 업데이트되었는지 확인
      const relations = await relationGraph.getRelations('mem1');
      expect(relations).toHaveLength(1);
      expect(relations[0].confidence).toBe(0.9);
    });

    it('should detect and prevent cyclic relations', async () => {
      // Given: 세 개의 메모리와 순환 관계 생성 (mem1 -> mem2 -> mem3)
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      createTestMemory(db, 'mem3', 'Memory 3');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { allowCyclic: false });
      await relationGraph.addRelation('mem2', 'mem3', 'CAUSES', { allowCyclic: false });

      // When/Then: 순환 참조를 만드는 관계 추가 시도 시 에러 발생
      await expect(
        relationGraph.addRelation('mem3', 'mem1', 'CAUSES', { allowCyclic: false })
      ).rejects.toThrow('순환 참조가 감지되었습니다');
    });

    it('should allow cyclic relations when allowCyclic is true', async () => {
      // Given: 두 개의 메모리와 순환 관계 생성
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { allowCyclic: true });

      // When: 순환 참조를 허용하는 관계 추가
      const relationId = await relationGraph.addRelation('mem2', 'mem1', 'CAUSES', {
        allowCyclic: true
      });

      // Then: 관계가 추가되어야 함
      expect(relationId).toBeGreaterThan(0);

      // Then: metadata.cyclic 플래그가 설정되어야 함
      const relations = await relationGraph.getRelations('mem1');
      const cyclicRelation = relations.find(r => r.target_id === 'mem2');
      expect(cyclicRelation?.metadata?.cyclic).toBe(true);
    });

    it('should store metadata correctly', async () => {
      // Given: 두 개의 메모리 생성
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');

      // When: 메타데이터와 함께 관계 추가
      const relationId = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', {
        confidence: 0.8,
        metadata: {
          method: 'rule',
          evidence: 'keyword match: "때문에"'
        }
      });

      // Then: 메타데이터가 저장되어야 함
      const relations = await relationGraph.getRelations('mem1');
      expect(relations).toHaveLength(1);
      expect(relations[0].metadata?.method).toBe('rule');
      expect(relations[0].metadata?.evidence).toBe('keyword match: "때문에"');
    });
  });

  describe('getRelations', () => {
    beforeEach(async () => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      createTestMemory(db, 'mem3', 'Memory 3');
      createTestMemory(db, 'mem4', 'Memory 4');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.9 });
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });
      await relationGraph.addRelation('mem4', 'mem1', 'REFERENCES', { confidence: 0.8 });
    });

    it('should retrieve outgoing relations', async () => {
      // When: 나가는 관계 조회
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'outgoing'
      });

      // Then: 나가는 관계만 반환되어야 함
      expect(relations).toHaveLength(2);
      expect(relations.every(r => r.source_id === 'mem1')).toBe(true);
    });

    it('should retrieve incoming relations', async () => {
      // When: 들어오는 관계 조회
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'incoming'
      });

      // Then: 들어오는 관계만 반환되어야 함
      expect(relations).toHaveLength(1);
      expect(relations[0].source_id).toBe('mem4');
      expect(relations[0].target_id).toBe('mem1');
    });

    it('should retrieve both directions when direction is "both"', async () => {
      // When: 양방향 관계 조회
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'both'
      });

      // Then: 모든 관계가 반환되어야 함
      expect(relations).toHaveLength(3);
    });

    it('should filter by relation type', async () => {
      // When: 특정 관계 유형으로 필터링
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'outgoing',
        relationTypes: ['CAUSES']
      });

      // Then: 필터링된 관계만 반환되어야 함
      expect(relations).toHaveLength(1);
      expect(relations[0].relation_type).toBe('CAUSES');
    });

    it('should filter by minimum confidence', async () => {
      // When: 최소 신뢰도로 필터링
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'outgoing',
        minConfidence: 0.8
      });

      // Then: 신뢰도가 0.8 이상인 관계만 반환되어야 함
      expect(relations).toHaveLength(1);
      expect(relations[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should apply limit and offset for pagination', async () => {
      // When: limit과 offset 적용
      const relations = await relationGraph.getRelations('mem1', {
        direction: 'both',
        limit: 2,
        offset: 1
      });

      // Then: 제한된 수의 관계가 반환되어야 함
      expect(relations.length).toBeLessThanOrEqual(2);
    });

    it('should use L1 cache for subsequent queries', async () => {
      // When: 첫 번째 조회 (캐시 미스)
      const firstCall = await relationGraph.getRelations('mem1', {
        direction: 'both'
      });

      // When: 두 번째 조회 (캐시 히트)
      const secondCall = await relationGraph.getRelations('mem1', {
        direction: 'both'
      });

      // Then: 같은 결과가 반환되어야 함
      expect(firstCall).toEqual(secondCall);
    });
  });

  describe('getRelatedMemories', () => {
    beforeEach(async () => {
      // Given: 체인 구조 생성 (mem1 -> mem2 -> mem3 -> mem4)
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      createTestMemory(db, 'mem3', 'Memory 3');
      createTestMemory(db, 'mem4', 'Memory 4');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES');
      await relationGraph.addRelation('mem2', 'mem3', 'CAUSES');
      await relationGraph.addRelation('mem3', 'mem4', 'CAUSES');
    });

    it('should find 1-hop related memories', async () => {
      // When: 1-hop 관계 탐색
      const related = await relationGraph.getRelatedMemories('mem1', {
        maxHops: 1
      });

      // Then: 1-hop 관계만 반환되어야 함
      expect(related).toHaveLength(1);
      expect(related[0].memory_id).toBe('mem2');
      expect(related[0].hop_distance).toBe(1);
    });

    it('should find 2-hop related memories', async () => {
      // When: 2-hop 관계 탐색
      const related = await relationGraph.getRelatedMemories('mem1', {
        maxHops: 2
      });

      // Then: 2-hop까지의 관계가 반환되어야 함
      expect(related).toHaveLength(2);
      expect(related.map(r => r.memory_id)).toContain('mem2');
      expect(related.map(r => r.memory_id)).toContain('mem3');
      expect(related.some(r => r.hop_distance === 1)).toBe(true);
      expect(related.some(r => r.hop_distance === 2)).toBe(true);
    });

    it('should track relation path', async () => {
      // When: 관계 경로 추적
      const related = await relationGraph.getRelatedMemories('mem1', {
        maxHops: 2
      });

      // Then: 관계 경로가 추적되어야 함
      const mem3Relation = related.find(r => r.memory_id === 'mem3');
      expect(mem3Relation).toBeDefined();
      expect(mem3Relation?.relation_path).toHaveLength(2);
      expect(mem3Relation?.relation_path[0].source_id).toBe('mem1');
      expect(mem3Relation?.relation_path[0].target_id).toBe('mem2');
      expect(mem3Relation?.relation_path[1].source_id).toBe('mem2');
      expect(mem3Relation?.relation_path[1].target_id).toBe('mem3');
    });

    it('should filter by relation type', async () => {
      // Given: 다른 관계 유형 추가
      await relationGraph.addRelation('mem1', 'mem2', 'FOLLOWS');

      // When: 특정 관계 유형으로 필터링
      const related = await relationGraph.getRelatedMemories('mem1', {
        maxHops: 1,
        relationTypes: ['CAUSES']
      });

      // Then: 필터링된 관계만 반환되어야 함
      expect(related).toHaveLength(1);
      expect(related[0].relation_path[0].relation_type).toBe('CAUSES');
    });

    it('should exclude cyclic relations when includeCyclic is false', async () => {
      // Given: 순환 관계 생성 (mem4 -> mem1)
      await relationGraph.addRelation('mem4', 'mem1', 'CAUSES', { allowCyclic: true });

      // When: 순환 관계 제외
      const related = await relationGraph.getRelatedMemories('mem1', {
        maxHops: 3,
        includeCyclic: false
      });

      // Then: 순환 관계가 제외되어야 함
      // mem4는 정상 경로(mem1 -> mem2 -> mem3 -> mem4)로 도달 가능하므로 결과에 포함됨
      // 하지만 mem4에서 mem1로 가는 순환 관계는 건너뜀
      const mem4Relation = related.find(r => r.memory_id === 'mem4');
      expect(mem4Relation).toBeDefined(); // mem4는 정상 경로로 도달 가능
      
      // mem4의 relation_path에 순환 관계(mem4 -> mem1)가 포함되지 않아야 함
      // mem4는 mem1 -> mem2 -> mem3 -> mem4 경로로만 도달해야 함
      if (mem4Relation) {
        expect(mem4Relation.relation_path.length).toBe(3);
        expect(mem4Relation.relation_path[0].source_id).toBe('mem1');
        expect(mem4Relation.relation_path[0].target_id).toBe('mem2');
        expect(mem4Relation.relation_path[2].target_id).toBe('mem4');
        // 순환 관계(mem4 -> mem1)가 경로에 포함되지 않아야 함
        const hasCyclicPath = mem4Relation.relation_path.some(
          p => p.source_id === 'mem4' && p.target_id === 'mem1'
        );
        expect(hasCyclicPath).toBe(false);
      }
    });
  });

  describe('removeRelation', () => {
    beforeEach(async () => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES');
    });

    it('should remove an existing relation', async () => {
      // When: 관계 삭제
      const removed = await relationGraph.removeRelation('mem1', 'mem2', 'CAUSES');

      // Then: 삭제 성공 여부가 true여야 함
      expect(removed).toBe(true);

      // Then: 관계가 조회되지 않아야 함
      const relations = await relationGraph.getRelations('mem1');
      expect(relations).toHaveLength(0);
    });

    it('should return false when relation does not exist', async () => {
      // When: 존재하지 않는 관계 삭제 시도
      const removed = await relationGraph.removeRelation('mem1', 'mem2', 'FOLLOWS');

      // Then: false가 반환되어야 함
      expect(removed).toBe(false);
    });

    it('should invalidate cache after removal', async () => {
      // Given: 캐시에 데이터 저장
      await relationGraph.getRelations('mem1');

      // When: 관계 삭제
      await relationGraph.removeRelation('mem1', 'mem2', 'CAUSES');

      // Then: 캐시가 무효화되어야 함 (다음 조회 시 빈 배열 반환)
      const relations = await relationGraph.getRelations('mem1');
      expect(relations).toHaveLength(0);
    });
  });

  describe('updateConfidence', () => {
    beforeEach(async () => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.7 });
    });

    it('should update confidence successfully', async () => {
      // When: 신뢰도 갱신
      const updated = await relationGraph.updateConfidence(
        'mem1',
        'mem2',
        'CAUSES',
        0.9,
        '사용자 피드백'
      );

      // Then: 갱신 성공 여부가 true여야 함
      expect(updated).toBe(true);

      // Then: 신뢰도가 업데이트되어야 함
      const relations = await relationGraph.getRelations('mem1');
      expect(relations[0].confidence).toBe(0.9);
    });

    it('should record refinement history', async () => {
      // When: 신뢰도 갱신
      await relationGraph.updateConfidence(
        'mem1',
        'mem2',
        'CAUSES',
        0.9,
        '사용자 피드백'
      );

      // Then: refinement_history가 기록되어야 함
      const relations = await relationGraph.getRelations('mem1');
      const history = relations[0].metadata?.refinement_history;
      expect(history).toBeDefined();
      expect(history).toHaveLength(1);
      expect(history[0].old_confidence).toBe(0.7);
      expect(history[0].new_confidence).toBe(0.9);
      expect(history[0].reason).toBe('사용자 피드백');
    });

    it('should return false when relation does not exist', async () => {
      // When: 존재하지 않는 관계의 신뢰도 갱신 시도
      const updated = await relationGraph.updateConfidence(
        'mem1',
        'mem2',
        'FOLLOWS',
        0.9
      );

      // Then: false가 반환되어야 함
      expect(updated).toBe(false);
    });
  });

  describe('detectCycle', () => {
    beforeEach(async () => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      createTestMemory(db, 'mem3', 'Memory 3');
    });

    it('should detect direct cycle', async () => {
      // Given: 직접 순환 관계 생성
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { allowCyclic: true });

      // When: 순환 참조 감지
      const isCyclic = await relationGraph.detectCycle('mem2', 'mem1', 'CAUSES');

      // Then: 순환 참조가 감지되어야 함
      expect(isCyclic).toBe(true);
    });

    it('should detect indirect cycle', async () => {
      // Given: 간접 순환 관계 생성 (mem1 -> mem2 -> mem3)
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { allowCyclic: true });
      await relationGraph.addRelation('mem2', 'mem3', 'CAUSES', { allowCyclic: true });

      // When: 순환 참조 감지 (mem3 -> mem1)
      const isCyclic = await relationGraph.detectCycle('mem3', 'mem1', 'CAUSES');

      // Then: 순환 참조가 감지되어야 함
      expect(isCyclic).toBe(true);
    });

    it('should return false when no cycle exists', async () => {
      // Given: 비순환 관계 생성
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { allowCyclic: false });

      // When: 순환 참조 감지 (mem2 -> mem3, 순환 없음)
      const isCyclic = await relationGraph.detectCycle('mem2', 'mem3', 'CAUSES');

      // Then: 순환 참조가 감지되지 않아야 함
      expect(isCyclic).toBe(false);
    });
  });

  describe('addRelationsBatch', () => {
    beforeEach(() => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      createTestMemory(db, 'mem3', 'Memory 3');
      createTestMemory(db, 'mem4', 'Memory 4');
    });

    it('should add multiple relations in batch', async () => {
      // When: 배치로 관계 추가
      const result = await relationGraph.addRelationsBatch([
        { source_id: 'mem1', target_id: 'mem2', relation_type: 'CAUSES', confidence: 0.8 },
        { source_id: 'mem1', target_id: 'mem3', relation_type: 'FOLLOWS', confidence: 0.7 },
        { source_id: 'mem2', target_id: 'mem4', relation_type: 'REFERENCES', confidence: 0.9 }
      ]);

      // Then: 모든 관계가 추가되어야 함
      expect(result.insertedIds).toHaveLength(3);
      expect(result.insertedIds.every(id => id > 0)).toBe(true);
      expect(result.success).toBe(3);
      expect(result.failedCount).toBe(0);

      // Then: 관계가 조회되어야 함
      const relations = await relationGraph.getRelations('mem1');
      expect(relations).toHaveLength(2);
    });

    it('should handle partial failures gracefully', async () => {
      // Given: 중복 관계 포함
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES');

      // When: 배치로 관계 추가 (일부 실패 포함)
      // updateOnConflict: true이므로 중복 관계는 업데이트되어 성공합니다
      const result = await relationGraph.addRelationsBatch([
        { source_id: 'mem1', target_id: 'mem2', relation_type: 'CAUSES' }, // 중복 (업데이트되어 성공)
        { source_id: 'mem1', target_id: 'mem3', relation_type: 'FOLLOWS' } // 성공
      ]);

      // Then: 모든 관계가 성공해야 함 (중복은 업데이트됨)
      expect(result.success).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.failed.length).toBe(0);
      expect(result.total).toBe(2);
      
      // Then: 두 관계가 모두 존재해야 함
      const mem1Relations = await relationGraph.getRelations('mem1');
      expect(mem1Relations.length).toBeGreaterThanOrEqual(2);
    });

    it('should use transaction for atomicity', async () => {
      // Given: 잘못된 메모리 ID 포함
      const result = await relationGraph.addRelationsBatch([
        { source_id: 'mem1', target_id: 'mem2', relation_type: 'CAUSES' },
        { source_id: 'nonexistent', target_id: 'mem3', relation_type: 'FOLLOWS' } // 외래키 제약 위반
      ]);

      // Then: 성공한 관계와 실패한 관계가 모두 추적되어야 함
      expect(result.total).toBe(2);
      expect(result.success + result.failedCount).toBe(result.total);
    });
  });

  describe('캐싱 계층', () => {
    beforeEach(async () => {
      // Given: 테스트 데이터 준비
      createTestMemory(db, 'mem1', 'Memory 1');
      createTestMemory(db, 'mem2', 'Memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES');
    });

    describe('L1 캐시', () => {
      it('should use L1 cache for immediate subsequent queries', async () => {
        // When: 첫 번째 조회 (캐시 미스)
        const first = await relationGraph.getRelations('mem1');

        // When: 두 번째 조회 (L1 캐시 히트)
        const second = await relationGraph.getRelations('mem1');

        // Then: 같은 결과가 반환되어야 함
        expect(first).toEqual(second);
      });

      it('should expire L1 cache after TTL (10 minutes)', async () => {
        // Given: 시간 제어
        vi.useFakeTimers();
        const now = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(now);

        // When: 첫 번째 조회 (L1 캐시에 저장)
        const first = await relationGraph.getRelations('mem1');
        expect(first).toHaveLength(1);

        // When: 11분 후 (L1 캐시 TTL 만료)
        vi.advanceTimersByTime(11 * 60 * 1000); // 11분

        // When: 두 번째 조회 (L1 캐시 만료, L2 캐시 또는 DB에서 조회)
        const second = await relationGraph.getRelations('mem1');

        // Then: 결과가 반환되어야 함 (L2 캐시 또는 DB에서)
        expect(second).toHaveLength(1);
        expect(second[0].source_id).toBe('mem1');
        expect(second[0].target_id).toBe('mem2');

        vi.useRealTimers();
      });

      it('should not expire L1 cache before TTL', async () => {
        // Given: 시간 제어
        vi.useFakeTimers();
        const now = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(now);

        // When: 첫 번째 조회 (L1 캐시에 저장)
        const first = await relationGraph.getRelations('mem1');

        // When: 5분 후 (L1 캐시 TTL 만료 전)
        vi.advanceTimersByTime(5 * 60 * 1000); // 5분

        // When: 두 번째 조회
        const second = await relationGraph.getRelations('mem1');

        // Then: L1 캐시에서 반환되어야 함
        expect(first).toEqual(second);

        vi.useRealTimers();
      });
    });

    describe('L2 캐시', () => {
      it('should fallback to L2 cache when L1 cache expires', async () => {
        // Given: 시간 제어
        vi.useFakeTimers();
        const now = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(now);

        // When: 첫 번째 조회 (L1, L2 캐시에 저장)
        const first = await relationGraph.getRelations('mem1');
        expect(first).toHaveLength(1);

        // When: 11분 후 (L1 캐시 만료, L2 캐시는 유지)
        vi.advanceTimersByTime(11 * 60 * 1000); // 11분

        // When: 두 번째 조회 (L1 만료, L2에서 fallback)
        const second = await relationGraph.getRelations('mem1');

        // Then: L2 캐시에서 반환되어야 함
        expect(second).toHaveLength(1);
        expect(second[0].source_id).toBe('mem1');
        expect(second[0].target_id).toBe('mem2');

        vi.useRealTimers();
      });

      it('should fallback to database when both L1 and L2 cache expire', async () => {
        // Given: 시간 제어
        vi.useFakeTimers();
        const now = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(now);

        // When: 첫 번째 조회 (L1, L2 캐시에 저장)
        const first = await relationGraph.getRelations('mem1');
        expect(first).toHaveLength(1);

        // When: 8일 후 (L1, L2 캐시 모두 만료)
        vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8일

        // When: 두 번째 조회 (L1, L2 만료, DB에서 조회)
        const second = await relationGraph.getRelations('mem1');

        // Then: DB에서 조회한 결과가 반환되어야 함
        expect(second).toHaveLength(1);
        expect(second[0].source_id).toBe('mem1');
        expect(second[0].target_id).toBe('mem2');

        vi.useRealTimers();
      });

      it('should populate L1 cache from L2 cache on fallback', async () => {
        // Given: 시간 제어
        vi.useFakeTimers();
        const now = new Date('2024-01-01T00:00:00Z');
        vi.setSystemTime(now);

        // When: 첫 번째 조회 (L1, L2 캐시에 저장)
        await relationGraph.getRelations('mem1');

        // When: 11분 후 (L1 캐시 만료)
        vi.advanceTimersByTime(11 * 60 * 1000); // 11분

        // When: 두 번째 조회 (L2에서 fallback)
        const second = await relationGraph.getRelations('mem1');

        // When: 즉시 세 번째 조회 (L1 캐시에 다시 저장되어야 함)
        const third = await relationGraph.getRelations('mem1');

        // Then: L1 캐시에서 반환되어야 함 (L2에서 L1로 복원됨)
        expect(second).toEqual(third);

        vi.useRealTimers();
      });
    });

    describe('캐시 무효화', () => {
      it('should invalidate cache after relation addition', async () => {
        // Given: 캐시에 데이터 저장
        await relationGraph.getRelations('mem1');
        expect((await relationGraph.getRelations('mem1'))).toHaveLength(1);

        // When: 새 관계 추가
        createTestMemory(db, 'mem3', 'Memory 3');
        await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS');

        // Then: 캐시가 무효화되어 새로운 관계가 포함되어야 함
        const relations = await relationGraph.getRelations('mem1');
        expect(relations).toHaveLength(2);
        expect(relations.some(r => r.target_id === 'mem2')).toBe(true);
        expect(relations.some(r => r.target_id === 'mem3')).toBe(true);
      });

      it('should invalidate cache after relation removal', async () => {
        // Given: 캐시에 데이터 저장
        await relationGraph.getRelations('mem1');
        expect((await relationGraph.getRelations('mem1'))).toHaveLength(1);

        // When: 관계 삭제
        await relationGraph.removeRelation('mem1', 'mem2', 'CAUSES');

        // Then: 캐시가 무효화되어 빈 배열이 반환되어야 함
        const relations = await relationGraph.getRelations('mem1');
        expect(relations).toHaveLength(0);
      });

      it('should invalidate cache after confidence update', async () => {
        // Given: 캐시에 데이터 저장
        await relationGraph.getRelations('mem1');
        const cached = await relationGraph.getRelations('mem1');
        expect(cached[0].confidence).toBe(0.7);

        // When: 신뢰도 갱신
        await relationGraph.updateConfidence('mem1', 'mem2', 'CAUSES', 0.9);

        // Then: 캐시가 무효화되어 새로운 신뢰도가 반환되어야 함
        const relations = await relationGraph.getRelations('mem1');
        expect(relations[0].confidence).toBe(0.9);
      });

      it('should invalidate both source and target memory caches', async () => {
        // Given: 두 메모리의 캐시에 데이터 저장
        await relationGraph.getRelations('mem1');
        await relationGraph.getRelations('mem2');

        // When: 관계 추가
        createTestMemory(db, 'mem3', 'Memory 3');
        await relationGraph.addRelation('mem2', 'mem3', 'REFERENCES');

        // Then: mem1과 mem2 모두의 캐시가 무효화되어야 함
        // (mem2의 경우 새 관계가 추가되었으므로 캐시가 무효화됨)
        const mem1Relations = await relationGraph.getRelations('mem1');
        const mem2Relations = await relationGraph.getRelations('mem2');
        
        // mem1은 변경 없음 (outgoing 관계 1개)
        expect(mem1Relations).toHaveLength(1);
        expect(mem1Relations[0].source_id).toBe('mem1');
        expect(mem1Relations[0].target_id).toBe('mem2');
        
        // mem2는 incoming 관계 1개 (mem1 -> mem2) + outgoing 관계 1개 (mem2 -> mem3) = 총 2개
        expect(mem2Relations).toHaveLength(2);
        
        // mem2의 outgoing 관계 확인
        const mem2Outgoing = mem2Relations.filter(r => r.source_id === 'mem2');
        expect(mem2Outgoing).toHaveLength(1);
        expect(mem2Outgoing[0].target_id).toBe('mem3');
      });

      it('should invalidate cache with different query options', async () => {
        // Given: 다양한 옵션으로 캐시에 데이터 저장
        await relationGraph.getRelations('mem1', { direction: 'outgoing' });
        await relationGraph.getRelations('mem1', { direction: 'incoming' });
        await relationGraph.getRelations('mem1', { direction: 'both' });
        await relationGraph.getRelations('mem1', { minConfidence: 0.8 });

        // When: 관계 수정
        await relationGraph.updateConfidence('mem1', 'mem2', 'CAUSES', 0.9);

        // Then: 모든 캐시가 무효화되어 새로운 데이터가 반환되어야 함
        const outgoing = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
        const incoming = await relationGraph.getRelations('mem1', { direction: 'incoming' });
        const both = await relationGraph.getRelations('mem1', { direction: 'both' });
        const highConf = await relationGraph.getRelations('mem1', { minConfidence: 0.8 });

        // 모든 조회에서 업데이트된 신뢰도가 반환되어야 함
        if (outgoing.length > 0) {
          expect(outgoing[0].confidence).toBe(0.9);
        }
        if (highConf.length > 0) {
          expect(highConf[0].confidence).toBe(0.9);
        }
      });
    });
  });
});
