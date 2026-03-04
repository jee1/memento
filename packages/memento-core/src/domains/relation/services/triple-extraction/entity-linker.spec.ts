/**
 * EntityLinker 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityLinker } from './entity-linker.js';
import type { EntityLinkingResult } from '../../../../shared/types/triple-extraction.js';

describe('EntityLinker', () => {
  let entityLinker: EntityLinker;

  beforeEach(() => {
    entityLinker = new EntityLinker();
  });

  describe('link', () => {
    describe('성공 케이스 - 다양한 엔티티 표현 정규화', () => {
      it('사용자 관련 엔티티 정규화', () => {
        // Given: 다양한 "사용자" 표현 (표준 엔티티 '사용자' 제외)
        const entities = ['user', '유저', '나', 'i', 'me', 'myself', '내'];

        // When: link 호출
        const results = entities.map(entity => entityLinker.link(entity));

        // Then: 모두 "사용자"로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.linked).toBe('사용자');
          expect(result.original).toBe(entities.find(e => e === result.original));
          expect(result.normalized).toBe(true); // 정규화됨 (표준 엔티티가 아니므로)
        }

        // 표준 엔티티 '사용자' 자체는 normalized: false
        const standardResult = entityLinker.link('사용자');
        expect(standardResult.success).toBe(true);
        expect(standardResult.linked).toBe('사용자');
        expect(standardResult.normalized).toBe(false); // 표준 엔티티 자체는 정규화되지 않음
      });

      it('시스템 관련 엔티티 정규화', () => {
        // Given: 다양한 "시스템" 표현 (표준 엔티티 '시스템' 제외)
        const entities = ['system', 'ai', 'artificial intelligence', 'assistant', '어시스턴트', '너', 'you', '당신'];

        // When: link 호출
        const results = entities.map(entity => entityLinker.link(entity));

        // Then: 모두 "시스템"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.linked).toBe('시스템');
          expect(result.normalized).toBe(true); // 정규화됨 (표준 엔티티가 아니므로)
        }

        // 표준 엔티티 '시스템' 자체는 normalized: false
        const standardResult = entityLinker.link('시스템');
        expect(standardResult.success).toBe(true);
        expect(standardResult.linked).toBe('시스템');
        expect(standardResult.normalized).toBe(false); // 표준 엔티티 자체는 정규화되지 않음
      });

      it('시간 관련 엔티티 정규화', () => {
        // Given: 다양한 "오늘" 표현
        const entities = ['today', '금일', '현재'];

        // When: link 호출
        const results = entities.map(entity => entityLinker.link(entity));

        // Then: 모두 "오늘"로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.linked).toBe('오늘');
          expect(result.normalized).toBe(true);
        }
      });

      it('표준 엔티티 자체는 그대로 반환', () => {
        // Given: 표준 엔티티
        const standardEntity = '사용자';

        // When: link 호출
        const result = entityLinker.link(standardEntity);

        // Then: 그대로 반환되어야 함
        expect(result.success).toBe(true);
        expect(result.linked).toBe('사용자');
        expect(result.original).toBe('사용자');
        expect(result.normalized).toBe(false); // 정규화되지 않음 (이미 표준)
      });
    });

    describe('구조화된 엔티티 예외 처리', () => {
      it('숫자는 변환하지 않고 원본 유지', () => {
        // Given: 숫자 엔티티
        const numericEntities = ['123', '456', '0', '999'];

        // When: link 호출
        const results = numericEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(numericEntities[i]);
          expect(results[i].original).toBe(numericEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('실수는 변환하지 않고 원본 유지', () => {
        // Given: 실수 엔티티
        const floatEntities = ['123.45', '0.5', '-45.67', '999.99'];

        // When: link 호출
        const results = floatEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(floatEntities[i]);
          expect(results[i].original).toBe(floatEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('음수는 변환하지 않고 원본 유지', () => {
        // Given: 음수 엔티티
        const negativeEntities = ['-123', '-45.67', '-0.5'];

        // When: link 호출
        const results = negativeEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(negativeEntities[i]);
          expect(results[i].original).toBe(negativeEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('날짜는 변환하지 않고 원본 유지 - YYYY-MM-DD 형식', () => {
        // Given: 날짜 엔티티 (YYYY-MM-DD 형식)
        const dateEntities = ['2025-01-15', '2025-01-16', '2024-12-31'];

        // When: link 호출
        const results = dateEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(dateEntities[i]);
          expect(results[i].original).toBe(dateEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('날짜는 변환하지 않고 원본 유지 - YYYY/MM/DD 형식', () => {
        // Given: 날짜 엔티티 (YYYY/MM/DD 형식)
        const dateEntities = ['2025/01/15', '2025/01/16', '2024/12/31'];

        // When: link 호출
        const results = dateEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(dateEntities[i]);
          expect(results[i].original).toBe(dateEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('날짜는 변환하지 않고 원본 유지 - YYYY.MM.DD 형식', () => {
        // Given: 날짜 엔티티 (YYYY.MM.DD 형식)
        const dateEntities = ['2025.01.15', '2025.01.16', '2024.12.31'];

        // When: link 호출
        const results = dateEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(dateEntities[i]);
          expect(results[i].original).toBe(dateEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('시간 형식은 변환하지 않고 원본 유지 - HH:MM 형식', () => {
        // Given: 시간 엔티티 (HH:MM 형식)
        const timeEntities = ['12:30', '09:15', '23:59'];

        // When: link 호출
        const results = timeEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(timeEntities[i]);
          expect(results[i].original).toBe(timeEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('시간 형식은 변환하지 않고 원본 유지 - HH:MM:SS 형식', () => {
        // Given: 시간 엔티티 (HH:MM:SS 형식)
        const timeEntities = ['12:30:45', '09:15:00', '23:59:59'];

        // When: link 호출
        const results = timeEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(timeEntities[i]);
          expect(results[i].original).toBe(timeEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('이메일 주소는 변환하지 않고 원본 유지', () => {
        // Given: 이메일 주소 엔티티
        const emailEntities = ['user@example.com', 'test@domain.co.kr', 'admin@test.org'];

        // When: link 호출
        const results = emailEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(emailEntities[i]);
          expect(results[i].original).toBe(emailEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('URL은 변환하지 않고 원본 유지', () => {
        // Given: URL 엔티티
        const urlEntities = [
          'https://example.com',
          'http://test.org',
          'https://www.example.com/path'
        ];

        // When: link 호출
        const results = urlEntities.map(entity => entityLinker.link(entity));

        // Then: 모두 원본 유지
        for (let i = 0; i < results.length; i++) {
          expect(results[i].success).toBe(true);
          expect(results[i].linked).toBe(urlEntities[i]);
          expect(results[i].original).toBe(urlEntities[i]);
          expect(results[i].normalized).toBe(false); // 변환하지 않음
        }
      });

      it('구조화된 엔티티는 사전 매칭보다 우선', () => {
        // Given: 구조화된 엔티티 (예: 숫자 "123")
        // 사전에 "123"이 있다고 해도 구조화된 엔티티로 인식되어 변환하지 않아야 함
        const structuredEntity = '123';

        // When: link 호출
        const result = entityLinker.link(structuredEntity);

        // Then: 구조화된 엔티티로 인식되어 원본 유지
        expect(result.success).toBe(true);
        expect(result.linked).toBe('123');
        expect(result.original).toBe('123');
        expect(result.normalized).toBe(false); // 변환하지 않음
      });

      it('구조화된 엔티티는 기본 정규화보다 우선', () => {
        // Given: 구조화된 엔티티 (예: 날짜 "2025-01-15")
        const structuredEntity = '2025-01-15';

        // When: link 호출
        const result = entityLinker.link(structuredEntity);

        // Then: 구조화된 엔티티로 인식되어 원본 유지 (소문자 변환 없음)
        expect(result.success).toBe(true);
        expect(result.linked).toBe('2025-01-15'); // 대소문자 변환 없음
        expect(result.original).toBe('2025-01-15');
        expect(result.normalized).toBe(false); // 변환하지 않음
      });
    });

    describe('사전에 없는 엔티티 기본 정규화', () => {
      it('사전에 없는 엔티티는 기본 정규화 적용', () => {
        // Given: 사전에 없는 엔티티
        const unknownEntity = 'UnknownEntity';

        // When: link 호출
        const result = entityLinker.link(unknownEntity);

        // Then: 기본 정규화 적용 (lowercasing, 공백 처리)
        expect(result.success).toBe(true); // Open World Assumption
        expect(result.linked).toBe('unknownentity');
        expect(result.original).toBe('UnknownEntity');
        expect(result.normalized).toBe(true);
      });

      it('대소문자 통일 및 공백 정규화', () => {
        // Given: 대소문자와 공백이 있는 엔티티
        const entity = '  Test  Entity  With  Spaces  ';

        // When: link 호출
        const result = entityLinker.link(entity);

        // Then: 소문자로 변환되고 공백이 정규화되어야 함
        expect(result.success).toBe(true);
        expect(result.linked).toBe('test entity with spaces');
        expect(result.original).toBe('Test  Entity  With  Spaces');
        expect(result.normalized).toBe(true);
      });
    });

    describe('실패 케이스 - 잘못된 입력', () => {
      it('빈 문자열 처리', () => {
        // Given: 빈 문자열
        const emptyEntity = '';

        // When: link 호출
        const result = entityLinker.link(emptyEntity);

        // Then: 실패 결과 반환
        expect(result.success).toBe(false);
        expect(result.linked).toBe('');
        expect(result.original).toBe('');
        expect(result.normalized).toBe(false);
      });

      it('공백만 있는 문자열 처리', () => {
        // Given: 공백만 있는 문자열
        const whitespaceEntity = '   ';

        // When: link 호출
        const result = entityLinker.link(whitespaceEntity);

        // Then: 실패 결과 반환
        expect(result.success).toBe(false);
        expect(result.linked).toBe('');
        expect(result.original).toBe(whitespaceEntity);
        expect(result.normalized).toBe(false);
      });

      it('null 처리', () => {
        // Given: null
        const nullEntity = null as unknown as string;

        // When: link 호출
        const result = entityLinker.link(nullEntity);

        // Then: 실패 결과 반환
        expect(result.success).toBe(false);
        expect(result.linked).toBe('');
        expect(result.original).toBe('');
        expect(result.normalized).toBe(false);
      });

      it('undefined 처리', () => {
        // Given: undefined
        const undefinedEntity = undefined as unknown as string;

        // When: link 호출
        const result = entityLinker.link(undefinedEntity);

        // Then: 실패 결과 반환
        expect(result.success).toBe(false);
        expect(result.linked).toBe('');
        expect(result.original).toBe('');
        expect(result.normalized).toBe(false);
      });
    });

    describe('결과 구조 검증', () => {
      it('성공 시 결과 구조 검증', () => {
        // Given: 유효한 엔티티
        const entity = 'user';

        // When: link 호출
        const result = entityLinker.link(entity);

        // Then: 올바른 결과 구조
        expect(result).toBeDefined();
        expect(typeof result.linked).toBe('string');
        expect(typeof result.original).toBe('string');
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.normalized).toBe('boolean');
        expect(result.success).toBe(true);
        expect(result.linked).toBe('사용자');
        expect(result.original).toBe('user');
        expect(result.normalized).toBe(true);
      });

      it('실패 시 결과 구조 검증', () => {
        // Given: 빈 문자열
        const emptyEntity = '';

        // When: link 호출
        const result = entityLinker.link(emptyEntity);

        // Then: 올바른 결과 구조
        expect(result).toBeDefined();
        expect(typeof result.linked).toBe('string');
        expect(typeof result.original).toBe('string');
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.normalized).toBe('boolean');
        expect(result.success).toBe(false);
        expect(result.normalized).toBe(false);
      });
    });
  });

  describe('linkBatch', () => {
    it('여러 엔티티 일괄 Linking', () => {
      // Given: 여러 엔티티 배열
      const entities = ['user', 'system', '123', '2025-01-15', 'UnknownEntity'];

      // When: linkBatch 호출
      const results = entityLinker.linkBatch(entities);

      // Then: 각 엔티티가 Linking되어야 함
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(entities.length);

      // 첫 번째: 사용자로 정규화
      expect(results[0].success).toBe(true);
      expect(results[0].linked).toBe('사용자');

      // 두 번째: 시스템으로 정규화
      expect(results[1].success).toBe(true);
      expect(results[1].linked).toBe('시스템');

      // 세 번째: 숫자는 원본 유지
      expect(results[2].success).toBe(true);
      expect(results[2].linked).toBe('123');
      expect(results[2].normalized).toBe(false);

      // 네 번째: 날짜는 원본 유지
      expect(results[3].success).toBe(true);
      expect(results[3].linked).toBe('2025-01-15');
      expect(results[3].normalized).toBe(false);

      // 다섯 번째: 기본 정규화
      expect(results[4].success).toBe(true);
      expect(results[4].linked).toBe('unknownentity');
      expect(results[4].normalized).toBe(true);
    });

    it('빈 배열 처리', () => {
      // Given: 빈 배열
      const entities: string[] = [];

      // When: linkBatch 호출
      const results = entityLinker.linkBatch(entities);

      // Then: 빈 배열 반환
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('혼합 케이스 처리 (성공/실패/구조화된 엔티티 혼합)', () => {
      // Given: 혼합된 엔티티 배열
      const entities = ['user', '', '123', 'system', '2025-01-15'];

      // When: linkBatch 호출
      const results = entityLinker.linkBatch(entities);

      // Then: 각각 올바르게 처리되어야 함
      expect(results.length).toBe(entities.length);
      expect(results[0].success).toBe(true); // user → 사용자
      expect(results[1].success).toBe(false); // 빈 문자열
      expect(results[2].success).toBe(true); // 숫자 (원본 유지)
      expect(results[3].success).toBe(true); // system → 시스템
      expect(results[4].success).toBe(true); // 날짜 (원본 유지)
    });
  });

  describe('addEntity', () => {
    it('사전에 새로운 엔티티 추가', () => {
      // Given: 새로운 엔티티와 동의어
      const canonical = '테스트엔티티';
      const synonyms = ['test', '테스트', 'test entity'];

      // When: addEntity 호출
      entityLinker.addEntity(canonical, synonyms);

      // Then: 동의어들이 표준 엔티티로 정규화되어야 함
      for (const synonym of synonyms) {
        const result = entityLinker.link(synonym);
        expect(result.success).toBe(true);
        expect(result.linked).toBe(canonical);
      }
    });

    it('기존 엔티티에 동의어 추가', () => {
      // Given: 기존 엔티티에 새로운 동의어 추가
      const canonical = '사용자';
      const newSynonym = 'newuser';

      // When: addEntity 호출
      entityLinker.addEntity(canonical, [newSynonym]);

      // Then: 새로운 동의어가 표준 엔티티로 정규화되어야 함
      const result = entityLinker.link(newSynonym);
      expect(result.success).toBe(true);
      expect(result.linked).toBe(canonical);
    });
  });
});

