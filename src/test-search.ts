/**
 * 검색 기능 상세 테스트
 */

import { createMementoClient } from './client/index.js';

async function testSearchFunctionality() {
  console.log('🔍 검색 기능 상세 테스트 시작');
  
  const client = createMementoClient();
  
  try {
    // 1. 서버 연결
    console.log('\n1️⃣ 서버 연결 중...');
    await client.connect();
    
    // 2. 다양한 기억 저장
    console.log('\n2️⃣ 다양한 기억 저장');
    const memories = [
      {
        content: "React Hook에 대해 설명했다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리한다.",
        type: 'episodic' as const,
        tags: ['react', 'hooks', 'javascript'],
        importance: 0.8
      },
      {
        content: "TypeScript의 타입 시스템에 대해 설명했다. 인터페이스와 타입 별칭의 차이점을 다뤘다.",
        type: 'semantic' as const,
        tags: ['typescript', 'types', 'programming'],
        importance: 0.9
      },
      {
        content: "데이터베이스 최적화에 대해 질문받았다. 인덱싱과 쿼리 최적화 방법을 설명했다.",
        type: 'episodic' as const,
        tags: ['database', 'optimization', 'sql'],
        importance: 0.7
      },
      {
        content: "MCP 프로토콜에 대해 학습했다. Model Context Protocol은 AI 에이전트와 도구 간 통신을 위한 표준이다.",
        type: 'semantic' as const,
        tags: ['mcp', 'protocol', 'ai'],
        importance: 0.85
      }
    ];
    
    const memoryIds: string[] = [];
    for (const memory of memories) {
      const id = await client.remember(memory);
      memoryIds.push(id);
      console.log(`✅ 저장됨: ${id.substring(0, 20)}... - ${memory.content.substring(0, 30)}...`);
    }
    
    // 3. 다양한 검색 테스트
    console.log('\n3️⃣ 다양한 검색 테스트');
    
    const searchQueries = [
      { query: "React", description: "React 관련 검색" },
      { query: "TypeScript", description: "TypeScript 관련 검색" },
      { query: "데이터베이스", description: "데이터베이스 관련 검색" },
      { query: "MCP", description: "MCP 관련 검색" },
      { query: "Hook", description: "Hook 관련 검색" },
      { query: "타입", description: "타입 관련 검색" }
    ];
    
    for (const { query, description } of searchQueries) {
      console.log(`\n🔍 ${description}: "${query}"`);
      try {
        const results = await client.recall({ query, limit: 5 });
        console.log(`   결과: ${results.length}개`);
        results.forEach((result, index) => {
          console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}... (점수: ${result.score || 'N/A'})`);
        });
      } catch (error) {
        console.error(`   ❌ 검색 실패: ${error}`);
      }
    }
    
    // 4. 필터 검색 테스트
    console.log('\n4️⃣ 필터 검색 테스트');
    
    console.log('\n🔍 episodic 타입만 검색:');
    try {
      const episodicResults = await client.recall({
        query: "설명",
        filters: { type: ['episodic'] },
        limit: 5
      });
      console.log(`   결과: ${episodicResults.length}개`);
      episodicResults.forEach((result, index) => {
        console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}...`);
      });
    } catch (error) {
      console.error(`   ❌ 필터 검색 실패: ${error}`);
    }
    
    console.log('\n🔍 semantic 타입만 검색:');
    try {
      const semanticResults = await client.recall({
        query: "학습",
        filters: { type: ['semantic'] },
        limit: 5
      });
      console.log(`   결과: ${semanticResults.length}개`);
      semanticResults.forEach((result, index) => {
        console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}...`);
      });
    } catch (error) {
      console.error(`   ❌ 필터 검색 실패: ${error}`);
    }
    
    // 5. 태그 검색 테스트
    console.log('\n5️⃣ 태그 검색 테스트');
    
    const tagQueries = ['react', 'typescript', 'database', 'mcp'];
    for (const tag of tagQueries) {
      console.log(`\n🔍 "${tag}" 태그 검색:`);
      try {
        const results = await client.recall({
          query: tag,
          limit: 5
        });
        console.log(`   결과: ${results.length}개`);
        results.forEach((result, index) => {
          console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}... (태그: ${result.tags?.join(', ') || '없음'})`);
        });
      } catch (error) {
        console.error(`   ❌ 태그 검색 실패: ${error}`);
      }
    }
    
    console.log('\n🎉 검색 기능 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await client.disconnect();
  }
}

// 테스트 실행
if (process.argv[1] && process.argv[1].endsWith('test-search.ts')) {
  testSearchFunctionality()
    .then(() => {
      console.log('✅ 검색 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 검색 테스트 실패:', error);
      process.exit(1);
    });
}
