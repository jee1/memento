/**
 * Relation Type Converter 테스트
 * DB 값과 enum 간 매핑, duplicates 처리, 지원/비지원 타입 검증
 */

import { describe, it, expect } from 'vitest';
import {
  toDbRelationType,
  fromDbRelationType,
  isValidDbRelationType,
  isMemoryLinkSupported
} from '../relation-type-converter.js';
import type { RelationType } from '../../types/relation.js';

describe('Relation Type Converter', () => {
  describe('toDbRelationType', () => {
    it('should convert VERSION_OF to version_of', () => {
      // Given: VERSION_OF RelationType
      const relationType: RelationType = 'VERSION_OF';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: version_of 반환
      expect(result).toBe('version_of');
    });

    it('should convert CAUSES to cause_of', () => {
      // Given: CAUSES RelationType
      const relationType: RelationType = 'CAUSES';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: cause_of 반환
      expect(result).toBe('cause_of');
    });

    it('should convert DEPENDS_ON to derived_from', () => {
      // Given: DEPENDS_ON RelationType
      const relationType: RelationType = 'DEPENDS_ON';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: derived_from 반환
      expect(result).toBe('derived_from');
    });

    it('should convert CONTRASTS_WITH to contradicts', () => {
      // Given: CONTRASTS_WITH RelationType
      const relationType: RelationType = 'CONTRASTS_WITH';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: contradicts 반환
      expect(result).toBe('contradicts');
    });

    it('should convert FOLLOWS to follows', () => {
      // Given: FOLLOWS RelationType
      const relationType: RelationType = 'FOLLOWS';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: follows 반환
      expect(result).toBe('follows');
    });

    it('should convert REFERENCES to references', () => {
      // Given: REFERENCES RelationType
      const relationType: RelationType = 'REFERENCES';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: references 반환
      expect(result).toBe('references');
    });

    it('should convert BELONGS_TO to belongs_to', () => {
      // Given: BELONGS_TO RelationType
      const relationType: RelationType = 'BELONGS_TO';

      // When: DB 값으로 변환
      const result = toDbRelationType(relationType);

      // Then: belongs_to 반환
      expect(result).toBe('belongs_to');
    });
  });

  describe('fromDbRelationType', () => {
    it('should convert version_of to VERSION_OF', () => {
      // Given: version_of DB 값
      const dbValue = 'version_of';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: VERSION_OF 반환
      expect(result).toBe('VERSION_OF');
    });

    it('should convert cause_of to CAUSES', () => {
      // Given: cause_of DB 값
      const dbValue = 'cause_of';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: CAUSES 반환
      expect(result).toBe('CAUSES');
    });

    it('should convert derived_from to DEPENDS_ON', () => {
      // Given: derived_from DB 값
      const dbValue = 'derived_from';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: DEPENDS_ON 반환
      expect(result).toBe('DEPENDS_ON');
    });

    it('should convert contradicts to CONTRASTS_WITH', () => {
      // Given: contradicts DB 값
      const dbValue = 'contradicts';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: CONTRASTS_WITH 반환
      expect(result).toBe('CONTRASTS_WITH');
    });

    it('should convert follows to FOLLOWS', () => {
      // Given: follows DB 값
      const dbValue = 'follows';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: FOLLOWS 반환
      expect(result).toBe('FOLLOWS');
    });

    it('should convert references to REFERENCES', () => {
      // Given: references DB 값
      const dbValue = 'references';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: REFERENCES 반환
      expect(result).toBe('REFERENCES');
    });

    it('should convert belongs_to to BELONGS_TO', () => {
      // Given: belongs_to DB 값
      const dbValue = 'belongs_to';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: BELONGS_TO 반환
      expect(result).toBe('BELONGS_TO');
    });

    it('should return null for duplicates (unmapped value)', () => {
      // Given: duplicates DB 값 (매핑되지 않은 값)
      const dbValue = 'duplicates';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: null 반환 (005 마이그레이션에서 제거됨)
      expect(result).toBeNull();
    });

    it('should return null for unknown DB value', () => {
      // Given: 알 수 없는 DB 값
      const dbValue = 'unknown_relation_type';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: null 반환
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      // Given: 빈 문자열
      const dbValue = '';

      // When: RelationType으로 변환
      const result = fromDbRelationType(dbValue);

      // Then: null 반환
      expect(result).toBeNull();
    });
  });

  describe('isValidDbRelationType', () => {
    it('should return true for valid DB relation types', () => {
      // Given: 유효한 DB relation_type 값들
      const validTypes = [
        'version_of',
        'cause_of',
        'derived_from',
        'contradicts',
        'follows',
        'references',
        'belongs_to'
      ];

      // When: 각 타입 검증
      // Then: 모두 true 반환
      validTypes.forEach(type => {
        expect(isValidDbRelationType(type)).toBe(true);
      });
    });

    it('should return true for duplicates (valid but unmapped)', () => {
      // Given: duplicates (유효하지만 매핑되지 않음)
      const dbValue = 'duplicates';

      // When: 검증
      const result = isValidDbRelationType(dbValue);

      // Then: true 반환 (유효하지만 매핑되지 않음)
      expect(result).toBe(true);
    });

    it('should return false for invalid DB relation types', () => {
      // Given: 유효하지 않은 DB relation_type 값들
      const invalidTypes = [
        'unknown_type',
        'invalid',
        '',
        'VERSION_OF', // 대문자 스네이크 케이스는 DB 값이 아님
        'versionOf' // 카멜 케이스도 아님
      ];

      // When: 각 타입 검증
      // Then: 모두 false 반환
      invalidTypes.forEach(type => {
        expect(isValidDbRelationType(type)).toBe(false);
      });
    });
  });

  describe('isMemoryLinkSupported', () => {
    it('should return true for memory_link supported types', () => {
      // Given: memory_link에서 지원하는 RelationType들
      const supportedTypes: RelationType[] = [
        'VERSION_OF',
        'CAUSES',
        'DEPENDS_ON',
        'CONTRASTS_WITH'
      ];

      // When: 각 타입 검증
      // Then: 모두 true 반환
      supportedTypes.forEach(type => {
        expect(isMemoryLinkSupported(type)).toBe(true);
      });
    });

    it('should return false for memory_link unsupported types', () => {
      // Given: memory_link에서 지원하지 않는 RelationType들
      const unsupportedTypes: RelationType[] = [
        'FOLLOWS',
        'REFERENCES',
        'BELONGS_TO'
      ];

      // When: 각 타입 검증
      // Then: 모두 false 반환
      unsupportedTypes.forEach(type => {
        expect(isMemoryLinkSupported(type)).toBe(false);
      });
    });
  });

  describe('Round-trip conversion', () => {
    it('should convert RelationType to DB and back correctly', () => {
      // Given: 모든 RelationType
      const relationTypes: RelationType[] = [
        'VERSION_OF',
        'CAUSES',
        'DEPENDS_ON',
        'CONTRASTS_WITH',
        'FOLLOWS',
        'REFERENCES',
        'BELONGS_TO'
      ];

      // When: DB 값으로 변환 후 다시 RelationType으로 변환
      // Then: 원래 값과 동일해야 함
      relationTypes.forEach(originalType => {
        const dbValue = toDbRelationType(originalType);
        const convertedBack = fromDbRelationType(dbValue);
        expect(convertedBack).toBe(originalType);
      });
    });

    it('should convert DB value to RelationType and back correctly', () => {
      // Given: 모든 유효한 DB relation_type 값 (duplicates 제외)
      const dbValues = [
        'version_of',
        'cause_of',
        'derived_from',
        'contradicts',
        'follows',
        'references',
        'belongs_to'
      ];

      // When: RelationType으로 변환 후 다시 DB 값으로 변환
      // Then: 원래 값과 동일해야 함
      dbValues.forEach(originalDbValue => {
        const relationType = fromDbRelationType(originalDbValue);
        if (relationType) {
          const convertedBack = toDbRelationType(relationType);
          expect(convertedBack).toBe(originalDbValue);
        }
      });
    });
  });
});

