/**
 * 매직 넘버 검색 스크립트 테스트
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { supportsTsxSubprocess } from './supports-tsx-subprocess.js';

const onCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const tsxUnavailable = !supportsTsxSubprocess();

describe.skipIf(onCi || tsxUnavailable)('check-magic-numbers 스크립트', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'check-magic-numbers.ts');

  it('스크립트가 정상적으로 실행됨', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'memento-magic-numbers-'));
    const outputPath = join(outputDir, 'magic-numbers.json');

    // Given: 스크립트 경로
    // When: 스크립트 실행
    // Then: 에러 없이 실행됨
    expect(() => {
      execSync(`npx tsx ${scriptPath} --format=json --output=${outputPath}`, { 
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }).not.toThrow();

    rmSync(outputDir, { recursive: true, force: true });
  });

  it('JSON 형식 출력', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'memento-magic-numbers-'));
    const outputPath = join(outputDir, 'magic-numbers.json');

    // Given: JSON 형식 옵션
    // When: 스크립트 실행
    execSync(`npx tsx ${scriptPath} --format=json --output=${outputPath}`, { 
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    // Then: JSON 형식으로 출력됨
    const output = readFileSync(outputPath, 'utf-8');
    const result = JSON.parse(output);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('files');

    rmSync(outputDir, { recursive: true, force: true });
  });

  it('CSV 형식 출력', () => {
    // Given: CSV 형식 옵션
    // When: 스크립트 실행
    const output = execSync(`npx tsx ${scriptPath} --format=csv`, { 
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    // Then: CSV 형식으로 출력됨
    const lines = output.trim().split('\n');
    expect(lines[0]).toContain('file,count,priority');
  });
});
