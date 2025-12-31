/**
 * 매직 넘버 검색 스크립트 테스트
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('check-magic-numbers 스크립트', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'check-magic-numbers.ts');

  it('스크립트가 정상적으로 실행됨', () => {
    // Given: 스크립트 경로
    // When: 스크립트 실행
    // Then: 에러 없이 실행됨
    expect(() => {
      execSync(`npx tsx ${scriptPath} --format=json`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    }).not.toThrow();
  });

  it('JSON 형식 출력', () => {
    // Given: JSON 형식 옵션
    // When: 스크립트 실행
    const output = execSync(`npx tsx ${scriptPath} --format=json`, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    // Then: JSON 형식으로 출력됨
    const result = JSON.parse(output);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('files');
  });

  it('CSV 형식 출력', () => {
    // Given: CSV 형식 옵션
    // When: 스크립트 실행
    const output = execSync(`npx tsx ${scriptPath} --format=csv`, { 
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    // Then: CSV 형식으로 출력됨
    const lines = output.trim().split('\n');
    expect(lines[0]).toContain('file,count,priority');
  });
});

