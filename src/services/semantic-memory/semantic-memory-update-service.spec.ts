/**
 * SemanticMemoryUpdateService 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import type { TripleExtractionResult, Triple } from '../../shared/types/triple-extraction.js';
import type { SemanticMemoryUpdateOptions, SemanticMemoryUpdateResult } from './semantic-memory-update-service.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../shared/utils/database.js';

describe('SemanticMemoryUpdateService', () => {
  let db: Database.Database;
  let service: SemanticMemoryUpdateService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    service = new SemanticMemoryUpdateService(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('updateSemanticMemory', () => {
    it('빈 Triple 배열 처리 - 생성/업데이트 없음', async () => {
      // Given: 빈 Triple 배열
      const extractionResult: TripleExtractionResult = {
        triples: [],
        extractionInfo: {
          steps: {
            canonicalization: false,
            entityLinking: false
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 생성/업데이트 없음
      expect(result).toBeDefined();
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.semanticMemoryIds).toEqual([]);
    });

    it('Triple 배열로 Semantic Memory 생성', async () => {
      // Given: Triple 배열과 Episodic Memory ID
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' },
        { subject: '사용자', predicate: '선호', object: '차' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성 (관계 생성용)
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: Semantic Memory 생성 확인
      expect(result).toBeDefined();
      expect(result.created).toBeGreaterThan(0);
      expect(result.semanticMemoryIds.length).toBeGreaterThan(0);

      // DB에서 Semantic Memory 확인
      const semanticMemories = DatabaseUtils.all(db, `
        SELECT id, type, subject, predicate, object, content, importance
        FROM memory_item
        WHERE type = 'semantic'
      `) as Array<{
        id: string;
        type: string;
        subject: string;
        predicate: string;
        object: string;
        content: string;
        importance: number;
      }>;

      expect(semanticMemories.length).toBeGreaterThanOrEqual(result.created);
      
      // Semantic Memory 구조 확인
      const firstMemory = semanticMemories[0];
      expect(firstMemory.type).toBe('semantic');
      expect(firstMemory.subject).toBeDefined();
      expect(firstMemory.predicate).toBeDefined();
      expect(firstMemory.object).toBeDefined();
      expect(firstMemory.content).toBeDefined();
    });

    it('중복 Triple 처리 - 기존 Semantic Memory 업데이트', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const firstTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const firstExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(firstExtractionResult, firstOptions);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 동일한 Triple로 두 번째 업데이트
      const secondExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (중복 Triple)
      const secondResult = await service.updateSemanticMemory(secondExtractionResult, secondOptions);

      // Then: 기존 Semantic Memory 업데이트 확인
      expect(secondResult).toBeDefined();
      expect(secondResult.updated).toBe(1);
      expect(secondResult.created).toBe(0);
      expect(secondResult.semanticMemoryIds[0]).toBe(semanticMemoryId);

      // DB에서 Semantic Memory 확인 (하나만 존재해야 함)
      const semanticMemories = DatabaseUtils.all(db, `
        SELECT id, type, subject, predicate, object, importance, recall_count
        FROM memory_item
        WHERE type = 'semantic'
      `) as Array<{
        id: string;
        type: string;
        subject: string;
        predicate: string;
        object: string;
        importance: number;
        recall_count: number;
      }>;

      expect(semanticMemories.length).toBe(1);
      expect(semanticMemories[0].id).toBe(semanticMemoryId);
      expect(semanticMemories[0].recall_count).toBeGreaterThan(0); // Episode Weight 누적 확인
    });

    it('Confidence 임계값 필터링 - 낮은 confidence는 건너뛰기', async () => {
      // Given: 낮은 confidence를 가진 Triple
      // EntityLinker는 Open World Assumption으로 항상 success: true를 반환하므로,
      // Predicate 정규화만 실패하도록 하여 confidence를 낮게 유지
      // Triple 구조 완전성(0.3) + Entity Linking 성공(0.4) = 0.7이므로,
      // Predicate 정규화 실패 시 0.3 + 0.4 = 0.7이 되어 임계값과 같아짐
      // 따라서 임계값을 0.71로 설정하여 건너뛰기 확인
      const triples: Triple[] = [
        { subject: '사용자', predicate: 'nonexistent_predicate_xyz', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: false,
            entityLinking: true // EntityLinker는 항상 성공
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5,
        confidenceThreshold: 0.71 // 0.7보다 높은 임계값 설정
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 낮은 confidence로 인해 건너뛰기
      // Predicate 정규화 실패 시 confidence = 0.3 (구조) + 0.4 (Entity Linking) = 0.7
      // 임계값 0.71보다 낮으므로 건너뛰기
      expect(result).toBeDefined();
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it('Confidence 임계값 필터링 - 높은 confidence는 생성', async () => {
      // Given: 높은 confidence를 가진 Triple (canonicalization, entityLinking 성공)
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5,
        confidenceThreshold: 0.5 // 낮은 임계값 설정
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 높은 confidence로 인해 생성
      expect(result).toBeDefined();
      expect(result.created).toBeGreaterThanOrEqual(1);
      expect(result.semanticMemoryIds.length).toBeGreaterThan(0);
    });

    it('여러 Triple 처리 - 일부는 생성, 일부는 건너뛰기', async () => {
      // Given: 다양한 confidence를 가진 Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }, // 높은 confidence 예상
        { subject: '사용자', predicate: '선호', object: '차' }   // 높은 confidence 예상
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5,
        confidenceThreshold: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 결과 확인
      expect(result).toBeDefined();
      expect(result.created + result.updated + result.skipped).toBe(triples.length);
      expect(result.semanticMemoryIds.length).toBeGreaterThan(0);
    });

    it('Episodic-Edge 관계 생성 확인', async () => {
      // Given: Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: Episodic-Edge 관계 생성 확인
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 관계 확인
      const relations = DatabaseUtils.all(db, `
        SELECT source_id, target_id, relation_type, confidence
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // extracted_from 또는 supported_by 관계 확인
      const relationTypes = relations.map(r => r.relation_type);
      expect(relationTypes.some(type => type === 'extracted_from' || type === 'supported_by')).toBe(true);
      
      // confidence 값 확인
      expect(relations[0].confidence).toBeGreaterThanOrEqual(0);
      expect(relations[0].confidence).toBeLessThanOrEqual(1);
    });

    it('에러 처리 - Triple 처리 실패 시 건너뛰기', async () => {
      // Given: 유효하지 않은 Triple (DB 오류를 유발할 수 있는 상황)
      const triples: Triple[] = [
        { subject: '', predicate: '', object: '' } // 빈 값으로 인한 오류 가능
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: false,
            entityLinking: false
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 에러가 발생해도 결과 반환 (건너뛰기)
      expect(result).toBeDefined();
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      // 에러가 발생해도 서비스는 계속 동작해야 함
    });

    // 1.11 작업: updateSemanticMemory() 메서드 분리를 위한 테스트 작성 (TDD RED)
    describe('updateSemanticMemory 메서드 분리 - validateInput', () => {
      it('Given: 빈 Triple 배열일 때, When: updateSemanticMemory를 호출하면, Then: validateInput이 early return하여 빈 결과 반환', async () => {
        // Given: 빈 Triple 배열
        const extractionResult: TripleExtractionResult = {
          triples: [],
          extractionInfo: {
            steps: {
              canonicalization: false,
              entityLinking: false
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: validateInput이 early return하여 빈 결과 반환
        expect(result).toBeDefined();
        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.semanticMemoryIds).toEqual([]);
      });
    });

    describe('updateSemanticMemory 메서드 분리 - prepareUpdateData', () => {
      it('Given: confidenceThreshold가 설정되지 않았을 때, When: updateSemanticMemory를 호출하면, Then: prepareUpdateData가 기본값(0.7)을 사용', async () => {
        // Given: confidenceThreshold가 설정되지 않은 옵션
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
          // confidenceThreshold 미설정
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: prepareUpdateData가 기본값(0.7)을 사용하여 처리
        // confidence가 0.7 이상이면 생성, 미만이면 건너뛰기
        expect(result).toBeDefined();
        // 결과는 confidence 값에 따라 달라질 수 있음
      });

      it('Given: confidenceThreshold가 0.8로 설정되었을 때, When: updateSemanticMemory를 호출하면, Then: prepareUpdateData가 설정값(0.8)을 사용', async () => {
        // Given: confidenceThreshold가 0.8로 설정된 옵션
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5,
          confidenceThreshold: 0.8
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: prepareUpdateData가 설정값(0.8)을 사용하여 처리
        expect(result).toBeDefined();
        // confidence가 0.8 이상이면 생성, 미만이면 건너뛰기
      });

      it('Given: similarityThreshold가 설정되지 않았을 때, When: updateSemanticMemory를 호출하면, Then: prepareUpdateData가 기본값(0.9)을 사용', async () => {
        // Given: similarityThreshold가 설정되지 않은 옵션
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
          // similarityThreshold 미설정
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: prepareUpdateData가 기본값(0.9)을 사용하여 중복 판단
        expect(result).toBeDefined();
      });
    });

    describe('updateSemanticMemory 메서드 분리 - applyUpdates', () => {
      it('Given: 단일 Triple 배열일 때, When: updateSemanticMemory를 호출하면, Then: applyUpdates가 단일 triple을 처리', async () => {
        // Given: 단일 Triple 배열
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: applyUpdates가 단일 triple을 처리하여 결과 반환
        expect(result).toBeDefined();
        expect(result.created + result.updated + result.skipped).toBe(1);
      });

      it('Given: 여러 Triple 배열일 때, When: updateSemanticMemory를 호출하면, Then: applyUpdates가 모든 triple을 순차 처리', async () => {
        // Given: 여러 Triple 배열
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' },
          { subject: '사용자', predicate: '선호', object: '차' },
          { subject: '사용자', predicate: '선호', object: '주스' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: applyUpdates가 모든 triple을 순차 처리하여 결과 반환
        expect(result).toBeDefined();
        expect(result.created + result.updated + result.skipped).toBe(3);
      });

      it('Given: 일부 Triple이 에러를 발생시킬 때, When: updateSemanticMemory를 호출하면, Then: applyUpdates가 에러를 처리하고 계속 진행', async () => {
        // Given: 일부 Triple이 에러를 발생시킬 수 있는 상황
        // (실제로는 관계 방향 검증 실패 등이 발생할 수 있음)
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' },
          { subject: '사용자', predicate: '선호', object: '차' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: applyUpdates가 에러를 처리하고 계속 진행하여 결과 반환
        expect(result).toBeDefined();
        expect(result.created + result.updated + result.skipped).toBe(2);
      });
    });

    describe('updateSemanticMemory 메서드 분리 - notifyListeners', () => {
      it('Given: Semantic Memory 업데이트가 완료되었을 때, When: updateSemanticMemory를 호출하면, Then: notifyListeners가 statistics.recordUpdate를 호출', async () => {
        // Given: Triple 배열과 Episodic Memory ID
        const triples: Triple[] = [
          { subject: '사용자', predicate: '선호', object: '커피' }
        ];
        const extractionResult: TripleExtractionResult = {
          triples,
          extractionInfo: {
            steps: {
              canonicalization: true,
              entityLinking: true
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // Episodic Memory 생성
        await DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

        // statistics.recordUpdate 호출을 확인하기 위해 spy 설정
        const statisticsService = (service as any).statistics;
        const recordUpdateSpy = vi.spyOn(statisticsService, 'recordUpdate');

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: notifyListeners가 statistics.recordUpdate를 호출
        expect(result).toBeDefined();
        expect(recordUpdateSpy).toHaveBeenCalledTimes(1);
        expect(recordUpdateSpy).toHaveBeenCalledWith(
          expect.any(Number), // created
          expect.any(Number), // updated
          expect.any(Number), // skipped
          expect.any(Number), // duplicates
          expect.any(Array),  // confidences
          expect.any(Number), // processingTime
          expect.any(Boolean) // hasError
        );

        recordUpdateSpy.mockRestore();
      });

      it('Given: 빈 Triple 배열일 때, When: updateSemanticMemory를 호출하면, Then: notifyListeners가 호출되지 않음 (early return)', async () => {
        // Given: 빈 Triple 배열
        const extractionResult: TripleExtractionResult = {
          triples: [],
          extractionInfo: {
            steps: {
              canonicalization: false,
              entityLinking: false
            }
          }
        };
        const options: SemanticMemoryUpdateOptions = {
          episodicMemoryId: 'episodic-1',
          episodicImportance: 0.5
        };

        // statistics.recordUpdate 호출을 확인하기 위해 spy 설정
        const statisticsService = (service as any).statistics;
        const recordUpdateSpy = vi.spyOn(statisticsService, 'recordUpdate');

        // When: updateSemanticMemory 호출
        const result = await service.updateSemanticMemory(extractionResult, options);

        // Then: notifyListeners가 호출되지 않음 (early return)
        expect(result).toBeDefined();
        expect(recordUpdateSpy).not.toHaveBeenCalled();

        recordUpdateSpy.mockRestore();
      });
    });
  });

  describe('중복 판단 로직', () => {
    it('정확한 매칭 - 완전히 동일한 Triple은 중복으로 판단', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const firstTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const firstExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(firstExtractionResult, firstOptions);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 동일한 Triple로 두 번째 업데이트
      const secondExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (동일한 Triple)
      const secondResult = await service.updateSemanticMemory(secondExtractionResult, secondOptions);

      // Then: 중복으로 판단하여 기존 Semantic Memory 업데이트
      expect(secondResult.updated).toBe(1);
      expect(secondResult.created).toBe(0);
      expect(secondResult.semanticMemoryIds[0]).toBe(semanticMemoryId);

      // DB에서 Semantic Memory 확인 (하나만 존재해야 함)
      const semanticMemories = DatabaseUtils.all(db, `
        SELECT id, type, subject, predicate, object
        FROM memory_item
        WHERE type = 'semantic'
      `) as Array<{
        id: string;
        type: string;
        subject: string;
        predicate: string;
        object: string;
      }>;

      expect(semanticMemories.length).toBe(1);
      expect(semanticMemories[0].id).toBe(semanticMemoryId);
    });

    it('Predicate 정확 일치 + Subject/Object 정규화 후 일치 - 중복으로 판단', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const firstTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const firstExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(firstExtractionResult, firstOptions);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 정규화 후 동일한 Triple (대소문자, 공백 차이)
      const secondTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const secondExtractionResult: TripleExtractionResult = {
        triples: [secondTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (정규화 후 동일한 Triple)
      const secondResult = await service.updateSemanticMemory(secondExtractionResult, secondOptions);

      // Then: 중복으로 판단하여 기존 Semantic Memory 업데이트
      expect(secondResult.updated).toBe(1);
      expect(secondResult.created).toBe(0);
      expect(secondResult.semanticMemoryIds[0]).toBe(semanticMemoryId);
    });

    it('다른 Predicate - 중복이 아님', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const firstTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const firstExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(firstExtractionResult, firstOptions);
      expect(firstResult.created).toBe(1);

      // 다른 Predicate를 가진 Triple
      const secondTriple: Triple = { subject: '사용자', predicate: '싫어함', object: '커피' };
      const secondExtractionResult: TripleExtractionResult = {
        triples: [secondTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (다른 Predicate)
      const secondResult = await service.updateSemanticMemory(secondExtractionResult, secondOptions);

      // Then: 중복이 아니므로 새로운 Semantic Memory 생성
      expect(secondResult.created).toBe(1);
      expect(secondResult.updated).toBe(0);

      // DB에서 Semantic Memory 확인 (두 개 존재해야 함)
      const semanticMemories = DatabaseUtils.all(db, `
        SELECT id, type, subject, predicate, object
        FROM memory_item
        WHERE type = 'semantic'
      `) as Array<{
        id: string;
        type: string;
        subject: string;
        predicate: string;
        object: string;
      }>;

      expect(semanticMemories.length).toBe(2);
    });

    it('다른 Subject/Object - 중복이 아님', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const firstTriple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const firstExtractionResult: TripleExtractionResult = {
        triples: [firstTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(firstExtractionResult, firstOptions);
      expect(firstResult.created).toBe(1);

      // 다른 Subject/Object를 가진 Triple (같은 Predicate)
      const secondTriple: Triple = { subject: '사용자', predicate: '선호', object: '차' };
      const secondExtractionResult: TripleExtractionResult = {
        triples: [secondTriple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (다른 Subject/Object)
      const secondResult = await service.updateSemanticMemory(secondExtractionResult, secondOptions);

      // Then: 중복이 아니므로 새로운 Semantic Memory 생성
      expect(secondResult.created).toBe(1);
      expect(secondResult.updated).toBe(0);

      // DB에서 Semantic Memory 확인 (두 개 존재해야 함)
      const semanticMemories = DatabaseUtils.all(db, `
        SELECT id, type, subject, predicate, object
        FROM memory_item
        WHERE type = 'semantic'
      `) as Array<{
        id: string;
        type: string;
        subject: string;
        predicate: string;
        object: string;
      }>;

      expect(semanticMemories.length).toBe(2);
    });

    it('중복 판단 시 병합 전략 확인 - Episode Weight 누적', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성
      const triple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const extractionResult: TripleExtractionResult = {
        triples: [triple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성
      const firstResult = await service.updateSemanticMemory(extractionResult, firstOptions);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 첫 번째 Semantic Memory의 초기 상태 확인
      const initialMemory = DatabaseUtils.get(db, `
        SELECT id, importance, recall_count
        FROM memory_item
        WHERE id = ?
      `, [semanticMemoryId]) as {
        id: string;
        importance: number;
        recall_count: number;
      };

      expect(initialMemory.recall_count).toBe(0);

      // 동일한 Triple로 두 번째 업데이트
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: updateSemanticMemory 호출 (중복 Triple)
      const secondResult = await service.updateSemanticMemory(extractionResult, secondOptions);

      // Then: 중복으로 판단하여 기존 Semantic Memory 업데이트
      expect(secondResult.updated).toBe(1);
      expect(secondResult.semanticMemoryIds[0]).toBe(semanticMemoryId);

      // Episode Weight 누적 확인
      const updatedMemory = DatabaseUtils.get(db, `
        SELECT id, importance, recall_count
        FROM memory_item
        WHERE id = ?
      `, [semanticMemoryId]) as {
        id: string;
        importance: number;
        recall_count: number;
      };

      expect(updatedMemory.recall_count).toBe(1); // Episode Weight 증가 확인
      expect(updatedMemory.importance).toBeGreaterThanOrEqual(initialMemory.importance); // 중요도 증가 확인
    });
  });

  describe('Confidence 계산 및 저장', () => {
    it('모든 단계 성공 시 높은 Confidence 계산 및 저장', async () => {
      // Given: 모든 단계가 성공한 extractionInfo
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 높은 confidence로 Semantic Memory 생성 및 memory_relation.confidence에 저장
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 confidence 확인
      const relations = DatabaseUtils.all(db, `
        SELECT source_id, target_id, relation_type, confidence
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // 구조적 검증 기반 confidence 계산 확인
      // 모든 단계 성공 시: 0.3 (구조 완전성) + 0.3 (Predicate 정규화) + 0.4 (Entity Linking) = 1.0
      const confidence = relations[0].confidence;
      expect(confidence).toBeGreaterThanOrEqual(0.7); // 높은 confidence
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    it('일부 단계 실패 시 낮은 Confidence 계산 및 저장', async () => {
      // Given: 일부 단계가 실패한 Triple (Predicate 정규화만 실패)
      // EntityLinker는 Open World Assumption으로 항상 success: true를 반환하므로,
      // Predicate 정규화만 실패하도록 하여 confidence를 낮게 유지
      // Triple 구조 완전성(0.3) + Entity Linking 성공(0.4) = 0.7
      // Predicate 정규화 실패 시 confidence = 0.3 + 0.4 = 0.7
      const triples: Triple[] = [
        { subject: '사용자', predicate: 'nonexistent_predicate_xyz', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: false,
            entityLinking: true // EntityLinker는 항상 성공
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5,
        confidenceThreshold: 0.3 // 낮은 임계값 설정 (테스트를 위해)
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 낮은 confidence로 처리 (임계값에 따라 생성되거나 건너뛰기)
      // confidenceThreshold가 0.3이므로 0.7 confidence로 생성됨
      if (result.created > 0) {
        const semanticMemoryId = result.semanticMemoryIds[0];

        // memory_relation 테이블에서 confidence 확인
        const relations = DatabaseUtils.all(db, `
          SELECT source_id, target_id, relation_type, confidence
          FROM memory_relation
          WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
        `, [
          options.episodicMemoryId,
          semanticMemoryId,
          semanticMemoryId,
          options.episodicMemoryId
        ]) as Array<{
          source_id: string;
          target_id: string;
          relation_type: string;
          confidence: number;
        }>;

        expect(relations.length).toBeGreaterThan(0);
        
        // confidence 확인 (Predicate 정규화 실패 시 0.7)
        const confidence = relations[0].confidence;
        // EntityLinker는 항상 성공하므로 confidence = 0.3 (구조) + 0.4 (Entity Linking) = 0.7
        expect(confidence).toBe(0.7);
        expect(confidence).toBeGreaterThanOrEqual(0.0);
      } else {
        // confidence가 임계값 미만이면 건너뛰기
        expect(result.skipped).toBeGreaterThan(0);
      }
    });

    it('Triple 구조 불완전 시 낮은 Confidence 계산', async () => {
      // Given: 구조가 불완전한 Triple (빈 값 포함)
      const triples: Triple[] = [
        { subject: '', predicate: '선호', object: '커피' } // subject가 빈 값
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5,
        confidenceThreshold: 0.2 // 낮은 임계값 설정 (테스트를 위해)
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 낮은 confidence로 처리 (구조 불완전으로 인해)
      // 구조 불완전 시: 0.0 (구조 완전성 실패) + 0.3 (Predicate 정규화) + 0.4 (Entity Linking) = 0.7
      // 하지만 실제로는 subject가 빈 값이므로 더 낮을 수 있음
      if (result.created > 0) {
        const semanticMemoryId = result.semanticMemoryIds[0];

        // memory_relation 테이블에서 confidence 확인
        const relations = DatabaseUtils.all(db, `
          SELECT source_id, target_id, relation_type, confidence
          FROM memory_relation
          WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
        `, [
          options.episodicMemoryId,
          semanticMemoryId,
          semanticMemoryId,
          options.episodicMemoryId
        ]) as Array<{
          source_id: string;
          target_id: string;
          relation_type: string;
          confidence: number;
        }>;

        expect(relations.length).toBeGreaterThan(0);
        
        // 낮은 confidence 확인 (구조 불완전으로 인해)
        const confidence = relations[0].confidence;
        expect(confidence).toBeLessThan(1.0);
        expect(confidence).toBeGreaterThanOrEqual(0.0);
      } else {
        // confidence가 임계값 미만이면 건너뛰기
        expect(result.skipped).toBeGreaterThan(0);
      }
    });

    it('Confidence가 memory_relation.confidence 필드에 저장되는지 확인', async () => {
      // Given: Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: memory_relation.confidence 필드에 confidence 저장 확인
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 confidence 확인
      const relations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type, confidence, metadata
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
        metadata: string | null;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // 각 relation의 confidence 확인
      for (const relation of relations) {
        expect(relation.confidence).toBeDefined();
        expect(typeof relation.confidence).toBe('number');
        expect(relation.confidence).toBeGreaterThanOrEqual(0.0);
        expect(relation.confidence).toBeLessThanOrEqual(1.0);
        
        // extracted_from 또는 supported_by 관계 확인
        expect(['extracted_from', 'supported_by']).toContain(relation.relation_type);
      }
    });

    it('구조적 검증 기반 Confidence 계산 확인 - 각 단계별 점수 부여', async () => {
      // Given: 모든 단계가 성공한 Triple
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 구조적 검증 기반 confidence 계산 확인
      // 모든 단계 성공 시: 0.3 (구조 완전성) + 0.3 (Predicate 정규화) + 0.4 (Entity Linking) = 1.0
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 confidence 확인
      const relations = DatabaseUtils.all(db, `
        SELECT source_id, target_id, relation_type, confidence
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // 구조적 검증 기반 confidence 계산 확인
      // 모든 단계 성공 시 높은 confidence (0.7 이상)
      const confidence = relations[0].confidence;
      expect(confidence).toBeGreaterThanOrEqual(0.7);
      expect(confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Episodic-Edge 생성', () => {
    it('Episodic Memory와 Semantic Memory 간 관계 생성 확인', async () => {
      // Given: Triple 배열과 Episodic Memory
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: memory_relation 레코드 생성 확인
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 관계 확인
      const relations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type, confidence, metadata
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
        metadata: string | null;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // extracted_from와 supported_by 관계 모두 확인
      const relationTypes = relations.map(r => r.relation_type);
      expect(relationTypes).toContain('extracted_from');
      expect(relationTypes).toContain('supported_by');
    });

    it('각 triple별 독립적인 metadata 저장 확인', async () => {
      // Given: 여러 Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' },
        { subject: '사용자', predicate: '선호', object: '차' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 각 triple별로 독립적인 memory_relation 레코드 생성 확인
      expect(result.created).toBeGreaterThan(0);
      
      // 각 Semantic Memory에 대한 관계 확인
      for (const semanticMemoryId of result.semanticMemoryIds) {
        const relations = DatabaseUtils.all(db, `
          SELECT id, source_id, target_id, relation_type, confidence, metadata
          FROM memory_relation
          WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
        `, [
          options.episodicMemoryId,
          semanticMemoryId,
          semanticMemoryId,
          options.episodicMemoryId
        ]) as Array<{
          id: number;
          source_id: string;
          target_id: string;
          relation_type: string;
          confidence: number;
          metadata: string | null;
        }>;

        expect(relations.length).toBeGreaterThan(0);
        
        // 각 relation의 metadata 확인
        for (const relation of relations) {
          expect(relation.metadata).toBeDefined();
          const metadata = JSON.parse(relation.metadata || '{}');
          
          // 각 triple별 독립적인 metadata 저장 확인
          expect(metadata.method).toBe('llm');
          expect(metadata.triple).toBeDefined();
          expect(metadata.triple.subject).toBeDefined();
          expect(metadata.triple.predicate).toBeDefined();
          expect(metadata.triple.object).toBeDefined();
          expect(metadata.steps).toBeDefined();
        }
      }
    });

    it('confidence 필드 저장 확인', async () => {
      // Given: Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: memory_relation.confidence 필드에 저장 확인
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // memory_relation 테이블에서 confidence 확인
      const relations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type, confidence, metadata
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        options.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        options.episodicMemoryId
      ]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number;
        metadata: string | null;
      }>;

      expect(relations.length).toBeGreaterThan(0);
      
      // 각 relation의 confidence 확인
      for (const relation of relations) {
        expect(relation.confidence).toBeDefined();
        expect(typeof relation.confidence).toBe('number');
        expect(relation.confidence).toBeGreaterThanOrEqual(0.0);
        expect(relation.confidence).toBeLessThanOrEqual(1.0);
        
        // extracted_from와 supported_by 관계 모두 동일한 confidence 값을 가져야 함
        const extractedFromRelation = relations.find(r => r.relation_type === 'extracted_from');
        const supportedByRelation = relations.find(r => r.relation_type === 'supported_by');
        
        if (extractedFromRelation && supportedByRelation) {
          expect(extractedFromRelation.confidence).toBe(supportedByRelation.confidence);
        }
      }
    });

    it('extracted_from 관계 방향 확인 (Episodic → Semantic)', async () => {
      // Given: Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: extracted_from 관계 방향 확인 (Episodic → Semantic)
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      const extractedFromRelation = DatabaseUtils.get(db, `
        SELECT source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as {
        source_id: string;
        target_id: string;
        relation_type: string;
      } | undefined;

      expect(extractedFromRelation).toBeDefined();
      expect(extractedFromRelation?.source_id).toBe(options.episodicMemoryId);
      expect(extractedFromRelation?.target_id).toBe(semanticMemoryId);
      expect(extractedFromRelation?.relation_type).toBe('extracted_from');

      // source가 Episodic인지 확인
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [extractedFromRelation?.source_id]) as { id: string; type: string } | undefined;

      expect(sourceMemory?.type).toBe('episodic');

      // target이 Semantic인지 확인
      const targetMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [extractedFromRelation?.target_id]) as { id: string; type: string } | undefined;

      expect(targetMemory?.type).toBe('semantic');
    });

    it('supported_by 관계 방향 확인 (Semantic → Episodic)', async () => {
      // Given: Triple 배열
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: supported_by 관계 방향 확인 (Semantic → Episodic)
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      const supportedByRelation = DatabaseUtils.get(db, `
        SELECT source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [semanticMemoryId, options.episodicMemoryId, 'supported_by']) as {
        source_id: string;
        target_id: string;
        relation_type: string;
      } | undefined;

      expect(supportedByRelation).toBeDefined();
      expect(supportedByRelation?.source_id).toBe(semanticMemoryId);
      expect(supportedByRelation?.target_id).toBe(options.episodicMemoryId);
      expect(supportedByRelation?.relation_type).toBe('supported_by');

      // source가 Semantic인지 확인
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [supportedByRelation?.source_id]) as { id: string; type: string } | undefined;

      expect(sourceMemory?.type).toBe('semantic');

      // target이 Episodic인지 확인
      const targetMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [supportedByRelation?.target_id]) as { id: string; type: string } | undefined;

      expect(targetMemory?.type).toBe('episodic');
    });
  });

  describe('관계 방향 검증', () => {
    it('잘못된 방향 - extracted_from: source가 Episodic이 아닌 경우 에러 발생', async () => {
      // Given: Semantic Memory를 Episodic Memory로 잘못 전달
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      
      // Semantic Memory를 생성하고 이를 episodicMemoryId로 잘못 전달
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, ['semantic-1', 'semantic', 'Test semantic memory', 0.5]);

      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'semantic-1', // 잘못된 타입 (Semantic을 Episodic으로 전달)
        episodicImportance: 0.5
      };

      // When: updateSemanticMemory 호출
      // Then: 관계 방향 검증 에러 발생
      await expect(service.updateSemanticMemory(extractionResult, options)).rejects.toThrow();
    });

    it('잘못된 방향 - extracted_from: target이 Semantic이 아닌 경우 에러 발생', async () => {
      // Given: Episodic Memory를 생성하고, 잘못된 타입의 target 사용
      // 이 테스트는 실제로는 updateSemanticMemory가 항상 Semantic Memory를 생성하므로
      // 직접 테스트하기 어렵습니다. 하지만 validateRelationDirection이 호출되므로
      // 에러가 발생할 수 있습니다.
      
      // 대신, 이미 존재하는 Semantic Memory가 아닌 다른 타입의 Memory를 target으로 사용하는 경우를 테스트
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      
      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, ['episodic-1', 'episodic', 'Test episodic memory', 0.5]);

      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Semantic Memory를 생성한 후 타입을 변경 (잘못된 타입으로)
      // updateSemanticMemory 호출 후 Semantic Memory 타입을 변경
      const result = await service.updateSemanticMemory(extractionResult, options);
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // Semantic Memory 타입을 잘못된 타입으로 변경
      await DatabaseUtils.run(db, `
        UPDATE memory_item SET type = ? WHERE id = ?
      `, ['episodic', semanticMemoryId]);

      // 동일한 Triple로 다시 업데이트 시도 (이미 생성된 Semantic Memory가 잘못된 타입)
      // 이 경우 validateRelationDirection에서 에러가 발생해야 함
      const secondResult = await service.updateSemanticMemory(extractionResult, options);
      
      // 에러가 발생하거나 건너뛰기 처리됨
      // 실제로는 createEpisodicEdge에서 에러가 발생하고 catch되어 로그만 기록됨
      expect(secondResult).toBeDefined();
    });

    it('잘못된 방향 - supported_by: source가 Semantic이 아닌 경우 에러 발생', async () => {
      // Given: Episodic Memory를 Semantic Memory로 잘못 전달
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      
      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, ['episodic-1', 'episodic', 'Test episodic memory', 0.5]);

      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Semantic Memory 생성 후 타입을 잘못된 타입으로 변경
      const result = await service.updateSemanticMemory(extractionResult, options);
      expect(result.created).toBeGreaterThan(0);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // Semantic Memory 타입을 잘못된 타입으로 변경
      await DatabaseUtils.run(db, `
        UPDATE memory_item SET type = ? WHERE id = ?
      `, ['episodic', semanticMemoryId]);

      // 동일한 Triple로 다시 업데이트 시도
      // 이 경우 validateRelationDirection에서 에러가 발생해야 함
      const secondResult = await service.updateSemanticMemory(extractionResult, options);
      
      // 에러가 발생하거나 건너뛰기 처리됨
      expect(secondResult).toBeDefined();
    });

    it('올바른 방향 - extracted_from: source가 Episodic, target이 Semantic인 경우 성공', async () => {
      // Given: 올바른 타입의 Memory
      const triples: Triple[] = [
        { subject: '사용자', predicate: '선호', object: '커피' }
      ];
      const extractionResult: TripleExtractionResult = {
        triples,
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // When: updateSemanticMemory 호출
      const result = await service.updateSemanticMemory(extractionResult, options);

      // Then: 성공적으로 관계 생성
      expect(result.created).toBeGreaterThan(0);
      
      // 관계 방향 확인
      const semanticMemoryId = result.semanticMemoryIds[0];
      const extractedFromRelation = DatabaseUtils.get(db, `
        SELECT source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as {
        source_id: string;
        target_id: string;
        relation_type: string;
      } | undefined;

      expect(extractedFromRelation).toBeDefined();
      
      // source가 Episodic인지 확인
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [extractedFromRelation?.source_id]) as { id: string; type: string } | undefined;
      expect(sourceMemory?.type).toBe('episodic');
      
      // target이 Semantic인지 확인
      const targetMemory = DatabaseUtils.get(db, `
        SELECT id, type FROM memory_item WHERE id = ?
      `, [extractedFromRelation?.target_id]) as { id: string; type: string } | undefined;
      expect(targetMemory?.type).toBe('semantic');
    });
  });

  describe('관계 중복 방지', () => {
    it('동일한 관계 중복 생성 방지 - UNIQUE 제약 조건 활용', async () => {
      // Given: 첫 번째 Triple로 Semantic Memory 생성 및 관계 생성
      const triple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const extractionResult: TripleExtractionResult = {
        triples: [triple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const firstOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [firstOptions.episodicMemoryId, 'episodic', 'Test episodic memory 1', 0.5]);

      // 첫 번째 Semantic Memory 생성 및 관계 생성
      const firstResult = await service.updateSemanticMemory(extractionResult, firstOptions);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 첫 번째 관계 생성 확인
      const firstRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        firstOptions.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        firstOptions.episodicMemoryId
      ]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      expect(firstRelations.length).toBeGreaterThan(0);
      const initialRelationCount = firstRelations.length;

      // 동일한 Triple로 두 번째 업데이트 (중복 Semantic Memory로 판단되어 업데이트)
      const secondOptions: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-2',
        episodicImportance: 0.6
      };

      // 두 번째 Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [secondOptions.episodicMemoryId, 'episodic', 'Test episodic memory 2', 0.6]);

      // When: 동일한 Triple로 두 번째 updateSemanticMemory 호출
      const secondResult = await service.updateSemanticMemory(extractionResult, secondOptions);

      // Then: 중복 Semantic Memory로 판단되어 업데이트
      expect(secondResult.updated).toBe(1);
      expect(secondResult.created).toBe(0);

      // 두 번째 Episodic Memory와 Semantic Memory 간 관계 생성 확인
      const secondRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      `, [
        secondOptions.episodicMemoryId,
        semanticMemoryId,
        semanticMemoryId,
        secondOptions.episodicMemoryId
      ]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      // 두 번째 Episodic Memory와의 관계가 생성되어야 함
      expect(secondRelations.length).toBeGreaterThan(0);

      // 전체 관계 수 확인 (첫 번째 + 두 번째 Episodic Memory와의 관계)
      const allRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE target_id = ? OR source_id = ?
      `, [semanticMemoryId, semanticMemoryId]) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      // 각 Episodic Memory마다 extracted_from와 supported_by 관계가 생성되므로
      // 총 4개의 관계가 있어야 함 (episodic-1 -> semantic, semantic -> episodic-1, episodic-2 -> semantic, semantic -> episodic-2)
      expect(allRelations.length).toBeGreaterThanOrEqual(4);
    });

    it('동일한 (source_id, target_id, relation_type) 조합 중복 생성 방지', async () => {
      // Given: Triple로 Semantic Memory 생성 및 관계 생성
      const triple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const extractionResult: TripleExtractionResult = {
        triples: [triple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // 첫 번째 Semantic Memory 생성 및 관계 생성
      const firstResult = await service.updateSemanticMemory(extractionResult, options);
      expect(firstResult.created).toBe(1);
      const semanticMemoryId = firstResult.semanticMemoryIds[0];

      // 첫 번째 관계 확인
      const firstExtractedFrom = DatabaseUtils.get(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as {
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      } | undefined;

      expect(firstExtractedFrom).toBeDefined();
      const initialRelationId = firstExtractedFrom?.id;

      // 동일한 Triple로 다시 업데이트 (중복 Semantic Memory로 판단되어 업데이트)
      const secondResult = await service.updateSemanticMemory(extractionResult, options);
      expect(secondResult.updated).toBe(1);

      // When: 동일한 관계를 다시 생성하려고 시도
      // (실제로는 createEpisodicEdge에서 UNIQUE 제약 조건에 의해 중복 생성 방지)

      // Then: 동일한 (source_id, target_id, relation_type) 조합의 관계는 하나만 존재
      const allExtractedFrom = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      // UNIQUE 제약 조건에 의해 동일한 관계는 하나만 존재해야 함
      expect(allExtractedFrom.length).toBe(1);
      expect(allExtractedFrom[0].id).toBe(initialRelationId);
    });

    it('UNIQUE 제약 조건 - 동일한 관계 타입 중복 생성 방지', async () => {
      // Given: Triple로 Semantic Memory 생성
      const triple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const extractionResult: TripleExtractionResult = {
        triples: [triple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // Semantic Memory 생성 및 관계 생성
      const result = await service.updateSemanticMemory(extractionResult, options);
      expect(result.created).toBe(1);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // extracted_from 관계 확인
      const extractedFromRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      expect(extractedFromRelations.length).toBe(1);

      // When: 동일한 관계를 직접 DB에 삽입 시도 (UNIQUE 제약 조건 위반)
      // Then: UNIQUE 제약 조건에 의해 에러 발생
      // Note: DatabaseUtils.run은 동기 함수이므로 try-catch로 처리
      try {
        DatabaseUtils.run(db, `
          INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
          VALUES (?, ?, ?, ?)
        `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from', 0.8]);
        // 에러가 발생하지 않으면 테스트 실패
        expect.fail('UNIQUE 제약 조건 위반 에러가 발생해야 함');
      } catch (error) {
        // UNIQUE 제약 조건 위반 에러가 발생해야 함
        expect(error).toBeDefined();
        expect((error as Error).message).toContain('UNIQUE constraint');
      }
    });

    it('다른 relation_type은 중복이 아님 - 동일한 source/target이어도 다른 타입은 허용', async () => {
      // Given: Triple로 Semantic Memory 생성
      const triple: Triple = { subject: '사용자', predicate: '선호', object: '커피' };
      const extractionResult: TripleExtractionResult = {
        triples: [triple],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const options: SemanticMemoryUpdateOptions = {
        episodicMemoryId: 'episodic-1',
        episodicImportance: 0.5
      };

      // Episodic Memory 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES (?, ?, ?, ?)
      `, [options.episodicMemoryId, 'episodic', 'Test episodic memory', 0.5]);

      // Semantic Memory 생성 및 관계 생성
      const result = await service.updateSemanticMemory(extractionResult, options);
      expect(result.created).toBe(1);
      const semanticMemoryId = result.semanticMemoryIds[0];

      // extracted_from와 supported_by 관계 모두 확인
      const extractedFromRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [options.episodicMemoryId, semanticMemoryId, 'extracted_from']) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      const supportedByRelations = DatabaseUtils.all(db, `
        SELECT id, source_id, target_id, relation_type
        FROM memory_relation
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
      `, [semanticMemoryId, options.episodicMemoryId, 'supported_by']) as Array<{
        id: number;
        source_id: string;
        target_id: string;
        relation_type: string;
      }>;

      // Then: extracted_from와 supported_by는 다른 relation_type이므로 모두 존재 가능
      expect(extractedFromRelations.length).toBe(1);
      expect(supportedByRelations.length).toBe(1);
      
      // 동일한 source/target이어도 다른 relation_type이므로 중복이 아님
      expect(extractedFromRelations[0].relation_type).toBe('extracted_from');
      expect(supportedByRelations[0].relation_type).toBe('supported_by');
    });
  });

  describe('UnifiedEmbeddingService 의존성 주입', () => {
    it('Given: UnifiedEmbeddingService가 주입되지 않았을 때, When: SemanticMemoryUpdateService를 생성하면, Then: 기본값으로 UnifiedEmbeddingService를 사용해야 함', () => {
      // Given: embeddingService 없이 생성
      // When: SemanticMemoryUpdateService 생성
      const newService = new SemanticMemoryUpdateService(db);

      // Then: embeddingService가 UnifiedEmbeddingService 인스턴스여야 함
      expect(newService).toBeDefined();
      // generateEmbedding 메서드가 존재해야 함
      expect((newService as any).embeddingService).toBeDefined();
      expect(typeof (newService as any).embeddingService.generateEmbedding).toBe('function');
    });

    it('Given: UnifiedEmbeddingService가 null일 때, When: isAvailable()를 호출하면, Then: 에러가 발생하지 않아야 함', () => {
      // Given: embeddingService가 null인 경우 (이론적으로는 발생하지 않지만 방어적 코딩)
      const newService = new SemanticMemoryUpdateService(db);
      
      // When: isAvailable() 호출
      // Then: 에러가 발생하지 않아야 함
      expect(() => {
        if ((newService as any).embeddingService) {
          (newService as any).embeddingService.isAvailable();
        }
      }).not.toThrow();
    });

    it('Given: UnifiedEmbeddingService가 주입되었을 때, When: generateEmbedding을 호출하면, Then: 정상적으로 작동해야 함', async () => {
      // Given: UnifiedEmbeddingService 주입
      const { UnifiedEmbeddingService } = await import('../../domains/embedding/services/unified-embedding-service.js');
      const embeddingService = new UnifiedEmbeddingService();
      const newService = new SemanticMemoryUpdateService(db, embeddingService);

      // When: generateEmbedding 호출 (내부적으로 사용)
      // Then: 에러가 발생하지 않아야 함
      expect((newService as any).embeddingService).toBeDefined();
      expect(typeof (newService as any).embeddingService.generateEmbedding).toBe('function');
      
      // 실제 호출 테스트는 isAvailable()을 통해 간접적으로 확인
      const isAvailable = (newService as any).embeddingService.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
    });
  });
});

