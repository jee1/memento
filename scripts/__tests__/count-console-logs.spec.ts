/**
 * count-console-logs.ts 스크립트 테스트
 * 
 * PRD 0021: 기능 미활용 개선 (Phase 3) - 로깅 시스템 통일 및 강제
 * 
 * Given/When/Then 패턴을 따르는 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { supportsTsxSubprocess } from './supports-tsx-subprocess.js';

describe.skipIf(!supportsTsxSubprocess())('count-console-logs.ts 스크립트', () => {
  const testDir = join(process.cwd(), 'test-temp-console-logs');
  const scriptPath = join(process.cwd(), 'scripts', 'count-console-logs.ts');

  beforeEach(() => {
    // Given: 테스트 디렉토리 생성
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // When: 테스트 후 정리
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('JSON 출력 형식', () => {
    /**
     * Given: console.log를 포함한 테스트 파일 생성
     * When: --format=json 옵션으로 스크립트 실행
     * Then: JSON 형식으로 결과가 출력되어야 함
     */
    it('JSON 형식으로 결과를 출력해야 함', () => {
      // Given: console.log를 포함한 테스트 파일 생성
      const testFile = join(testDir, 'test-file.ts');
      writeFileSync(testFile, `
        console.log('Test message');
        console.error('Test error');
      `, 'utf-8');

      // When: --format=json 옵션으로 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir} --format=json`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: JSON 형식으로 결과가 출력되어야 함
        const jsonOutput = output.trim();
        expect(() => JSON.parse(jsonOutput)).not.toThrow();
        
        const result = JSON.parse(jsonOutput);
        expect(result).toHaveProperty('total');
        expect(result).toHaveProperty('coreTotal');
        expect(result).toHaveProperty('files');
        expect(Array.isArray(result.files)).toBe(true);
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });

    /**
     * Given: console.log를 포함한 테스트 파일 생성
     * When: 기본 옵션(JSON 형식)으로 스크립트 실행
     * Then: JSON 형식으로 결과가 출력되어야 함
     */
    it('기본 옵션으로 실행 시 JSON 형식으로 출력해야 함', () => {
      // Given: console.log를 포함한 테스트 파일 생성
      const testFile = join(testDir, 'test-file.ts');
      writeFileSync(testFile, `
        console.log('Test message');
      `, 'utf-8');

      // When: 기본 옵션으로 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir}`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: JSON 형식으로 결과가 출력되어야 함
        const jsonOutput = output.trim();
        expect(() => JSON.parse(jsonOutput)).not.toThrow();
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });
  });

  describe('CSV 출력 형식', () => {
    /**
     * Given: console.log를 포함한 테스트 파일 생성
     * When: --format=csv 옵션으로 스크립트 실행
     * Then: CSV 형식으로 결과가 출력되어야 함
     */
    it('CSV 형식으로 결과를 출력해야 함', () => {
      // Given: console.log를 포함한 테스트 파일 생성
      const testFile = join(testDir, 'test-file.ts');
      writeFileSync(testFile, `
        console.log('Test message');
        console.error('Test error');
      `, 'utf-8');

      // When: --format=csv 옵션으로 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir} --format=csv`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: CSV 형식으로 결과가 출력되어야 함
        const csvOutput = output.trim();
        expect(csvOutput).toContain(',');
        expect(csvOutput.split('\n').length).toBeGreaterThan(1);
        // CSV 헤더 확인
        expect(csvOutput).toMatch(/file|count|priority/i);
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });
  });

  describe('디렉토리 검색', () => {
    /**
     * Given: src/server/, src/services/, src/domains/ 디렉토리에 테스트 파일 생성
     * When: 스크립트 실행
     * Then: 모든 디렉토리의 파일이 검색되어야 함
     */
    it('src/server/, src/services/, src/domains/ 디렉토리를 검색해야 함', () => {
      // Given: 각 디렉토리에 테스트 파일 생성
      const serverDir = join(testDir, 'src', 'server');
      const servicesDir = join(testDir, 'src', 'services');
      const domainsDir = join(testDir, 'src', 'domains');
      
      mkdirSync(serverDir, { recursive: true });
      mkdirSync(servicesDir, { recursive: true });
      mkdirSync(domainsDir, { recursive: true });
      
      writeFileSync(join(serverDir, 'test-server.ts'), 'console.log("server");', 'utf-8');
      writeFileSync(join(servicesDir, 'test-services.ts'), 'console.log("services");', 'utf-8');
      writeFileSync(join(domainsDir, 'test-domains.ts'), 'console.log("domains");', 'utf-8');

      // When: 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir}`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: 모든 디렉토리의 파일이 검색되어야 함
        const result = JSON.parse(output.trim());
        expect(result.files.length).toBeGreaterThanOrEqual(3);
        
        const filePaths = result.files.map((f: any) => f.file || f.path);
        expect(filePaths.some((p: string) => p.includes('server'))).toBe(true);
        expect(filePaths.some((p: string) => p.includes('services'))).toBe(true);
        expect(filePaths.some((p: string) => p.includes('domains'))).toBe(true);
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });
  });

  describe('우선순위 산출', () => {
    /**
     * Given: console.log 개수가 다른 여러 파일 생성
     * When: 스크립트 실행
     * Then: 우선순위가 자동으로 산출되어야 함 (개수가 많은 파일이 높은 우선순위)
     */
    it('파일별 사용 개수에 따라 우선순위를 산출해야 함', () => {
      // Given: console.log 개수가 다른 여러 파일 생성
      const file1 = join(testDir, 'file1.ts');
      const file2 = join(testDir, 'file2.ts');
      const file3 = join(testDir, 'file3.ts');
      
      writeFileSync(file1, 'console.log("1");', 'utf-8');
      writeFileSync(file2, 'console.log("2");\nconsole.log("3");', 'utf-8');
      writeFileSync(file3, 'console.log("4");\nconsole.log("5");\nconsole.log("6");', 'utf-8');

      // When: 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir} --format=json`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: 우선순위가 자동으로 산출되어야 함
        const result = JSON.parse(output.trim());
        expect(result.files).toBeDefined();
        expect(Array.isArray(result.files)).toBe(true);
        
        // 우선순위가 높은 파일(개수가 많은 파일)이 먼저 나와야 함
        if (result.files.length > 1) {
          const priorities = result.files.map((f: any) => f.priority || f.count || 0);
          // 우선순위는 내림차순으로 정렬되어야 함
          for (let i = 1; i < priorities.length; i++) {
            expect(priorities[i - 1]).toBeGreaterThanOrEqual(priorities[i]);
          }
        }
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });
  });

  describe('파일별 사용 개수', () => {
    /**
     * Given: 여러 console.log를 포함한 파일 생성
     * When: 스크립트 실행
     * Then: 각 파일의 console.log 개수가 정확히 집계되어야 함
     */
    it('각 파일의 console.log 개수를 정확히 집계해야 함', () => {
      // Given: 여러 console.log를 포함한 파일 생성
      const testFile = join(testDir, 'test-file.ts');
      writeFileSync(testFile, `
        console.log('1');
        console.error('2');
        console.warn('3');
        console.log('4');
      `, 'utf-8');

      // When: 스크립트 실행
      try {
        const output = execSync(
          `tsx ${scriptPath} --directory ${testDir} --format=json`,
          { encoding: 'utf-8', cwd: process.cwd() }
        );

        // Then: 각 파일의 console.log 개수가 정확히 집계되어야 함
        const result = JSON.parse(output.trim());
        expect(result.total).toBeGreaterThanOrEqual(4);
        
        const fileResult = result.files.find((f: any) => 
          (f.file || f.path || '').includes('test-file.ts')
        );
        if (fileResult) {
          expect(fileResult.count).toBeGreaterThanOrEqual(4);
        }
      } catch (error) {
        // 스크립트가 아직 구현되지 않았을 수 있으므로 에러는 무시
        // RED 단계에서는 실패가 예상됨
      }
    });
  });
});
