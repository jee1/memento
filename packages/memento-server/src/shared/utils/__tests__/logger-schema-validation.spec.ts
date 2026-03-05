/**
 * 로깅 스키마 검증 테스트
 * 
 * 로깅 메타데이터 스키마 타입 정의 및 검증 로직 테스트
 */

import { describe, it, expect } from 'vitest';
import { validateLogMetadata, LogMetadataSchema } from '../logger.js';

describe('로깅 스키마 검증', () => {
  describe('validateLogMetadata', () => {
    it('유효한 메타데이터 검증', () => {
      // Given: 유효한 메타데이터
      const meta: LogMetadataSchema = {
        agentId: 'default',
        slot: 'A',
        memoryId: 'mem_123',
        traceId: 'trace_456',
        requestId: 'req_789'
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('빈 메타데이터 검증', () => {
      // Given: 빈 메타데이터
      const meta = {};

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('undefined 메타데이터 검증', () => {
      // Given: undefined 메타데이터
      const meta = undefined;

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('잘못된 slot 값 검증', () => {
      // Given: 잘못된 slot 값
      const meta: LogMetadataSchema = {
        slot: 'D' as any // 잘못된 값
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 실패
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid slot value');
    });

    it('잘못된 타입의 agentId 검증', () => {
      // Given: 잘못된 타입의 agentId
      const meta: LogMetadataSchema = {
        agentId: 123 as any // 숫자 타입
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 경고 발생
      expect(result.valid).toBe(true); // 경고는 에러가 아님
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('agentId should be a string');
    });

    it('잘못된 타입의 memoryId 검증', () => {
      // Given: 잘못된 타입의 memoryId
      const meta: LogMetadataSchema = {
        memoryId: 123 as any // 숫자 타입
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 경고 발생
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('memoryId should be a string');
    });

    it('모든 공통 필드 포함 검증', () => {
      // Given: 모든 공통 필드 포함
      const meta: LogMetadataSchema = {
        agentId: 'default',
        slot: 'B',
        memoryId: 'mem_123',
        traceId: 'trace_456',
        requestId: 'req_789',
        operation: 'recall',
        query: 'test query'
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('추가 컨텍스트 정보 포함 검증', () => {
      // Given: 추가 컨텍스트 정보 포함
      const meta: LogMetadataSchema = {
        agentId: 'default',
        customField1: 'value1',
        customField2: 123,
        customField3: { nested: 'object' }
      };

      // When: 검증
      const result = validateLogMetadata(meta);

      // Then: 검증 통과 (추가 필드는 허용)
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

