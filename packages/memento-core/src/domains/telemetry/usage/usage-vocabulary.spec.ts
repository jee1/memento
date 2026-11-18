import { describe, expect, it } from 'vitest';
import {
  normalizeClientName,
  normalizeClientVersion,
  normalizeErrorCode,
  normalizeTool,
  sanitizeClientNameForLog,
} from './usage-vocabulary.js';

describe('usage-vocabulary (#1768)', () => {
  describe('normalizeClientName', () => {
    it('실측한 원문을 소문자로 맞춰 알려진 이름으로 바꾼다', () => {
      expect(normalizeClientName('claude-code')).toBe('claude-code');
      expect(normalizeClientName('Cursor')).toBe('cursor');
      expect(normalizeClientName('opencode')).toBe('opencode');
    });

    it('목록 밖 이름은 other, 값이 없거나 문자열이 아니면 unknown 이다', () => {
      expect(normalizeClientName('some-new-client')).toBe('other');
      expect(normalizeClientName('/home/jee1lee/secret')).toBe('other');
      expect(normalizeClientName('')).toBe('unknown');
      expect(normalizeClientName(undefined)).toBe('unknown');
      expect(normalizeClientName({ name: 'cursor' })).toBe('unknown');
    });
  });

  describe('normalizeClientVersion', () => {
    it('세 조각만 남기고 접미사를 버린다', () => {
      expect(normalizeClientVersion('2.1.327', 'claude-code')).toBe('2.1.327');
      expect(normalizeClientVersion('1.0.0-beta.3+build.9', 'cursor')).toBe('1.0.0');
      expect(normalizeClientVersion('01.002.0003', 'cursor')).toBe('1.2.3');
    });

    it('이름이 other 또는 unknown 이면 버전은 빈 문자열이다 (행 수 상한)', () => {
      expect(normalizeClientVersion('1.2.3', 'other')).toBe('');
      expect(normalizeClientVersion('1.2.3', 'unknown')).toBe('');
    });

    it('모양이 맞지 않으면 빈 문자열이다', () => {
      expect(normalizeClientVersion('/home/jee1lee/secret', 'cursor')).toBe('');
      expect(normalizeClientVersion('v1.2.3', 'cursor')).toBe('');
      expect(normalizeClientVersion('1.2', 'cursor')).toBe('');
      expect(normalizeClientVersion(123, 'cursor')).toBe('');
    });
  });

  describe('normalizeTool', () => {
    const registered = new Set(['recall', 'remember', 'search_local']);

    it('등록된 이름은 그대로, 아니면 other 다', () => {
      expect(normalizeTool('recall', registered)).toBe('recall');
      expect(normalizeTool('search_local', registered)).toBe('search_local');
      expect(normalizeTool('not_a_tool', registered)).toBe('other');
    });

    it('모양이 맞아도 등록되지 않은 값(프로젝트 이름, 16진 토큰)은 other 다', () => {
      expect(normalizeTool('memento', registered)).toBe('other');
      expect(normalizeTool('a3f9c2e17b4d8a60', registered)).toBe('other');
    });

    it('경로와 공백, 대문자, 문자열이 아닌 값은 other 다', () => {
      expect(normalizeTool('/home/jee1lee/x', registered)).toBe('other');
      expect(normalizeTool('re call', registered)).toBe('other');
      expect(normalizeTool('Recall', registered)).toBe('other');
      expect(normalizeTool(undefined, registered)).toBe('other');
    });
  });

  describe('normalizeErrorCode', () => {
    it('허용 목록의 코드는 그대로, 그 밖은 -1 이다', () => {
      expect(normalizeErrorCode(0)).toBe(0);
      expect(normalizeErrorCode(-32602)).toBe(-32602);
      expect(normalizeErrorCode(-32601)).toBe(-32601);
      expect(normalizeErrorCode(-32022)).toBe(-1);
      expect(normalizeErrorCode(-32700)).toBe(-1);
      expect(normalizeErrorCode('boom')).toBe(-1);
    });
  });

  describe('sanitizeClientNameForLog', () => {
    it('소문자 영숫자와 .-_ 만 남기고 40자로 자른다', () => {
      expect(sanitizeClientNameForLog('My Client/1.0 (x)')).toBe('myclient1.0x');
      expect(sanitizeClientNameForLog('a'.repeat(100))).toHaveLength(40);
      expect(sanitizeClientNameForLog(42)).toBe('');
    });
  });
});
