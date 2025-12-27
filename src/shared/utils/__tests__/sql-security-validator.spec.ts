/**
 * SQL 보안 검증 유틸리티 테스트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - SQL Injection 방지
 */

import { describe, it, expect } from 'vitest';
import { validateTableName, getVectorTableName } from '../sql-security-validator.js';

describe('sql-security-validator', () => {
  describe('validateTableName', () => {
    // Given: 허용된 테이블명이 주어졌을 때
    // When: validateTableName을 호출하면
    // Then: 에러가 발생하지 않아야 함
    it('should accept valid table names from whitelist', () => {
      const validTableNames = [
        'memory_item_vec_tfidf',
        'memory_item_vec_minilm',
        'memory_item_vec_openai',
        'memory_item_vec_gemini'
      ];

      for (const tableName of validTableNames) {
        expect(() => validateTableName(tableName)).not.toThrow();
      }
    });

    // Given: 허용되지 않은 테이블명이 주어졌을 때
    // When: validateTableName을 호출하면
    // Then: 에러가 발생해야 함
    it('should reject table names not in whitelist', () => {
      const invalidTableNames = [
        'memory_item_vec_unknown',
        'users',
        'admin_table',
        'test_table'
      ];

      for (const tableName of invalidTableNames) {
        expect(() => validateTableName(tableName)).toThrow(/허용되지 않은 테이블명/);
      }
    });

    // Given: 잘못된 패턴의 테이블명이 주어졌을 때
    // When: validateTableName을 호출하면
    // Then: 에러가 발생해야 함
    it('should reject table names with invalid characters', () => {
      // 커스텀 허용 목록을 사용하여 화이트리스트 검증을 우회하고 패턴 검증만 테스트
      const customAllowed = ['memory-item-vec', 'memory_item_vec_tfidf!', 'Memory_Item_Vec', 'memory_item_vec.tfidf', 'memory_item_vec tfidf'];
      const invalidPatterns = [
        'memory-item-vec',  // 하이픈 포함
        'memory_item_vec_tfidf!',  // 특수문자 포함
        'Memory_Item_Vec',  // 대문자 포함
        'memory_item_vec.tfidf',  // 점 포함
        'memory_item_vec tfidf'  // 공백 포함
      ];

      for (const tableName of invalidPatterns) {
        expect(() => validateTableName(tableName, customAllowed)).toThrow(/소문자, 숫자, 언더스코어만 허용/);
      }
    });

    // Given: SQL 키워드가 포함된 테이블명이 주어졌을 때
    // When: validateTableName을 호출하면
    // Then: 에러가 발생해야 함
    it('should reject table names containing SQL keywords', () => {
      // 커스텀 허용 목록을 사용하여 화이트리스트 검증을 우회하고 SQL 키워드 검증만 테스트
      const customAllowed = ['memory_item_vec_select', 'memory_item_vec_drop', 'memory_item_vec_delete', 'memory_item_vec_union'];
      const sqlKeywordTableNames = [
        'memory_item_vec_select',
        'memory_item_vec_drop',
        'memory_item_vec_delete',
        'memory_item_vec_union'
      ];

      for (const tableName of sqlKeywordTableNames) {
        expect(() => validateTableName(tableName, customAllowed)).toThrow(/SQL 키워드가 포함되어 있습니다/);
      }
    });

    // Given: 커스텀 허용 테이블명 목록이 주어졌을 때
    // When: validateTableName을 커스텀 목록과 함께 호출하면
    // Then: 커스텀 목록의 테이블명만 허용해야 함
    it('should accept custom allowed table names', () => {
      const customAllowed = ['custom_table_1', 'custom_table_2'];
      
      expect(() => validateTableName('custom_table_1', customAllowed)).not.toThrow();
      expect(() => validateTableName('custom_table_2', customAllowed)).not.toThrow();
      expect(() => validateTableName('memory_item_vec_tfidf', customAllowed)).toThrow();
    });
  });

  describe('getVectorTableName', () => {
    // Given: 유효한 provider가 주어졌을 때
    // When: getVectorTableName을 호출하면
    // Then: 해당 provider의 테이블명을 반환해야 함
    it('should return correct table name for valid providers', () => {
      expect(getVectorTableName('tfidf')).toBe('memory_item_vec_tfidf');
      expect(getVectorTableName('minilm')).toBe('memory_item_vec_minilm');
      expect(getVectorTableName('openai')).toBe('memory_item_vec_openai');
      expect(getVectorTableName('gemini')).toBe('memory_item_vec_gemini');
    });

    // Given: 알 수 없는 provider가 주어졌을 때
    // When: getVectorTableName을 호출하면
    // Then: 기본 테이블명(tfidf)을 반환해야 함
    it('should return default table name for unknown providers', () => {
      expect(getVectorTableName('unknown')).toBe('memory_item_vec_tfidf');
      expect(getVectorTableName('invalid')).toBe('memory_item_vec_tfidf');
    });

    // Given: 대소문자가 섞인 provider가 주어졌을 때
    // When: getVectorTableName을 호출하면
    // Then: 소문자로 정규화하여 처리해야 함
    it('should normalize provider name to lowercase', () => {
      expect(getVectorTableName('TFIDF')).toBe('memory_item_vec_tfidf');
      expect(getVectorTableName('MiniLM')).toBe('memory_item_vec_minilm');
      expect(getVectorTableName('OPENAI')).toBe('memory_item_vec_openai');
    });
  });
});

