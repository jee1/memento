/**
 * Procedural Memory 매칭을 수행하는 클래스
 * workflow_name, skill_name, trigger_conditions와 쿼리/필터를 매칭하여 부스트 가중치를 결정합니다.
 * 
 * 단일 책임 원칙을 준수하여 HybridSearchEngine에서 분리되었습니다.
 */

import Database from 'better-sqlite3';
import type { HybridSearchQuery } from './hybrid-search-engine.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';
import type { IProceduralMemoryMatcher } from './hybrid-search-engine.js';

/**
 * Procedural Memory 매칭을 수행하는 클래스
 * 
 * Given: 데이터베이스와 메모리 ID 목록, 검색 쿼리가 제공됨
 * When: Procedural Memory 항목들을 조회하고 쿼리/필터와 매칭함
 * Then: 각 메모리 ID에 대한 매칭 결과를 반환함
 */
export class ProceduralMemoryMatcher implements IProceduralMemoryMatcher {
  /**
   * Given: 데이터베이스와 메모리 ID 목록, 검색 쿼리가 제공됨
   * When: Procedural Memory 항목들을 조회하고 쿼리/필터와 매칭함
   * Then: 각 메모리 ID에 대한 매칭 결과를 반환함
   * 
   * @param db - 데이터베이스 연결
   * @param memoryIds - 매칭할 메모리 ID 목록
   * @param query - 검색 쿼리 (선택적)
   * @returns 각 메모리 ID에 대한 매칭 결과 맵
   */
  fetchProceduralMemoryMatches(
    db: Database.Database,
    memoryIds: string[],
    query?: HybridSearchQuery
  ): Map<string, { workflow_name_match: boolean; skill_name_match: boolean; trigger_conditions_match: boolean }> {
    const matches = new Map<string, { workflow_name_match: boolean; skill_name_match: boolean; trigger_conditions_match: boolean }>();
    
    if (memoryIds.length === 0) {
      return matches;
    }
    
    // Mock 데이터베이스인 경우 빈 Map 반환 (테스트 환경에서 안전하게 처리)
    if (!db || typeof db.prepare !== 'function') {
      return matches;
    }
    
    try {
      // SQL Injection 방지: placeholders는 이미 ? 플레이스홀더로 구성되어 있어 안전함
      const placeholders = memoryIds.map(() => '?').join(',');
      const sql = 
        `SELECT id, workflow_name, skill_name, trigger_conditions ` +
        `FROM memory_item ` +
        `WHERE id IN (${placeholders}) ` +
        `AND (workflow_name IS NOT NULL OR skill_name IS NOT NULL OR trigger_conditions IS NOT NULL)`;
      const results = db.prepare(sql).all(...memoryIds) as Array<{
        id: string;
        workflow_name: string | null;
        skill_name: string | null;
        trigger_conditions: string | null;
      }>;
      
      // 쿼리와 필터 정보 추출
      const queryText = query?.query?.toLowerCase() || '';
      const filterWorkflowName = query?.filters?.workflow_name?.toLowerCase();
      const filterSkillName = query?.filters?.skill_name?.toLowerCase();
      const matchTriggerConditions = query?.match_trigger_conditions ?? false;
      
      results.forEach(row => {
        // workflow_name 매칭: 필터 또는 쿼리와 매칭
        // PRD: "매칭 시 가중치" - 실제 매칭이 있어야만 부스트 적용
        let workflowMatch = false;
        if (row.workflow_name) {
          const workflowLower = row.workflow_name.toLowerCase();
          if (filterWorkflowName) {
            // 필터가 있으면 정확히 일치해야 함
            workflowMatch = workflowLower === filterWorkflowName;
          } else if (queryText) {
            // 쿼리가 있으면 부분 매칭
            workflowMatch = workflowLower.includes(queryText) || queryText.includes(workflowLower);
          }
          // 쿼리와 필터가 모두 없으면 매칭하지 않음 (PRD: "매칭 시 가중치")
        }
        
        // skill_name 매칭: 필터 또는 쿼리와 매칭
        // PRD: "매칭 시 가중치" - 실제 매칭이 있어야만 부스트 적용
        let skillMatch = false;
        if (row.skill_name) {
          const skillLower = row.skill_name.toLowerCase();
          if (filterSkillName) {
            // 필터가 있으면 정확히 일치해야 함
            skillMatch = skillLower === filterSkillName;
          } else if (queryText) {
            // 쿼리가 있으면 부분 매칭
            skillMatch = skillLower.includes(queryText) || queryText.includes(skillLower);
          }
          // 쿼리와 필터가 모두 없으면 매칭하지 않음 (PRD: "매칭 시 가중치")
        }
        
        // trigger_conditions 매칭: match_trigger_conditions 플래그에 따라 처리
        // PRD: match_trigger_conditions=false일 때는 부스트 적용하지 않음
        // PRD: 구조화된 컨텍스트(예: tool_name, error_type, params)와 JSON 매칭 요구
        let triggerMatch = false;
        if (matchTriggerConditions && row.trigger_conditions) {
          try {
            const parsed = typeof row.trigger_conditions === 'string'
              ? JSON.parse(row.trigger_conditions)
              : row.trigger_conditions;
            
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              const triggerContext = query?.context;
              
              // 구조화된 컨텍스트가 제공된 경우: 키-값 기반 정확 매칭
              // 모든 키-값 쌍이 매칭되어야 함 (첫 번째 키만 맞으면 통과하는 문제 수정)
              if (triggerContext && Object.keys(triggerContext).length > 0) {
                // trigger_conditions의 모든 키-값 쌍이 컨텍스트와 매칭되는지 확인
                let allKeysMatch = true;
                for (const [key, value] of Object.entries(parsed)) {
                  const contextValue = triggerContext[key];
                  
                  // trigger_conditions에 있는 키가 컨텍스트에 없으면 매칭 실패
                  if (contextValue === undefined) {
                    allKeysMatch = false;
                    break;
                  }
                  
                  // 값이 객체인 경우 재귀적으로 비교
                  if (typeof value === 'object' && typeof contextValue === 'object' && value !== null && contextValue !== null) {
                    // 중첩 객체 매칭: context의 값이 trigger_conditions의 값과 부분적으로 일치하는지 확인
                    const valueStr = JSON.stringify(value).toLowerCase();
                    const contextStr = JSON.stringify(contextValue).toLowerCase();
                    if (!(valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
                      // 하나라도 매칭되지 않으면 실패
                      allKeysMatch = false;
                      break;
                    }
                  } else {
                    // 단순 값 매칭: 문자열로 변환하여 비교
                    const valueStr = String(value).toLowerCase();
                    const contextStr = String(contextValue).toLowerCase();
                    if (!(valueStr === contextStr || valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
                      // 하나라도 매칭되지 않으면 실패
                      allKeysMatch = false;
                      break;
                    }
                  }
                }
                // 모든 키/값 쌍이 매칭되었을 때만 triggerMatch = true
                triggerMatch = allKeysMatch;
              } else if (queryText) {
                // 구조화된 컨텍스트가 없는 경우: 쿼리 텍스트 기반 매칭 (fallback)
                // 쿼리 텍스트가 trigger_conditions의 키와 값 모두와 매칭되는지 확인
                // 키 매칭: tool_name, error_type, params 등 구조화된 필드명과 매칭
                const triggerKeys = Object.keys(parsed).map(k => k.toLowerCase());
                const triggerValues = Object.values(parsed).map(v => String(v).toLowerCase());
                
                // 키 또는 값 중 하나라도 쿼리와 매칭되면 통과
                const keyMatch = triggerKeys.some(k => k.includes(queryText) || queryText.includes(k));
                const valueMatch = triggerValues.some(v => v.includes(queryText) || queryText.includes(v));
                triggerMatch = keyMatch || valueMatch;
              }
              // 쿼리와 컨텍스트가 모두 없으면 매칭하지 않음 (PRD: "매칭 시 가중치")
            }
          } catch (error) {
            // JSON 파싱 실패 시 매칭 실패로 처리
            triggerMatch = false;
          }
        }
        // match_trigger_conditions가 false이면 항상 false
        
        matches.set(row.id, {
          workflow_name_match: workflowMatch,
          skill_name_match: skillMatch,
          trigger_conditions_match: triggerMatch
        });
      });
    } catch (error) {
      // 에러 발생 시 빈 Map 반환 (procedural memory boost 없음)
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.warn('Procedural Memory 매칭 정보 조회 실패', {
        error: maskedError.message
      });
    }
    
    return matches;
  }
}
