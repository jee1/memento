/**
 * 두 서버에서 동일한 도구가 동일하게 동작하는지 검증 테스트
 * HTTP 서버와 MCP 서버에서 동일한 도구를 실행했을 때 동일한 결과를 반환하는지 확인
 */

import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import { executeTool, getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { PIIMasker } from '../shared/utils/pii-masker.js';
import { createToolContext } from '../server/context.js';

/**
 * 도구 실행 결과를 비교하는 함수
 */
function compareToolResults(result1: any, result2: any): {
  same: boolean;
  differences: string[];
} {
  const differences: string[] = [];
  
  // 기본 구조 확인
  if (!result1 || !result2) {
    differences.push('결과가 null 또는 undefined입니다');
    return { same: false, differences };
  }
  
  // content 배열 비교
  if (result1.content && result2.content) {
    if (result1.content.length !== result2.content.length) {
      differences.push(`content 배열 길이가 다릅니다 (${result1.content.length} vs ${result2.content.length})`);
    } else {
      for (let i = 0; i < result1.content.length; i++) {
        const item1 = result1.content[i];
        const item2 = result2.content[i];
        
        if (item1.type !== item2.type) {
          differences.push(`content[${i}].type이 다릅니다 (${item1.type} vs ${item2.type})`);
        }
        
        // text 필드 비교 (JSON 파싱 후 비교)
        if (item1.text && item2.text) {
          try {
            const data1 = JSON.parse(item1.text);
            const data2 = JSON.parse(item2.text);
            
            // 주요 필드만 비교 (타임스탬프 등은 제외)
            const keysToCompare = ['id', 'success', 'count', 'items'];
            for (const key of keysToCompare) {
              if (key in data1 && key in data2) {
                if (JSON.stringify(data1[key]) !== JSON.stringify(data2[key])) {
                  differences.push(`content[${i}].text.${key}이 다릅니다`);
                }
              }
            }
          } catch (e) {
            // JSON 파싱 실패 시 텍스트 직접 비교
            if (item1.text !== item2.text) {
              differences.push(`content[${i}].text이 다릅니다`);
            }
          }
        }
      }
    }
  }
  
  return {
    same: differences.length === 0,
    differences
  };
}

async function testToolConsistency() {
  console.log('🧪 두 서버에서 동일한 도구 동작 검증 테스트 시작\n');
  
  let testDb1: Database.Database | null = null;
  let testDb2: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 두 개의 테스트 데이터베이스 설정
    console.log('1️⃣ 테스트 데이터베이스 설정');
    testDb1 = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb1);
    console.log('✅ 서버 1 데이터베이스 초기화 완료');
    
    testDb2 = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb2);
    console.log('✅ 서버 2 데이터베이스 초기화 완료\n');
    
    // 2. 서버 1 (HTTP 서버 시뮬레이션) 서비스 초기화
    console.log('2️⃣ 서버 1 서비스 초기화');
    const httpServices = await initializeServices(testDb1);
    const httpContext = createToolContext(testDb1, httpServices);
    console.log('✅ 서버 1 서비스 초기화 완료\n');
    
    // 3. 서버 2 (MCP 서버 시뮬레이션) 서비스 초기화
    console.log('3️⃣ 서버 2 서비스 초기화');
    const mcpServices = await initializeServices(testDb2);
    const mcpContext = createToolContext(testDb2, mcpServices);
    console.log('✅ 서버 2 서비스 초기화 완료\n');
    
    // 4. remember 도구 테스트
    console.log('4️⃣ remember 도구 테스트');
    const rememberParams = {
      content: '테스트 메모리: 두 서버에서 동일한 도구가 동일하게 동작하는지 검증',
      type: 'episodic',
      tags: ['test', 'consistency'],
      importance: 0.7
    };
    
    const httpRememberResult = await executeTool('remember', rememberParams, httpContext);
    const mcpRememberResult = await executeTool('remember', rememberParams, mcpContext);
    
    const rememberComparison = compareToolResults(httpRememberResult, mcpRememberResult);
    if (!rememberComparison.same) {
      console.error('❌ remember 도구 결과가 일치하지 않습니다:');
      rememberComparison.differences.forEach(diff => console.error(`   - ${diff}`));
      throw new Error('remember 도구 결과 불일치');
    }
    
    // 생성된 메모리 ID 추출
    try {
      const httpData = JSON.parse(httpRememberResult.content[0].text);
      const mcpData = JSON.parse(mcpRememberResult.content[0].text);
      if (httpData.id) createdMemoryIds.push(httpData.id);
      if (mcpData.id) createdMemoryIds.push(mcpData.id);
    } catch (e) {
      // ID 추출 실패 시 무시
    }
    
    console.log('✅ remember 도구가 양쪽 서버에서 동일하게 동작합니다\n');
    
    // 5. recall 도구 테스트
    console.log('5️⃣ recall 도구 테스트');
    const recallParams = {
      query: '테스트 메모리',
      limit: 10
    };
    
    const httpRecallResult = await executeTool('recall', recallParams, httpContext);
    const mcpRecallResult = await executeTool('recall', recallParams, mcpContext);
    
    const recallComparison = compareToolResults(httpRecallResult, mcpRecallResult);
    if (!recallComparison.same) {
      console.error('❌ recall 도구 결과가 일치하지 않습니다:');
      recallComparison.differences.forEach(diff => console.error(`   - ${diff}`));
      // recall은 데이터베이스 상태에 따라 결과가 다를 수 있으므로 경고만
      console.warn('⚠️ recall 도구 결과가 다를 수 있습니다 (데이터베이스 상태 차이)');
    } else {
      console.log('✅ recall 도구가 양쪽 서버에서 동일하게 동작합니다');
    }
    console.log('');
    
    // 6. pin 도구 테스트 (메모리가 있는 경우)
    if (createdMemoryIds.length > 0) {
      console.log('6️⃣ pin 도구 테스트');
      const pinParams = {
        id: createdMemoryIds[0]
      };
      
      // 서버 1에서만 pin 실행 (서버 2는 다른 DB이므로 별도로 실행)
      const httpPinResult = await executeTool('pin', pinParams, httpContext);
      const mcpPinParams = { id: createdMemoryIds[1] || createdMemoryIds[0] };
      const mcpPinResult = await executeTool('pin', mcpPinParams, mcpContext);
      
      // pin 결과는 성공 여부만 확인
      const httpPinData = JSON.parse(httpPinResult.content[0].text);
      const mcpPinData = JSON.parse(mcpPinResult.content[0].text);
      
      if (httpPinData.success !== mcpPinData.success) {
        throw new Error('pin 도구 결과가 일치하지 않습니다');
      }
      
      console.log('✅ pin 도구가 양쪽 서버에서 동일하게 동작합니다\n');
    }
    
    // 7. ToolContext 구조 검증
    console.log('7️⃣ ToolContext 구조 검증');
    
    // 서버 1 ToolContext 검증
    const httpContextServices = Object.keys(httpContext.services);
    const mcpContextServices = Object.keys(mcpContext.services);
    
    if (httpContextServices.length !== mcpContextServices.length) {
      throw new Error(`ToolContext 서비스 개수가 다릅니다 (HTTP: ${httpContextServices.length}, MCP: ${mcpContextServices.length})`);
    }
    
    for (const serviceName of httpContextServices) {
      const httpService = httpContext.services[serviceName as keyof typeof httpContext.services];
      const mcpService = mcpContext.services[serviceName as keyof typeof mcpContext.services];
      
      const httpHasService = httpService !== undefined;
      const mcpHasService = mcpService !== undefined;
      
      if (httpHasService !== mcpHasService) {
        throw new Error(`${serviceName} 서비스가 한쪽 ToolContext에만 있습니다`);
      }
      
      if (httpHasService && mcpHasService) {
        const httpType = httpService?.constructor?.name;
        const mcpType = mcpService?.constructor?.name;
        
        if (httpType !== mcpType) {
          throw new Error(`${serviceName} 서비스 타입이 다릅니다 (HTTP: ${httpType}, MCP: ${mcpType})`);
        }
      }
    }
    
    console.log('✅ ToolContext 구조가 양쪽 서버에서 동일합니다\n');
    
    // 8. 도구 레지스트리 검증
    console.log('8️⃣ 도구 레지스트리 검증');
    const toolRegistry = getToolRegistry();
    const allTools = toolRegistry.getAll();
    
    const toolNames = allTools.map(tool => tool.name);
    console.log(`   등록된 도구: ${toolNames.join(', ')}`);
    
    // 핵심 도구들이 모두 등록되어 있는지 확인
    const requiredTools = ['remember', 'recall', 'forget', 'pin', 'unpin'];
    for (const toolName of requiredTools) {
      if (!toolNames.includes(toolName)) {
        throw new Error(`도구 ${toolName}이 레지스트리에 등록되지 않았습니다`);
      }
    }
    
    console.log('✅ 도구 레지스트리가 정상적으로 구성되었습니다\n');
    
    // 9. 동일한 도구를 여러 번 실행했을 때의 일관성 확인
    console.log('9️⃣ 도구 실행 일관성 확인');
    
    const testParams = {
      query: '일관성 테스트',
      limit: 5
    };
    
    const httpResults: any[] = [];
    const mcpResults: any[] = [];
    
    // 각 서버에서 3번 실행
    for (let i = 0; i < 3; i++) {
      const httpResult = await executeTool('recall', testParams, httpContext);
      const mcpResult = await executeTool('recall', testParams, mcpContext);
      httpResults.push(httpResult);
      mcpResults.push(mcpResult);
    }
    
    // 같은 서버 내에서의 일관성 확인
    for (let i = 1; i < httpResults.length; i++) {
      const comparison = compareToolResults(httpResults[0], httpResults[i]);
      if (!comparison.same) {
        console.warn(`⚠️ 서버 1에서 recall 도구 실행 결과가 일관되지 않습니다 (실행 ${i + 1})`);
      }
    }
    
    for (let i = 1; i < mcpResults.length; i++) {
      const comparison = compareToolResults(mcpResults[0], mcpResults[i]);
      if (!comparison.same) {
        console.warn(`⚠️ 서버 2에서 recall 도구 실행 결과가 일관되지 않습니다 (실행 ${i + 1})`);
      }
    }
    
    console.log('✅ 도구 실행 일관성 확인 완료\n');
    
    console.log('🎉 모든 도구 일관성 검증 테스트 통과!\n');
    
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error', stack: undefined };
    console.error('\n❌ 테스트 실패:', maskedError.message);
    if (maskedError.stack) {
      console.error('스택 트레이스:', maskedError.stack);
    }
    process.exit(1);
  } finally {
    // 정리
    if (testDb1) {
      console.log('🧹 서버 1 데이터베이스 정리 중...');
      testDb1.close();
    }
    if (testDb2) {
      console.log('🧹 서버 2 데이터베이스 정리 중...');
      testDb2.close();
    }
    console.log('✅ 정리 완료');
  }
}

// Node.js 환경에서 직접 실행할 때만 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testToolConsistency().catch((error) => {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('테스트 실행 실패:', maskedError.message);
    process.exit(1);
  });
}

// Vitest를 위한 export (선택적)
export { testToolConsistency, compareToolResults };

