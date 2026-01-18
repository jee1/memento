/**
 * 작업 내용을 기억으로 저장하는 스크립트
 */

import Database from 'better-sqlite3';
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { initializeServices } from '../src/server/bootstrap.js';
import { executeTool } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/types.js';
import { createToolContext } from '../src/server/context.js';

async function saveWorkMemory() {
  console.log('💾 작업 내용을 기억으로 저장 중...\n');

  let db: Database.Database | null = null;

  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    console.log(`✅ 데이터베이스 초기화 완료\n`);

    // 서비스 초기화
    console.log('2️⃣ 서비스 초기화');
    const services = await initializeServices(db);
    const context = createToolContext(db, services);
    console.log('✅ 서비스 초기화 완료\n');

    // Episodic Memory: 작업 완료 기록
    console.log('3️⃣ Episodic Memory 저장 (작업 완료 기록)');
    const episodicResult = await executeTool('remember', {
      content: `작업: 다중 임베딩 provider 검색 지원 기능 구현 완료
날짜: 2025-11-16
작업 범위: 작업 1.0~6.0 모두 완료

주요 구현 내용:
- 다중 provider 감지 기능 구현 (detectAllStoredEmbeddingProviders)
- 병렬 다중 provider 검색 구현 (Promise.allSettled, 타임아웃 처리)
- 결과 통합 및 정규화 로직 (Min-Max 정규화, 중복 제거, 재랭킹)
- Provider 필터링 옵션 추가 (recall 도구에 provider_filter 파라미터)
- 마이그레이션 도구 구현 (migrate-embeddings-tool)
- 성능 벤치마크 및 회귀 테스트 작성

주요 변경 파일:
- src/algorithms/hybrid-search-engine.ts (다중 provider 검색 로직)
- src/tools/recall-tool.ts (provider_filter 옵션)
- src/tools/migrate-embeddings-tool.ts (마이그레이션 도구)
- src/test/multi-provider-search-performance-benchmark.ts (성능 벤치마크)
- src/test/test-single-provider-regression.ts (회귀 테스트)

테스트 결과: 모든 테스트 통과`,
      type: 'episodic',
      tags: ['completed', 'multi-provider-search', 'feature-implementation'],
      importance: 0.9,
      source: 'memento-development'
    }, context);

    if (episodicResult && episodicResult.content) {
      console.log('✅ Episodic Memory 저장 완료\n');
    } else {
      console.log('⚠️ Episodic Memory 저장 실패\n');
    }

    // Semantic Memory: 재사용 가능한 지식
    console.log('4️⃣ Semantic Memory 저장 (다중 Provider 검색 아키텍처)');
    const semanticResult = await executeTool('remember', {
      content: `다중 임베딩 provider 환경에서 검색 기능을 구현할 때의 핵심 설계 원칙:

1. Provider 감지: detectAllStoredEmbeddingProviders()로 모든 provider 통계 조회
2. 병렬 검색: Promise.allSettled()로 모든 provider 동시 검색, 실패해도 계속 진행
3. 타임아웃 처리: 각 provider 2초 hard timeout, 전체 3초 maximum timeout
4. 결과 정규화: Provider별 Min-Max 정규화로 점수 범위 통일 (0-1)
5. 중복 제거: memory_id 기준으로 최고 점수만 유지
6. 재랭킹: 정규화된 점수로 최종 결과 정렬

핵심 구현:
- HybridSearchEngine.executeVecSearch(): 병렬 검색 및 결과 통합
- Min-Max 정규화: max_score === min_score edge case 처리 (모두 1.0으로 설정)
- Provider 필터링: provider_filter 옵션으로 특정 provider만 검색 가능

성능 기준:
- 단일 provider: 평균 500ms 이하
- 다중 provider 병렬: 단일 provider의 1.5배 이하 권장

관련 파일:
- src/algorithms/hybrid-search-engine.ts
- src/tools/recall-tool.ts
- src/tools/migrate-embeddings-tool.ts`,
      type: 'semantic',
      tags: ['best-practice', 'knowledge', 'architecture', 'multi-provider'],
      importance: 0.8,
      source: 'memento-development'
    }, context);

    if (semanticResult && semanticResult.content) {
      console.log('✅ Semantic Memory 저장 완료\n');
    } else {
      console.log('⚠️ Semantic Memory 저장 실패\n');
    }

    // Procedural Memory: 마이그레이션 도구 사용법
    console.log('5️⃣ Procedural Memory 저장 (마이그레이션 도구 사용 절차)');
    const proceduralResult = await executeTool('remember', {
      content: JSON.stringify({
        task_goal: '기존 기억을 새로운 임베딩 provider로 재임베딩',
        steps: [
          'migrate_embeddings 도구 호출',
          'source_provider와 target_provider 지정 (source는 선택적)',
          'batch_size 설정 (기본 100개)',
          'dry_run 모드로 먼저 테스트 (dry_run: true)',
          '실제 마이그레이션 실행 (dry_run: false)',
          '결과 확인 (total_count, success_count, failed_count)'
        ],
        reflection_notes: {
          best_practices: [
            'dry_run으로 먼저 테스트하여 영향 범위 확인',
            'source_provider와 target_provider가 동일하면 에러 발생',
            '기존 임베딩은 유지되고 새 provider 임베딩이 추가됨',
            '실패한 메모리는 스킵되고 전체 작업은 계속 진행'
          ],
          common_errors: [
            'source_provider === target_provider: 재임베딩 불필요 에러',
            '임베딩 생성 실패 시 해당 메모리만 스킵'
          ]
        }
      }),
      type: 'procedural',
      tags: ['procedure', 'migration', 'embedding'],
      importance: 0.7,
      source: 'memento-development'
    }, context);

    if (proceduralResult && proceduralResult.content) {
      console.log('✅ Procedural Memory 저장 완료\n');
    } else {
      console.log('⚠️ Procedural Memory 저장 실패\n');
    }

    console.log('✅ 모든 기억 저장 완료!\n');

  } catch (error) {
    console.error('❌ 기억 저장 실패:', error);
    process.exit(1);
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('save-work-memory')) {
  saveWorkMemory();
}

export { saveWorkMemory };
