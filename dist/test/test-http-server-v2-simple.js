/**
 * HTTP 서버 v2 간단한 테스트
 */
import { startServer, cleanup, __test } from '../server/http-server.js';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import Database from 'better-sqlite3';
async function testBasicFunctionality() {
    console.log('🧪 HTTP 서버 v2 간단한 테스트 시작');
    let testDb = null;
    let serverStarted = false;
    try {
        // 1. 테스트 데이터베이스 설정
        console.log('🗄️ 테스트 데이터베이스 설정 중...');
        testDb = new Database(':memory:'); // 메모리 데이터베이스 사용
        // 기본 스키마 생성
        testDb.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
        content TEXT NOT NULL,
        importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
        privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        pinned BOOLEAN DEFAULT FALSE,
        source TEXT,
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
        origin_trace TEXT,
        tags TEXT
      );
    `);
        // 2. 서버 의존성 설정
        const searchEngine = new SearchEngine();
        const hybridSearchEngine = new HybridSearchEngine();
        const embeddingService = new MemoryEmbeddingService();
        __test.setTestDependencies({
            database: testDb,
            searchEngine,
            hybridSearchEngine,
            embeddingService
        });
        // 3. 서버 시작
        console.log('🚀 HTTP 서버 v2 시작 중...');
        await startServer();
        serverStarted = true;
        // 서버 시작 대기
        console.log('⏳ 서버 시작 대기 중...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        // 4. 기본 테스트
        console.log('📋 헬스 체크 테스트...');
        const healthResponse = await fetch('http://localhost:9001/health');
        const healthData = await healthResponse.json();
        if (healthResponse.ok && healthData.status === 'healthy') {
            console.log('✅ 헬스 체크 성공');
        }
        else {
            throw new Error('헬스 체크 실패');
        }
        // 5. 도구 목록 테스트
        console.log('📋 도구 목록 테스트...');
        const toolsResponse = await fetch('http://localhost:9001/tools');
        const toolsData = await toolsResponse.json();
        if (toolsResponse.ok && toolsData.tools && toolsData.tools.length === 5) {
            console.log(`✅ 도구 목록 성공 (${toolsData.tools.length}개 도구)`);
        }
        else {
            throw new Error('도구 목록 조회 실패');
        }
        // 6. remember 도구 테스트
        console.log('📝 remember 도구 테스트...');
        const rememberResponse = await fetch('http://localhost:9001/tools/remember', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: 'HTTP 서버 v2 간단한 테스트를 위한 기억입니다.',
                type: 'episodic',
                importance: 0.8
            })
        });
        const rememberData = await rememberResponse.json();
        if (rememberResponse.ok && rememberData.result && rememberData.result.memory_id) {
            console.log(`✅ remember 성공: ${rememberData.result.memory_id}`);
        }
        else {
            throw new Error('remember 테스트 실패');
        }
        // 7. recall 도구 테스트
        console.log('🔍 recall 도구 테스트...');
        const recallResponse = await fetch('http://localhost:9001/tools/recall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'HTTP 서버 v2',
                limit: 5
            })
        });
        const recallData = await recallResponse.json();
        if (recallResponse.ok && recallData.result && recallData.result.items) {
            console.log(`✅ recall 성공: ${recallData.result.items.length}개 결과`);
        }
        else {
            throw new Error('recall 테스트 실패');
        }
        console.log('\n🎉 모든 기본 테스트 통과!');
    }
    catch (error) {
        console.error('\n❌ 테스트 실패:', error);
        throw error;
    }
    finally {
        // 정리
        if (serverStarted) {
            console.log('\n🧹 서버 정리 중...');
            await cleanup();
        }
        if (testDb) {
            console.log('🗄️ 테스트 데이터베이스 정리 중...');
            closeDatabase(testDb);
        }
        console.log('✅ 테스트 완료');
    }
}
// 테스트 실행
testBasicFunctionality().catch(console.error);
export { testBasicFunctionality };
//# sourceMappingURL=test-http-server-v2-simple.js.map