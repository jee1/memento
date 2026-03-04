/**
 * Path Traversal 방지 유틸리티 테스트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
 * 
 * 이 테스트는 RED 단계로, 구현 전에 실패해야 합니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateFilePath, sanitizeFileName } from '../path-validator.js';

describe('Path Traversal 방지 유틸리티', () => {
  describe('validateFilePath', () => {
    it('상대 경로 패턴 ../ 차단해야 함', () => {
      // Given: Path Traversal 공격 패턴이 주어졌을 때
      const maliciousPath = '../../etc/passwd';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(maliciousPath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('상대 경로 패턴 ..\\ 차단해야 함', () => {
      // Given: Windows 스타일 Path Traversal 공격 패턴이 주어졌을 때
      const maliciousPath = '..\\..\\windows\\system32';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(maliciousPath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('상대 경로 패턴 ./ 차단해야 함', () => {
      // Given: 상대 경로 패턴이 주어졌을 때
      const maliciousPath = './etc/passwd';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(maliciousPath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('상대 경로 패턴 .\\ 차단해야 함', () => {
      // Given: Windows 스타일 상대 경로 패턴이 주어졌을 때
      const maliciousPath = '.\\windows\\system32';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(maliciousPath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('절대 경로 차단해야 함 (allowedDir 미지정 시)', () => {
      // Given: 절대 경로가 주어졌을 때
      const absolutePath = '/etc/passwd';
      
      // When: validateFilePath()를 호출하면 (allowedDir 미지정)
      const result = validateFilePath(absolutePath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('절대 경로 차단해야 함 (Windows 스타일)', () => {
      // Given: Windows 절대 경로가 주어졌을 때
      const absolutePath = 'C:\\Windows\\System32';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(absolutePath);
      
      // Then: false를 반환해야 함 (차단)
      expect(result).toBe(false);
    });

    it('허용된 디렉토리 내 상대 경로는 허용해야 함', () => {
      // Given: 허용된 디렉토리(data/) 내 상대 경로가 주어졌을 때
      const safePath = 'data/memory.db';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(safePath);
      
      // Then: true를 반환해야 함 (허용)
      expect(result).toBe(true);
    });

    it('허용된 디렉토리 지정 시 해당 디렉토리 내 경로만 허용해야 함', () => {
      // Given: 허용된 디렉토리(data/)가 지정되고, 해당 디렉토리 내 경로가 주어졌을 때
      const safePath = 'data/memory.db';
      const allowedDir = 'data';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(safePath, allowedDir);
      
      // Then: true를 반환해야 함 (허용)
      expect(result).toBe(true);
    });

    it('허용된 디렉토리 외부 경로는 차단해야 함', () => {
      // Given: 허용된 디렉토리(data/) 외부 경로가 주어졌을 때
      const maliciousPath = 'logs/../../etc/passwd';
      const allowedDir = 'data';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(maliciousPath, allowedDir);
      
      // Then: false를 반환해야 함 (차단) - Path Traversal 패턴이 포함되어 있으므로 차단
      expect(result).toBe(false);
    });

    it('환경 변수 ALLOWED_FILE_DIRS로 허용 디렉토리 지정 가능해야 함', () => {
      // Given: 환경 변수 ALLOWED_FILE_DIRS가 설정되었을 때
      const originalEnv = process.env.ALLOWED_FILE_DIRS;
      process.env.ALLOWED_FILE_DIRS = 'data/, logs/';
      const safePath = 'data/memory.db';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(safePath);
      
      // Then: true를 반환해야 함 (허용)
      expect(result).toBe(true);
      
      // Cleanup
      if (originalEnv !== undefined) {
        process.env.ALLOWED_FILE_DIRS = originalEnv;
      } else {
        delete process.env.ALLOWED_FILE_DIRS;
      }
    });

    it('환경 변수 ALLOWED_FILE_DIRS의 절대 경로도 허용해야 함', () => {
      // Given: 환경 변수에 절대 경로가 포함되었을 때
      const originalEnv = process.env.ALLOWED_FILE_DIRS;
      const absoluteDir = process.cwd() + '/data';
      process.env.ALLOWED_FILE_DIRS = absoluteDir;
      const safePath = 'data/memory.db';
      
      // When: validateFilePath()를 호출하면
      const result = validateFilePath(safePath);
      
      // Then: true를 반환해야 함 (허용)
      expect(result).toBe(true);
      
      // Cleanup
      if (originalEnv !== undefined) {
        process.env.ALLOWED_FILE_DIRS = originalEnv;
      } else {
        delete process.env.ALLOWED_FILE_DIRS;
      }
    });
  });

  describe('sanitizeFileName', () => {
    it('허용된 문자만 포함된 파일명은 그대로 반환해야 함', () => {
      // Given: 허용된 문자만 포함된 파일명이 주어졌을 때
      const safeFileName = 'memory.db';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(safeFileName);
      
      // Then: 원본 파일명을 반환해야 함
      expect(result).toBe('memory.db');
    });

    it('Path Traversal 패턴 ../ 제거해야 함', () => {
      // Given: Path Traversal 패턴이 포함된 파일명이 주어졌을 때
      const maliciousFileName = '../../etc/passwd';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(maliciousFileName);
      
      // Then: Path Traversal 패턴과 경로 구분자가 제거되어야 함
      expect(result).not.toContain('../');
      expect(result).not.toContain('/');
      // 허용된 문자(영문, 숫자)는 남아있을 수 있음
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it('Path Traversal 패턴 ..\\ 제거해야 함', () => {
      // Given: Windows 스타일 Path Traversal 패턴이 포함된 파일명이 주어졌을 때
      const maliciousFileName = '..\\..\\windows\\system32';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(maliciousFileName);
      
      // Then: Path Traversal 패턴과 경로 구분자가 제거되어야 함
      expect(result).not.toContain('..\\');
      expect(result).not.toContain('\\');
      // 허용된 문자(영문, 숫자)는 남아있을 수 있음
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it('허용되지 않은 특수 문자 제거해야 함', () => {
      // Given: 허용되지 않은 특수 문자가 포함된 파일명이 주어졌을 때
      const unsafeFileName = 'file<script>alert("xss")</script>.txt';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(unsafeFileName);
      
      // Then: 허용되지 않은 특수 문자가 제거되어야 함
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
      expect(result).not.toContain('(');
      expect(result).not.toContain(')');
    });

    it('허용된 문자만 남겨야 함 (영문, 숫자, 점, 하이픈, 언더스코어)', () => {
      // Given: 다양한 문자가 포함된 파일명이 주어졌을 때
      const mixedFileName = 'file-name_123.txt';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(mixedFileName);
      
      // Then: 허용된 문자만 남아야 함
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it('빈 문자열이면 기본 파일명 반환해야 함', () => {
      // Given: 빈 문자열이 주어졌을 때
      const emptyFileName = '';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(emptyFileName);
      
      // Then: 기본 파일명을 반환해야 함
      expect(result).toBe('file');
    });

    it('모든 문자가 제거되면 기본 파일명 반환해야 함', () => {
      // Given: 모든 문자가 허용되지 않은 파일명이 주어졌을 때
      const unsafeFileName = '<>:"|?*';
      
      // When: sanitizeFileName()을 호출하면
      const result = sanitizeFileName(unsafeFileName);
      
      // Then: 기본 파일명을 반환해야 함
      expect(result).toBe('file');
    });
  });
});

