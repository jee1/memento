/**
 * @memento/client 고급 사용법 예제
 * 
 * 이 예제는 Memento 클라이언트 라이브러리의 고급 기능들을 보여줍니다.
 */

import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';

async function advancedUsageExample() {
  console.log('🚀 Memento 클라이언트 고급 사용법 예제\n');

  const client = new MementoClient({
    serverUrl: 'http://localhost:8080',
    apiKey: 'your-api-key',
    logLevel: 'debug',
    retryCount: 5,
    timeout: 15000
  });

  try {
    await client.connect();
    console.log('✅ 서버에 연결되었습니다\n');

    const manager = new MemoryManager(client);
    const injector = new ContextInjector(client);

    // 1. 프로젝트별 기억 관리
    console.log('📁 프로젝트별 기억 관리');
    const projectId = 'memento-client-dev';
    
    // 프로젝트 기억들 생성
    const projectMemories = await manager.createBatch([
      {
        content: 'Memento 클라이언트 라이브러리 설계 완료',
        type: 'episodic',
        project_id: projectId,
        importance: 0.9,
        tags: ['project', 'design', 'milestone']
      },
      {
        content: 'TypeScript 인터페이스 정의 및 타입 안전성 확보',
        type: 'procedural',
        project_id: projectId,
        importance: 0.8,
        tags: ['typescript', 'implementation', 'type-safety']
      },
      {
        content: 'HTTP 클라이언트와 WebSocket 통신 구현',
        type: 'procedural',
        project_id: projectId,
        importance: 0.7,
        tags: ['networking', 'http', 'websocket']
      }
    ]);

    console.log(`프로젝트 기억 ${projectMemories.length}개 생성 완료\n`);

    // 2. 고급 검색 기능
    console.log('🔍 고급 검색 기능');
    
    // 태그로 검색
    const tagResults = await manager.searchByTags(['typescript', 'implementation']);
    console.log(`태그 검색 결과: ${tagResults.total_count}개`);
    
    // 유사 기억 검색
    const similarMemories = await manager.findSimilar(projectMemories[0].id, 3);
    console.log(`유사 기억 검색 결과: ${similarMemories.total_count}개`);
    
    // 관련 기억 검색
    const relatedMemories = await manager.findRelated(projectMemories[1].id, 3);
    console.log(`관련 기억 검색 결과: ${relatedMemories.total_count}개\n`);

    // 3. 기억 관리 및 업데이트
    console.log('✏️ 기억 관리 및 업데이트');
    
    // 기억 업데이트
    const updatedMemory = await manager.update(projectMemories[0].id, {
      importance: 0.95,
      tags: ['project', 'design', 'milestone', 'completed']
    });
    console.log(`기억 업데이트 완료: ${updatedMemory.id}`);
    
    // 태그 추가
    await manager.addTags(projectMemories[1].id, ['completed', 'tested']);
    console.log('태그 추가 완료');
    
    // 중요도 설정
    await manager.setImportance(projectMemories[2].id, 0.85);
    console.log('중요도 설정 완료\n');

    // 4. 컨텍스트 주입 고급 기능
    console.log('💭 컨텍스트 주입 고급 기능');
    
    // 대화 컨텍스트 주입
    const conversationContext = await injector.injectConversationContext(
      '프로젝트 진행 상황에 대해 질문',
      800
    );
    console.log('대화 컨텍스트:');
    console.log(conversationContext.content);
    console.log('');

    // 작업 컨텍스트 주입
    const taskContext = await injector.injectTaskContext(
      'TypeScript 개발 작업',
      projectId,
      1000
    );
    console.log('작업 컨텍스트:');
    console.log(taskContext.content);
    console.log('');

    // 학습 컨텍스트 주입
    const learningContext = await injector.injectLearningContext(
      '프로그래밍 개념 학습',
      1200
    );
    console.log('학습 컨텍스트:');
    console.log(learningContext.content);
    console.log('');

    // 5. 기억 관계 생성
    console.log('🔗 기억 관계 생성');
    
    // 파생 관계 생성
    const linkResult = await client.link(
      projectMemories[0].id,
      projectMemories[1].id,
      'derived_from'
    );
    console.log(`기억 관계 생성 완료: ${linkResult.link_id}`);
    
    // 중복 관계 생성
    const duplicateLink = await client.link(
      projectMemories[1].id,
      projectMemories[2].id,
      'duplicates'
    );
    console.log(`중복 관계 생성 완료: ${duplicateLink.link_id}\n`);

    // 6. 피드백 시스템
    console.log('👍 피드백 시스템');
    
    // 유용한 피드백
    await client.feedback(projectMemories[0].id, true, '매우 유용한 정보였습니다', 0.9);
    console.log('유용한 피드백 등록 완료');
    
    // 도움이 되지 않는 피드백
    await client.feedback(projectMemories[2].id, false, '정보가 부족합니다', 0.3);
    console.log('피드백 등록 완료\n');

    // 7. 기억 내보내기
    console.log('📤 기억 내보내기');
    
    // JSON 형식으로 내보내기
    const jsonExport = await client.export('json', {
      project_id: projectId
    });
    console.log(`JSON 내보내기 완료: ${jsonExport.count}개 항목`);
    
    // Markdown 형식으로 내보내기
    const markdownExport = await client.export('markdown', {
      type: ['episodic', 'procedural']
    });
    console.log(`Markdown 내보내기 완료: ${markdownExport.count}개 항목\n`);

    // 8. 통계 및 분석
    console.log('📊 통계 및 분석');
    
    const stats = await manager.getStats();
    console.log('전체 통계:');
    console.log(`  총 기억 수: ${stats.total}`);
    console.log(`  타입별 분포:`);
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`    ${type}: ${count}개`);
    });
    console.log(`  공개 범위별 분포:`);
    Object.entries(stats.byPrivacyScope).forEach(([scope, count]) => {
      console.log(`    ${scope}: ${count}개`);
    });
    console.log(`  고정된 기억: ${stats.pinned}개`);
    console.log(`  최근 기억: ${stats.recent}개`);
    
    // 인기 태그 조회
    const popularTags = await manager.getPopularTags(5);
    console.log('\n인기 태그:');
    popularTags.forEach((tag, index) => {
      console.log(`  ${index + 1}. ${tag.tag}: ${tag.count}회`);
    });
    console.log('');

    // 9. 이벤트 리스닝
    console.log('👂 이벤트 리스닝');
    
    client.on('memory:created', (memory) => {
      console.log(`새 기억 생성: ${memory.id}`);
    });
    
    client.on('memory:updated', (memory) => {
      console.log(`기억 업데이트: ${memory.id}`);
    });
    
    client.on('memory:deleted', (memoryId) => {
      console.log(`기억 삭제: ${memoryId}`);
    });
    
    client.on('error', (error) => {
      console.error(`에러 발생: ${error.message}`);
    });

    // 10. 배치 작업
    console.log('⚡ 배치 작업');
    
    // 여러 기억 일괄 고정
    const memoryIds = projectMemories.map(m => m.id);
    const pinnedCount = await manager.pinBatch(memoryIds, true);
    console.log(`${pinnedCount}개 기억이 고정되었습니다`);
    
    // 여러 기억 일괄 삭제 (소프트 삭제)
    const deleteCount = await manager.deleteBatch([memoryIds[2]], false);
    console.log(`${deleteCount}개 기억이 삭제되었습니다\n`);

    // 11. 서버 상태 확인
    console.log('🏥 서버 상태 확인');
    const health = await client.healthCheck();
    console.log('서버 상태:');
    console.log(`  상태: ${health.status}`);
    console.log(`  버전: ${health.version}`);
    console.log(`  가동 시간: ${health.uptime}초`);
    console.log(`  데이터베이스: ${health.database.status}`);
    console.log(`  검색: ${health.search.status}`);
    console.log(`  임베딩 사용 가능: ${health.search.embedding_available}\n`);

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    await client.disconnect();
    console.log('🔌 연결이 해제되었습니다');
  }
}

// 예제 실행
if (require.main === module) {
  advancedUsageExample().catch(console.error);
}

export { advancedUsageExample };
