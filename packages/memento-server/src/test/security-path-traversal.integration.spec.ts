import { describe, expect, it } from 'vitest';
import {
  sanitizeFileName,
  validateFilePath,
} from '../../../memento-core/src/shared/utils/path-validator.js';

describe('path traversal hardening', () => {
  it.each([
    '../../etc/passwd',
    '..\\..\\windows\\system32',
    '/etc/passwd',
    'data/../../etc/passwd',
  ])('rejects unsafe path %j', (path) => {
    expect(validateFilePath(path)).toBe(false);
  });

  it('allows paths inside the configured data directory', () => {
    expect(validateFilePath('data/test.txt')).toBe(true);
  });

  it('removes unsafe filename characters', () => {
    const sanitized = sanitizeFileName('file<script>alert("xss")</script>.txt');

    expect(sanitized).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(sanitized).not.toMatch(/[<>"()]/);
  });

  it('uses a safe fallback for an empty filename', () => {
    expect(sanitizeFileName('')).toBe('file');
  });
});
