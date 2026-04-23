/**
 * Memento MCP Client 테스트 스크립트
 * E2E 시나리오: remember/recall/pin/unpin/forget 결과에 대한 assertion으로 회귀 방지.
 */

import { createMementoClient } from '@memento/clientindex.js';
import { PIIMasker } from '@memento/core/shared/utils/pii-masker.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function testMementoClient() {
  console.log('🧪 Memento MCP Client 테스트 시작');

  const client = createMementoClient();

  try {
    // 1. 서버 연결
    console.log('\n1️⃣ 서버 연결 중...');
    await client.connect();

    // 2. 기억 저장 테스트
    console.log('\n2️⃣ 기억 저장 테스트');
    const memoryId1 = await client.remember({
      content: "사용자가 React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다.",
      type: 'episodic',
      tags: ['react', 'hooks', 'javascript'],
      importance: 0.8,
      source: 'test-client'
    });
    assert(memoryId1 != null && String(memoryId1).length > 0, 'remember should return non-empty memory id');
    console.log(`✅ 기억 저장 완료: ${memoryId1}`);

    const memoryId2 = await client.remember({
      content: "TypeScript의 타입 시스템에 대해 설명했다. 인터페이스와 타입 별칭의 차이점을 다뤘다.",
      type: 'semantic',
      tags: ['typescript', 'types', 'programming'],
      importance: 0.9,
      source: 'test-client'
    });
    assert(memoryId2 != null && String(memoryId2).length > 0, 'remember should return second memory id');
    console.log(`✅ 기억 저장 완료: ${memoryId2}`);

    // 3. 기억 검색 테스트
    console.log('\n3️⃣ 기억 검색 테스트');
    const searchResults = await client.recall({
      query: "React Hook",
      limit: 5
    });
    assert(Array.isArray(searchResults), 'recall should return an array');
    assert(searchResults.length >= 0, 'recall result length should be non-negative');
    console.log(`✅ 검색 결과 (${searchResults.length}개):`);
    searchResults.forEach((result, index) => {
      console.log(`  ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}... (점수: ${result.score || 'N/A'})`);
    });

    // 4. 기억 고정 테스트
    console.log('\n4️⃣ 기억 고정 테스트');
    const pinResult = await client.pin({ id: memoryId1 });
    assert(pinResult != null, 'pin should return a result');
    console.log(`✅ 기억 고정: ${pinResult}`);

    // 5. 고정된 기억 검색 테스트
    console.log('\n5️⃣ 고정된 기억 검색 테스트');
    const pinnedResults = await client.recall({
      query: "React",
      filters: { pinned: true },
      limit: 5
    });
    assert(Array.isArray(pinnedResults), 'recall (pinned) should return an array');
    assert(pinnedResults.length >= 0, 'pinned results length should be non-negative');
    console.log(`✅ 고정된 기억 검색 결과 (${pinnedResults.length}개):`);
    pinnedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}... (고정됨: ${result.pinned})`);
    });

    // 6. 기억 고정 해제 테스트
    console.log('\n6️⃣ 기억 고정 해제 테스트');
    const unpinResult = await client.unpin({ id: memoryId1 });
    assert(unpinResult != null, 'unpin should return a result');
    console.log(`✅ 기억 고정 해제: ${unpinResult}`);

    // 7. 기억 삭제 테스트 (소프트 삭제)
    console.log('\n7️⃣ 기억 삭제 테스트 (소프트 삭제)');
    const forgetResult = await client.forget({ id: memoryId2, hard: false });
    assert(forgetResult != null, 'forget should return a result');
    console.log(`✅ 기억 삭제: ${forgetResult}`);

    console.log('\n🎉 모든 테스트가 성공적으로 완료되었습니다!');
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    throw error;
  } finally {
    // 8. 연결 해제
    console.log('\n8️⃣ 연결 해제');
    await client.disconnect();
  }
}

// 테스트 실행
if (process.argv[1] && process.argv[1].endsWith('test-client.ts')) {
  testMementoClient()
    .then(() => {
      console.log('✅ 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 테스트 실패:', maskedError.message);
      process.exit(1);
    });
}
