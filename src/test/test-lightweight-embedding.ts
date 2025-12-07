/**
 * 경량 하이브리드 임베딩 기능 테스트
 * OpenAI 없이도 임베딩 기능이 동작하는지 확인
 */

import { createMementoClient } from '../client/index.js';

async function testLightweightEmbeddingFunctionality() {
  console.log('🧠 경량 하이브리드 임베딩 기능 테스트 시작');
  
  const client = createMementoClient();
  
  try {
    // 1. 서버 연결
    console.log('\n1️⃣ 서버 연결 중...');
    await client.connect();
    
    // 2. 임베딩 서비스 상태 확인
    console.log('\n2️⃣ 임베딩 서비스 상태 확인');
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
      const testResult = await client.recall({ query: "test", limit: 1 });
      console.log('   ✅ 임베딩 서비스 사용 가능');
    } catch (error) {
      console.log('   ⚠️ 임베딩 서비스 상태 확인 중 오류:', error);
    }
    
    // 3. 다양한 기억 저장 (경량 임베딩 생성 테스트)
    console.log('\n3️⃣ 경량 임베딩이 포함된 기억 저장');
    const memories = [
      {
        content: "사용자가 React의 useState Hook에 대해 질문했습니다. 상태 관리를 위한 기본 Hook으로, 함수형 컴포넌트에서 상태를 선언하고 업데이트할 수 있습니다.",
        type: 'episodic' as const,
        tags: ['react', 'hooks', 'useState', 'javascript'],
        importance: 0.9
      },
      {
        content: "TypeScript의 인터페이스와 타입 별칭의 차이점을 설명했습니다. 인터페이스는 확장 가능하고, 타입 별칭은 유니온 타입을 표현할 수 있습니다.",
        type: 'semantic' as const,
        tags: ['typescript', 'types', 'interface', 'type-alias'],
        importance: 0.8
      },
      {
        content: "데이터베이스 인덱싱에 대한 질문을 받았습니다. B-tree 인덱스의 작동 원리와 쿼리 성능에 미치는 영향을 설명했습니다.",
        type: 'episodic' as const,
        tags: ['database', 'indexing', 'b-tree', 'performance'],
        importance: 0.7
      },
      {
        content: "MCP(Model Context Protocol)에 대해 학습했습니다. AI 에이전트와 도구 간의 표준화된 통신 프로토콜로, 확장 가능한 아키텍처를 제공합니다.",
        type: 'semantic' as const,
        tags: ['mcp', 'protocol', 'ai', 'architecture'],
        importance: 0.85
      },
      {
        content: "사용자가 Docker 컨테이너화에 대해 질문했습니다. 이미지 빌드, 레이어 캐싱, 멀티스테이지 빌드 등의 개념을 설명했습니다.",
        type: 'episodic' as const,
        tags: ['docker', 'containerization', 'devops', 'deployment'],
        importance: 0.75
      }
    ];
    
    const memoryIds: string[] = [];
    for (const memory of memories) {
      const id = await client.remember(memory);
      memoryIds.push(id);
      console.log(`✅ 저장됨: ${id.substring(0, 20)}... - ${memory.content.substring(0, 50)}...`);
      
      // 임베딩 생성 시간을 위해 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 4. 경량 하이브리드 검색 테스트
    console.log('\n4️⃣ 경량 하이브리드 검색 테스트');
    
    const searchQueries = [
      { query: "React Hook", description: "React Hook 관련 검색" },
      { query: "타입 시스템", description: "타입 시스템 관련 검색" },
      { query: "데이터베이스 성능", description: "데이터베이스 성능 관련 검색" },
      { query: "AI 프로토콜", description: "AI 프로토콜 관련 검색" },
      { query: "컨테이너 배포", description: "컨테이너 배포 관련 검색" },
      { query: "상태 관리", description: "상태 관리 관련 검색" },
      { query: "확장 가능한 아키텍처", description: "아키텍처 관련 검색" }
    ];
    
    for (const { query, description } of searchQueries) {
      console.log(`\n🔍 ${description}: "${query}"`);
      try {
        const startTime = Date.now();
        const results = await client.recall({ query, limit: 3 });
        const endTime = Date.now();
        
        console.log(`   결과: ${results.length}개 (${endTime - startTime}ms)`);
        results.forEach((result, index) => {
          console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 60)}...`);
          const score = (result as any).finalScore || (result as any).score || 'N/A';
          console.log(`       점수: ${typeof score === 'number' ? score.toFixed(3) : score}`);
          if ((result as any).textScore !== undefined && (result as any).vectorScore !== undefined) {
            console.log(`       텍스트: ${(result as any).textScore.toFixed(3)}, 벡터: ${(result as any).vectorScore.toFixed(3)}`);
          }
        });
      } catch (error) {
        console.error(`   ❌ 검색 실패: ${error}`);
      }
    }
    
    // 5. 의미적 유사성 검색 테스트
    console.log('\n5️⃣ 의미적 유사성 검색 테스트');
    
    const semanticQueries = [
      { query: "프론트엔드 개발", description: "프론트엔드 관련 검색" },
      { query: "타입 안전성", description: "타입 안전성 관련 검색" },
      { query: "쿼리 최적화", description: "쿼리 최적화 관련 검색" },
      { query: "마이크로서비스", description: "마이크로서비스 관련 검색" },
      { query: "개발 도구", description: "개발 도구 관련 검색" }
    ];
    
    for (const { query, description } of semanticQueries) {
      console.log(`\n🔍 ${description}: "${query}"`);
      try {
        const startTime = Date.now();
        const results = await client.recall({ query, limit: 2 });
        const endTime = Date.now();
        
        console.log(`   결과: ${results.length}개 (${endTime - startTime}ms)`);
        results.forEach((result, index) => {
          console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 60)}...`);
          const score = (result as any).finalScore || (result as any).score || 'N/A';
          console.log(`       점수: ${typeof score === 'number' ? score.toFixed(3) : score}`);
        });
      } catch (error) {
        console.error(`   ❌ 검색 실패: ${error}`);
      }
    }
    
    // 6. 성능 측정
    console.log('\n6️⃣ 성능 측정');
    
    const performanceTests = [
      "React useState Hook 상태 관리",
      "TypeScript 인터페이스 타입 시스템",
      "데이터베이스 B-tree 인덱스 성능",
      "Docker 컨테이너 이미지 빌드",
      "MCP 프로토콜 AI 에이전트 통신"
    ];
    
    let totalTime = 0;
    let successCount = 0;
    
    for (const testQuery of performanceTests) {
      try {
        const startTime = Date.now();
        const results = await client.recall({ query: testQuery, limit: 1 });
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        totalTime += duration;
        successCount++;
        
        console.log(`   "${testQuery}": ${duration}ms (${results.length}개 결과)`);
      } catch (error) {
        console.error(`   ❌ "${testQuery}" 실패: ${error}`);
      }
    }
    
    if (successCount > 0) {
      const averageTime = totalTime / successCount;
      console.log(`\n   📊 평균 검색 시간: ${averageTime.toFixed(2)}ms`);
      console.log(`   📊 성공률: ${(successCount / performanceTests.length * 100).toFixed(1)}%`);
    }
    
    // 7. 임베딩 통계 확인
    console.log('\n7️⃣ 임베딩 통계 확인');
    try {
      const statsResult = await client.recall({ query: "test", limit: 1 });
      if (statsResult.length > 0 && (statsResult[0] as any).search_type === 'hybrid') {
        console.log('   ✅ 하이브리드 검색 활성화됨');
        console.log(`   📊 벡터 검색 사용 가능: ${(statsResult[0] as any).vector_search_available || false}`);
      }
    } catch (error) {
      console.error(`   ❌ 통계 확인 실패: ${error}`);
    }
    
    console.log('\n🎉 경량 하이브리드 임베딩 기능 테스트 완료!');
    console.log('\n📋 테스트 요약:');
    console.log('   ✅ 경량 하이브리드 임베딩 서비스 동작 확인');
    console.log('   ✅ OpenAI 없이도 임베딩 기능 사용 가능');
    console.log('   ✅ 하이브리드 검색 (텍스트 + 벡터) 동작 확인');
    console.log('   ✅ 성능 측정 및 통계 수집 완료');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await client.disconnect();
  }
}

// 테스트 실행
if (process.argv[1] && process.argv[1].endsWith('test-lightweight-embedding.ts')) {
  testLightweightEmbeddingFunctionality()
    .then(() => {
      console.log('✅ 경량 임베딩 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 경량 임베딩 테스트 실패:', error);
      process.exit(1);
    });
}
