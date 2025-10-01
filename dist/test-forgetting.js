/**
 * 망각 정책 기능 테스트
 * 망각 알고리즘과 간격 반복 테스트
 */
import { createMementoClient } from './client/index.js';
async function testForgettingFunctionality() {
    console.log('🧠 망각 정책 기능 테스트 시작');
    const client = createMementoClient();
    try {
        // 1. 서버 연결
        console.log('\n1️⃣ 서버 연결 중...');
        await client.connect();
        // 2. 다양한 기억 저장 (망각 테스트용)
        console.log('\n2️⃣ 망각 테스트용 기억 저장');
        const memories = [
            {
                content: "오래된 작업 기억: 프로젝트 초기 설정 작업을 완료했습니다.",
                type: 'working',
                tags: ['old', 'setup', 'completed'],
                importance: 0.3, // 낮은 중요도
                source: 'test'
            },
            {
                content: "중요한 에피소드 기억: 사용자가 중요한 질문을 했고, 상세히 답변했습니다.",
                type: 'episodic',
                tags: ['important', 'user', 'question'],
                importance: 0.9, // 높은 중요도
                source: 'test'
            },
            {
                content: "최근 학습 내용: 새로운 기술 스택에 대해 학습했습니다.",
                type: 'semantic',
                tags: ['learning', 'technology', 'recent'],
                importance: 0.7,
                source: 'test'
            },
            {
                content: "오래된 프로시저: 특정 작업을 수행하는 방법을 기록했습니다.",
                type: 'procedural',
                tags: ['procedure', 'old', 'method'],
                importance: 0.4, // 중간 중요도
                source: 'test'
            },
            {
                content: "중복된 내용: 이미 저장된 내용과 유사한 정보입니다.",
                type: 'episodic',
                tags: ['duplicate', 'similar'],
                importance: 0.2, // 낮은 중요도
                source: 'test'
            }
        ];
        const memoryIds = [];
        for (const memory of memories) {
            const id = await client.remember(memory);
            memoryIds.push(id);
            console.log(`✅ 저장됨: ${id.substring(0, 20)}... - ${memory.content.substring(0, 40)}...`);
            // 시간 간격을 두고 저장 (망각 알고리즘 테스트용)
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        // 3. 망각 통계 조회
        console.log('\n3️⃣ 망각 통계 조회');
        try {
            const stats = await client.callTool('forgetting_stats', {});
            console.log('📊 망각 통계:');
            console.log(`   총 메모리: ${stats.stats?.totalMemories || 0}개`);
            console.log(`   망각 후보: ${stats.stats?.forgetCandidates || 0}개`);
            console.log(`   리뷰 후보: ${stats.stats?.reviewCandidates || 0}개`);
            console.log(`   평균 망각 점수: ${stats.stats?.averageForgetScore?.toFixed(3) || 'N/A'}`);
            console.log(`   메모리 분포:`, stats.stats?.memoryDistribution || {});
        }
        catch (error) {
            console.error(`   ❌ 망각 통계 조회 실패: ${error}`);
        }
        // 4. 드라이런 모드로 메모리 정리 테스트
        console.log('\n4️⃣ 드라이런 모드 메모리 정리 테스트');
        try {
            const dryRunResult = await client.callTool('cleanup_memory', { dry_run: true });
            console.log('🔍 드라이런 분석 결과:');
            console.log(`   모드: ${dryRunResult.mode}`);
            console.log(`   총 메모리: ${dryRunResult.stats?.totalMemories || 0}개`);
            console.log(`   망각 후보: ${dryRunResult.stats?.forgetCandidates || 0}개`);
            console.log(`   리뷰 후보: ${dryRunResult.stats?.reviewCandidates || 0}개`);
            console.log(`   평균 망각 점수: ${dryRunResult.stats?.averageForgetScore?.toFixed(3) || 'N/A'}`);
            console.log(`   메모리 분포:`, dryRunResult.stats?.memoryDistribution || {});
        }
        catch (error) {
            console.error(`   ❌ 드라이런 테스트 실패: ${error}`);
        }
        // 5. 실제 메모리 정리 실행 (선택적)
        console.log('\n5️⃣ 실제 메모리 정리 실행');
        try {
            const cleanupResult = await client.callTool('cleanup_memory', { dry_run: false });
            console.log('🧹 메모리 정리 결과:');
            console.log(`   모드: ${cleanupResult.mode}`);
            console.log(`   소프트 삭제: ${cleanupResult.result?.summary?.actualSoftDeletes || 0}개`);
            console.log(`   하드 삭제: ${cleanupResult.result?.summary?.actualHardDeletes || 0}개`);
            console.log(`   리뷰 처리: ${cleanupResult.result?.summary?.actualReviews || 0}개`);
            console.log(`   총 처리: ${cleanupResult.result?.totalProcessed || 0}개`);
            if (cleanupResult.result?.softDeleted?.length > 0) {
                console.log(`   소프트 삭제된 메모리: ${cleanupResult.result.softDeleted.join(', ')}`);
            }
            if (cleanupResult.result?.hardDeleted?.length > 0) {
                console.log(`   하드 삭제된 메모리: ${cleanupResult.result.hardDeleted.join(', ')}`);
            }
        }
        catch (error) {
            console.error(`   ❌ 메모리 정리 실행 실패: ${error}`);
        }
        // 6. 정리 후 상태 확인
        console.log('\n6️⃣ 정리 후 상태 확인');
        try {
            const finalStats = await client.callTool('forgetting_stats', {});
            console.log('📊 정리 후 망각 통계:');
            console.log(`   총 메모리: ${finalStats.stats?.totalMemories || 0}개`);
            console.log(`   망각 후보: ${finalStats.stats?.forgetCandidates || 0}개`);
            console.log(`   평균 망각 점수: ${finalStats.stats?.averageForgetScore?.toFixed(3) || 'N/A'}`);
        }
        catch (error) {
            console.error(`   ❌ 정리 후 통계 조회 실패: ${error}`);
        }
        // 7. 남은 메모리 검색 테스트
        console.log('\n7️⃣ 남은 메모리 검색 테스트');
        try {
            const searchResults = await client.recall({ query: "기억", limit: 10 });
            console.log(`🔍 검색 결과: ${searchResults.length}개`);
            searchResults.forEach((result, index) => {
                console.log(`   ${index + 1}. [${result.type}] ${result.content.substring(0, 50)}...`);
            });
        }
        catch (error) {
            console.error(`   ❌ 검색 테스트 실패: ${error}`);
        }
        console.log('\n🎉 망각 정책 기능 테스트 완료!');
    }
    catch (error) {
        console.error('❌ 테스트 실패:', error);
    }
    finally {
        await client.disconnect();
    }
}
// 테스트 실행
if (process.argv[1] && process.argv[1].endsWith('test-forgetting.ts')) {
    testForgettingFunctionality()
        .then(() => {
        console.log('✅ 망각 테스트 완료');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ 망각 테스트 실패:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=test-forgetting.js.map