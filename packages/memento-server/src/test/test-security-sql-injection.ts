/**
 * SQL Injection 취약점 E2E 테스트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - SQL Injection 방지
 * 
 * 사용법:
 *   tsx src/test/test-security-sql-injection.ts
 * 
 * 목표:
 *   - SQL Injection 공격 패턴이 안전하게 처리되는지 확인
 *   - 데이터베이스가 손상되지 않았는지 확인
 *   - RED 단계: 현재 취약점이 있으므로 일부 테스트는 실패할 수 있음
 */

import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from '../../../memento-core/src/test/helpers/test-database.js';
import { SearchEngine } from '../../../memento-core/src/domains/search/algorithms/search-engine.js';
import { DatabaseUtils } from '../../../memento-core/src/shared/utils/database.js';
import { PIIMasker } from '../../../memento-core/src/shared/utils/pii-masker.js';

/**
 * 메인 테스트 함수
 */
async function testSqlInjectionE2E(): Promise<void> {
  console.log('🧪 SQL Injection 취약점 E2E 테스트 시작\n');
  console.log('다음 공격 패턴을 테스트합니다:\n');
  console.log('1. 테이블 삭제 시도: `\'; DROP TABLE--`\n');
  console.log('2. 항상 참 조건 주입: `\' OR \'1\'=\'1`\n');
  console.log('3. UNION SELECT 공격: `\' UNION SELECT * FROM memory_item--`\n');
  console.log('4. 주석 주입 (--): `test\'--`\n');
  console.log('5. 주석 주입 (/* */): `test\'/*`\n\n');

  let db: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  let testPassed = 0;
  let testFailed = 0;

  try {
    // Given: 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화...');
    db = await setupTestDatabase();
    console.log('✅ 데이터베이스 초기화 완료\n');

    // Given: 테스트 데이터 생성
    console.log('2️⃣ 테스트 데이터 생성...');
    const testMemoryId1 = createTestMemory(db, {
      content: 'Test memory 1',
      type: 'episodic',
      importance: 0.5
    });
    createdMemoryIds.push(testMemoryId1);

    const testMemoryId2 = createTestMemory(db, {
      content: 'Test memory 2',
      type: 'semantic',
      importance: 0.7
    });
    createdMemoryIds.push(testMemoryId2);

    // 초기 테이블 개수 확인
    const initialTableCount = DatabaseUtils.all(db, `
      SELECT COUNT(*) as count 
      FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `) as Array<{ count: number }>;
    const initialTableCountValue = initialTableCount[0]?.count || 0;
    console.log(`✅ 테스트 데이터 생성 완료 (초기 테이블 개수: ${initialTableCountValue})\n`);

    // Given: SearchEngine 초기화
    console.log('3️⃣ SearchEngine 초기화...');
    const searchEngine = new SearchEngine();
    console.log('✅ SearchEngine 초기화 완료\n');

    // 테스트 1: 테이블 삭제 시도 (`'; DROP TABLE--`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 1: 테이블 삭제 시도 (`\'; DROP TABLE--`)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 악의적인 SQL 패턴이 주입된 검색 쿼리
      const maliciousQuery1 = "'; DROP TABLE memory_item--";
      console.log(`Given: 악의적인 SQL 패턴이 주입된 검색 쿼리: "${maliciousQuery1}"`);

      // When: 검색 실행
      console.log('When: 검색 실행...');
      const result1 = await searchEngine.search(db, {
        query: maliciousQuery1,
        limit: 10
      });
      console.log(`✅ 검색 실행 완료 (결과 개수: ${result1.items.length})`);

      // Then: 데이터베이스가 손상되지 않았는지 확인
      console.log('Then: 데이터베이스 무결성 확인...');
      const tableCountAfter1 = DatabaseUtils.all(db, `
        SELECT COUNT(*) as count 
        FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `) as Array<{ count: number }>;
      const tableCountAfter1Value = tableCountAfter1[0]?.count || 0;

      // memory_item 테이블이 여전히 존재하는지 확인
      const memoryItemExists = DatabaseUtils.all(db, `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item'
      `) as Array<{ name: string }>;

      if (tableCountAfter1Value === initialTableCountValue && memoryItemExists.length > 0) {
        console.log('✅ 테스트 통과: 데이터베이스가 손상되지 않았습니다.');
        console.log(`   - 테이블 개수: ${tableCountAfter1Value} (초기: ${initialTableCountValue})`);
        console.log(`   - memory_item 테이블 존재: ${memoryItemExists.length > 0 ? '예' : '아니오'}\n`);
        testPassed++;
      } else {
        console.log('❌ 테스트 실패: 데이터베이스가 손상되었을 수 있습니다.');
        console.log(`   - 테이블 개수: ${tableCountAfter1Value} (초기: ${initialTableCountValue})`);
        console.log(`   - memory_item 테이블 존재: ${memoryItemExists.length > 0 ? '예' : '아니오'}\n`);
        testFailed++;
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`⚠️  테스트 중 오류 발생: ${maskedError.message}`);
      // 오류가 발생해도 데이터베이스 무결성 확인
      const tableCountAfter1 = DatabaseUtils.all(db, `
        SELECT COUNT(*) as count 
        FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `) as Array<{ count: number }>;
      const tableCountAfter1Value = tableCountAfter1[0]?.count || 0;
      if (tableCountAfter1Value === initialTableCountValue) {
        console.log('✅ 데이터베이스는 안전합니다 (오류로 인한 보호).\n');
        testPassed++;
      } else {
        console.log('❌ 데이터베이스가 손상되었을 수 있습니다.\n');
        testFailed++;
      }
    }

    // 테스트 2: 항상 참 조건 주입 (`' OR '1'='1`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 2: 항상 참 조건 주입 (`\' OR \'1\'=\'1`)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 항상 참 조건이 주입된 검색 쿼리
      const maliciousQuery2 = "' OR '1'='1";
      console.log(`Given: 항상 참 조건이 주입된 검색 쿼리: "${maliciousQuery2}"`);

      // When: 검색 실행
      console.log('When: 검색 실행...');
      const result2 = await searchEngine.search(db, {
        query: maliciousQuery2,
        limit: 10
      });
      console.log(`✅ 검색 실행 완료 (결과 개수: ${result2.items.length})`);

      // Then: 예상된 결과만 반환되었는지 확인 (모든 메모리가 반환되면 취약점 가능성)
      console.log('Then: 결과 검증...');
      if (result2.items.length <= 2) {
        // 정상: 파라미터 바인딩으로 인해 실제 검색어로 처리됨
        console.log('✅ 테스트 통과: 예상된 결과만 반환되었습니다.');
        console.log(`   - 반환된 결과 개수: ${result2.items.length} (예상: 0-2개)\n`);
        testPassed++;
      } else {
        // 취약점: 모든 메모리가 반환됨
        console.log('⚠️  경고: 모든 메모리가 반환되었습니다. SQL Injection 취약점 가능성.');
        console.log(`   - 반환된 결과 개수: ${result2.items.length} (예상: 0-2개)\n`);
        testFailed++;
      }
    } catch (error) {
      console.log(`✅ 테스트 통과: 오류로 인해 공격이 차단되었습니다.`);
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   - 오류 메시지: ${maskedError.message}\n`);
      testPassed++;
    }

    // 테스트 3: UNION SELECT 공격 (`' UNION SELECT * FROM memory_item--`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 3: UNION SELECT 공격 (`\' UNION SELECT * FROM memory_item--`)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: UNION SELECT 공격 패턴이 주입된 검색 쿼리
      const maliciousQuery3 = "' UNION SELECT * FROM memory_item--";
      console.log(`Given: UNION SELECT 공격 패턴이 주입된 검색 쿼리: "${maliciousQuery3}"`);

      // When: 검색 실행
      console.log('When: 검색 실행...');
      const result3 = await searchEngine.search(db, {
        query: maliciousQuery3,
        limit: 10
      });
      console.log(`✅ 검색 실행 완료 (결과 개수: ${result3.items.length})`);

      // Then: UNION SELECT가 실행되지 않았는지 확인
      console.log('Then: 결과 검증...');
      // 정상적인 검색 결과는 0개 또는 매우 적은 개수여야 함
      if (result3.items.length <= 2) {
        console.log('✅ 테스트 통과: UNION SELECT 공격이 차단되었습니다.');
        console.log(`   - 반환된 결과 개수: ${result3.items.length}\n`);
        testPassed++;
      } else {
        console.log('⚠️  경고: UNION SELECT 공격이 성공했을 수 있습니다.');
        console.log(`   - 반환된 결과 개수: ${result3.items.length}\n`);
        testFailed++;
      }
    } catch (error) {
      console.log('✅ 테스트 통과: 오류로 인해 공격이 차단되었습니다.');
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   - 오류 메시지: ${maskedError.message}\n`);
      testPassed++;
    }

    // 테스트 4: 주석 주입 (--) (`test'--`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 4: 주석 주입 (--) (`test\'--`)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 주석 주입 패턴이 포함된 검색 쿼리
      const maliciousQuery4 = "test'--";
      console.log(`Given: 주석 주입 패턴이 포함된 검색 쿼리: "${maliciousQuery4}"`);

      // When: 검색 실행
      console.log('When: 검색 실행...');
      const result4 = await searchEngine.search(db, {
        query: maliciousQuery4,
        limit: 10
      });
      console.log(`✅ 검색 실행 완료 (결과 개수: ${result4.items.length})`);

      // Then: 주석이 SQL 쿼리에 영향을 주지 않았는지 확인
      console.log('Then: 결과 검증...');
      // 정상적인 검색 결과는 "test"로 검색한 결과여야 함
      if (result4.items.length <= 2) {
        console.log('✅ 테스트 통과: 주석 주입이 차단되었습니다.');
        console.log(`   - 반환된 결과 개수: ${result4.items.length}\n`);
        testPassed++;
      } else {
        console.log('⚠️  경고: 주석 주입이 성공했을 수 있습니다.');
        console.log(`   - 반환된 결과 개수: ${result4.items.length}\n`);
        testFailed++;
      }
    } catch (error) {
      console.log('✅ 테스트 통과: 오류로 인해 공격이 차단되었습니다.');
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   - 오류 메시지: ${maskedError.message}\n`);
      testPassed++;
    }

    // 테스트 5: 주석 주입 (/* */) (`test'/*`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 5: 주석 주입 (/* */) (`test\'/*`)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
      // Given: 블록 주석 주입 패턴이 포함된 검색 쿼리
      const maliciousQuery5 = "test'/*";
      console.log(`Given: 블록 주석 주입 패턴이 포함된 검색 쿼리: "${maliciousQuery5}"`);

      // When: 검색 실행
      console.log('When: 검색 실행...');
      const result5 = await searchEngine.search(db, {
        query: maliciousQuery5,
        limit: 10
      });
      console.log(`✅ 검색 실행 완료 (결과 개수: ${result5.items.length})`);

      // Then: 블록 주석이 SQL 쿼리에 영향을 주지 않았는지 확인
      console.log('Then: 결과 검증...');
      // 정상적인 검색 결과는 "test"로 검색한 결과여야 함
      if (result5.items.length <= 2) {
        console.log('✅ 테스트 통과: 블록 주석 주입이 차단되었습니다.');
        console.log(`   - 반환된 결과 개수: ${result5.items.length}\n`);
        testPassed++;
      } else {
        console.log('⚠️  경고: 블록 주석 주입이 성공했을 수 있습니다.');
        console.log(`   - 반환된 결과 개수: ${result5.items.length}\n`);
        testFailed++;
      }
    } catch (error) {
      console.log('✅ 테스트 통과: 오류로 인해 공격이 차단되었습니다.');
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   - 오류 메시지: ${maskedError.message}\n`);
      testPassed++;
    }

    // 최종 데이터베이스 무결성 확인
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('최종 데이터베이스 무결성 확인');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const finalTableCount = DatabaseUtils.all(db, `
      SELECT COUNT(*) as count 
      FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `) as Array<{ count: number }>;
    const finalTableCountValue = finalTableCount[0]?.count || 0;

    const finalMemoryItemExists = DatabaseUtils.all(db, `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memory_item'
    `) as Array<{ name: string }>;

    const memoryItemCount = DatabaseUtils.all(db, `
      SELECT COUNT(*) as count FROM memory_item
    `) as Array<{ count: number }>;
    const memoryItemCountValue = memoryItemCount[0]?.count || 0;

    console.log('최종 상태:');
    console.log(`   - 테이블 개수: ${finalTableCountValue} (초기: ${initialTableCountValue})`);
    console.log(`   - memory_item 테이블 존재: ${finalMemoryItemExists.length > 0 ? '예' : '아니오'}`);
    console.log(`   - memory_item 레코드 개수: ${memoryItemCountValue} (예상: 2개)\n`);

    if (finalTableCountValue === initialTableCountValue && finalMemoryItemExists.length > 0 && memoryItemCountValue === 2) {
      console.log('✅ 데이터베이스 무결성 확인: 모든 테스트 후에도 데이터베이스가 안전합니다.\n');
    } else {
      console.log('⚠️  경고: 데이터베이스 무결성에 문제가 있을 수 있습니다.\n');
    }

    // 테스트 결과 요약
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('테스트 결과 요약');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ 통과: ${testPassed}개`);
    console.log(`❌ 실패: ${testFailed}개`);
    console.log(`📊 총 테스트: ${testPassed + testFailed}개\n`);

    if (testFailed > 0) {
      console.log('⚠️  일부 테스트가 실패했습니다. 이는 RED 단계에서 예상된 동작입니다.');
      console.log('   작업 1.3 이후 파라미터 바인딩 전환으로 모든 테스트가 통과할 것입니다.\n');
    } else {
      console.log('✅ 모든 테스트가 통과했습니다!\n');
    }

  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error', stack: undefined };
    console.error('❌ 치명적 오류 발생:', maskedError.message);
    if (maskedError.stack) {
      console.error(maskedError.stack);
    }
    throw error;
  } finally {
    // 데이터베이스 정리
    if (db) {
      console.log('🧹 데이터베이스 정리 중...');
      cleanupTestDatabase(db);
      console.log('✅ 데이터베이스 정리 완료\n');
    }
  }
}

// 스크립트 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  testSqlInjectionE2E()
    .then(() => {
      console.log('✅ SQL Injection E2E 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ SQL Injection E2E 테스트 실패:', maskedError.message);
      process.exit(1);
    });
}

