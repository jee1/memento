/**
 * Procedural Memory 필드 추출기
 * reflection_notes에서 workflow_name, skill_name, steps, trigger_conditions 추출
 */

import { logger } from './logger.js';
import { PIIMasker } from './pii-masker.js';
import type { FailureEvent } from '../types/failure-event.js';
import type { ReflectionNotes, ExtractedProceduralMemory } from './procedural-memory-extractor.types.js';

/**
 * reflection_notes에서 workflow_name 추출
 *
 * 추출 전략:
 * 1. original_task에서 워크플로우 이름 추출
 * 2. tool_name을 기반으로 워크플로우 이름 추출
 * 3. failure_description에서 키워드 추출
 */
export function extractWorkflowName(
  reflectionNotes: ReflectionNotes | Record<string, unknown>,
  event?: FailureEvent
): string | undefined {
  try {
    // 1. original_task에서 추출
    if (reflectionNotes?.original_task) {
      const task = reflectionNotes.original_task;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof task !== 'string') {
        logger.warn('original_task가 문자열이 아님', PIIMasker.maskObject({
          type: typeof task,
          value: task
        }));
        return undefined;
      }

      // "데이터 마이그레이션", "스키마 업데이트" 등의 패턴 추출
      const workflowPatterns = [
        /(?:데이터|스키마|마이그레이션|업데이트|생성|삭제|수정|변경)/,
        /(?:migration|update|create|delete|modify|change|schema|database)/i
      ];

      for (const pattern of workflowPatterns) {
        if (pattern.test(task)) {
          // 첫 번째 매칭된 키워드를 기반으로 워크플로우 이름 생성
          const match = task.match(/([가-힣a-zA-Z\s]+(?:마이그레이션|업데이트|생성|삭제|수정|변경|migration|update|create|delete|modify|change))/i);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }

      // original_task 자체를 워크플로우 이름으로 사용 (200자 제한)
      if (task.length <= 200) {
        return task.trim();
      }
      return task.substring(0, 200).trim() + '...';
    }

    // 2. event의 tool_name 기반 추출
    if (event?.tool_name) {
      const toolName = event.tool_name;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof toolName !== 'string') {
        logger.warn('event.tool_name이 문자열이 아님', PIIMasker.maskObject({
          type: typeof toolName,
          value: toolName
        }));
        return undefined;
      }

      // tool_name을 기반으로 워크플로우 이름 생성
      // 예: "remember-tool" -> "기억 저장", "recall-tool" -> "기억 조회"
      const toolToWorkflow: Record<string, string> = {
        'remember': '기억 저장',
        'recall': '기억 조회',
        'forget': '기억 삭제',
        'pin': '기억 고정',
        'unpin': '기억 고정 해제',
        'search': '기억 검색',
        'migrate': '데이터 마이그레이션',
        'backup': '데이터 백업',
        'restore': '데이터 복원'
      };

      for (const [key, value] of Object.entries(toolToWorkflow)) {
        if (toolName.toLowerCase().includes(key)) {
          return value;
        }
      }

      // 기본값: tool_name을 워크플로우 이름으로 사용
      return toolName;
    }

    // 3. failure_description에서 키워드 추출
    if (reflectionNotes?.failure_description) {
      const desc = reflectionNotes.failure_description;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof desc !== 'string') {
        logger.warn('failure_description이 문자열이 아님', PIIMasker.maskObject({
          type: typeof desc,
          value: desc
        }));
        return undefined;
      }

      const keywords = ['마이그레이션', '업데이트', '생성', '삭제', '수정', '변경'];
      for (const keyword of keywords) {
        if (desc.includes(keyword)) {
          return `데이터 ${keyword}`;
        }
      }
    }

    return undefined;
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.warn('workflow_name 추출 실패', PIIMasker.maskObject({
      error: maskedError.message
    }));
    return undefined;
  }
}

/**
 * reflection_notes에서 skill_name 추출
 *
 * 추출 전략:
 * 1. tool_name을 skill_name으로 사용
 * 2. failure_type 기반 추출
 * 3. suggested_improvements에서 스킬 추출
 */
export function extractSkillName(
  reflectionNotes: ReflectionNotes | Record<string, unknown>,
  event?: FailureEvent
): string | undefined {
  try {
    // 1. tool_name을 skill_name으로 사용
    if (event?.tool_name) {
      // 타입 안전성 체크
      if (typeof event.tool_name !== 'string') {
        logger.warn('event.tool_name이 문자열이 아님', PIIMasker.maskObject({
          type: typeof event.tool_name,
          value: event.tool_name
        }));
        return undefined;
      }
      return event.tool_name;
    }

    // 2. failure_type 기반 추출
    if (reflectionNotes?.failure_type) {
      const failureType = reflectionNotes.failure_type;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof failureType !== 'string') {
        logger.warn('failure_type이 문자열이 아님', PIIMasker.maskObject({
          type: typeof failureType,
          value: failureType
        }));
        return undefined;
      }

      const typeToSkill: Record<string, string> = {
        'tool_error': '도구 실행',
        'user_feedback': '사용자 피드백 처리',
        'metric_failure': '성능 모니터링'
      };

      return typeToSkill[failureType] || failureType;
    }

    // 3. suggested_improvements에서 스킬 추출
    if (reflectionNotes?.suggested_improvements) {
      const improvements = reflectionNotes.suggested_improvements;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof improvements !== 'string') {
        logger.warn('suggested_improvements가 문자열이 아님', PIIMasker.maskObject({
          type: typeof improvements,
          value: improvements
        }));
        return undefined;
      }

      const skillKeywords = ['검증', '최적화', '처리', '관리', '모니터링'];
      for (const keyword of skillKeywords) {
        if (improvements.includes(keyword)) {
          return `${keyword} 스킬`;
        }
      }
    }

    return undefined;
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.warn('skill_name 추출 실패', PIIMasker.maskObject({
      error: maskedError.message
    }));
    return undefined;
  }
}

/**
 * reflection_notes에서 steps 추출
 *
 * 추출 전략:
 * 1. suggested_improvements를 steps로 변환
 * 2. lessons_learned를 steps로 변환
 * 3. failure_description에서 단계 추출
 */
export function extractSteps(
  reflectionNotes: ReflectionNotes | Record<string, unknown>
): string | undefined {
  try {
    const steps: string[] = [];

    // 1. suggested_improvements를 steps로 변환
    if (reflectionNotes?.suggested_improvements) {
      const improvements = reflectionNotes.suggested_improvements;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof improvements === 'string') {
        // 문장 단위로 분리
        const sentences = improvements.split(/[.!?]\s+/).filter((s: string) => s.trim().length > 0);
        steps.push(...sentences.map((s: string) => s.trim()));
      } else {
        logger.warn('suggested_improvements가 문자열이 아님', PIIMasker.maskObject({
          type: typeof improvements,
          value: improvements
        }));
      }
    }

    // 2. lessons_learned를 steps로 변환
    if (reflectionNotes?.lessons_learned) {
      const lessons = reflectionNotes.lessons_learned;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof lessons === 'string') {
        const sentences = lessons.split(/[.!?]\s+/).filter((s: string) => s.trim().length > 0);
        steps.push(...sentences.map((s: string) => s.trim()));
      } else {
        logger.warn('lessons_learned가 문자열이 아님', PIIMasker.maskObject({
          type: typeof lessons,
          value: lessons
        }));
      }
    }

    // 3. failure_description에서 단계 추출 (선택적)
    if (reflectionNotes?.failure_description && steps.length === 0) {
      const desc = reflectionNotes.failure_description;

      // 타입 안전성 체크: 문자열이 아니면 건너뜀
      if (typeof desc === 'string') {
        // "단계", "절차", "순서" 등의 키워드가 있으면 추출
        if (desc.includes('단계') || desc.includes('절차') || desc.includes('순서')) {
          steps.push(desc);
        }
      } else {
        logger.warn('failure_description이 문자열이 아님', PIIMasker.maskObject({
          type: typeof desc,
          value: desc
        }));
      }
    }

    // steps가 비어있으면 기본값 생성
    if (steps.length === 0) {
      steps.push('에러 로그 분석');
      steps.push('근본 원인 파악');
      steps.push('개선 방안 수립');
      steps.push('재시도 또는 대안 실행');
    }

    // JSON 배열 문자열로 변환
    return JSON.stringify(steps);
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.warn('steps 추출 실패', PIIMasker.maskObject({
      error: maskedError.message
    }));
    return undefined;
  }
}

/**
 * 실패 이벤트 정보 기반 trigger_conditions 자동 생성
 *
 * 생성 전략:
 * 1. error_type 기반 조건 생성
 * 2. tool_name 기반 조건 생성
 * 3. error_message 키워드 기반 조건 생성
 * 4. context 정보 기반 조건 생성
 */
export function generateTriggerConditions(
  reflectionNotes: ReflectionNotes | Record<string, unknown>,
  event?: FailureEvent
): string | undefined {
  try {
    const conditions: Record<string, unknown> = {};

    // 1. error_type 기반 조건
    if (reflectionNotes?.failure_type) {
      const failureType = reflectionNotes.failure_type;
      // 타입 안전성 체크
      if (typeof failureType === 'string') {
        conditions.error_type = failureType;
      }
    } else if (event?.error_type) {
      // 타입 안전성 체크
      if (typeof event.error_type === 'string') {
        conditions.error_type = event.error_type;
      }
    }

    // 2. tool_name 기반 조건
    if (event?.tool_name) {
      // 타입 안전성 체크
      if (typeof event.tool_name === 'string') {
        conditions.tool_name = event.tool_name;
      }
    }

    // 3. error_message 키워드 기반 조건
    const errorMessage =
      (typeof reflectionNotes?.failure_description === 'string' ? reflectionNotes.failure_description : '') ||
      (typeof event?.error_message === 'string' ? event.error_message : '') ||
      '';
    const keywords: string[] = [];

    // 에러 메시지에서 중요한 키워드 추출 (문자열인 경우에만)
    if (typeof errorMessage === 'string' && errorMessage.length > 0) {
      const importantKeywords = [
        'validation', '검증', 'database', '데이터베이스', 'sqlite',
        'timeout', '타임아웃', 'permission', '권한', 'not found', '찾을 수 없음'
      ];

      for (const keyword of importantKeywords) {
        if (errorMessage.toLowerCase().includes(keyword.toLowerCase())) {
          keywords.push(keyword);
        }
      }
    }

    if (keywords.length > 0) {
      conditions.error_keywords = keywords;
    }

    // 4. context 정보 기반 조건
    if (event?.context) {
      const context = event.context;

      // execution_time_ms가 임계값을 초과한 경우
      if (context.execution_time_ms && context.execution_time_ms > 5000) {
        conditions.slow_execution = true;
        conditions.min_execution_time_ms = context.execution_time_ms;
      }

      // params 정보가 있는 경우
      if (context.params) {
        // 중요한 파라미터만 추출 (예: type, workflow_name 등)
        const importantParams = ['type', 'workflow_name', 'skill_name'];
        for (const param of importantParams) {
          if (context.params[param]) {
            conditions[`param_${param}`] = context.params[param];
          }
        }
      }
    }

    // 5. timestamp 기반 조건 (선택적) — string 또는 Date만 변환 (string[] 등은 제외)
    const ts = reflectionNotes?.timestamp;
    if (ts !== undefined && ts !== null) {
      if (ts instanceof Date) {
        conditions.timestamp_pattern = ts.toISOString().split('T')[0];
      } else if (typeof ts === 'string') {
        conditions.timestamp_pattern = new Date(ts).toISOString().split('T')[0];
      }
    }

    // 조건이 비어있으면 기본 조건 생성
    if (Object.keys(conditions).length === 0) {
      conditions.event = 'failure_detected';
      if (event?.tool_name) {
        conditions.tool = event.tool_name;
      }
    }

    // JSON 객체 문자열로 변환
    return JSON.stringify(conditions);
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.warn('trigger_conditions 생성 실패', PIIMasker.maskObject({
      error: maskedError.message
    }));
    return undefined;
  }
}

/**
 * reflection_notes에서 모든 procedural memory 필드 추출
 */
export function extractProceduralMemory(
  reflectionNotes: ReflectionNotes | Record<string, unknown>,
  event?: FailureEvent
): ExtractedProceduralMemory {
  const workflowName = extractWorkflowName(reflectionNotes, event);
  const skillName = extractSkillName(reflectionNotes, event);
  const steps = extractSteps(reflectionNotes);
  const triggerConditions = generateTriggerConditions(reflectionNotes, event);

  // task_goal 추출 (타입 안전성 체크)
  const taskGoal =
    (typeof reflectionNotes?.original_task === 'string' ? reflectionNotes.original_task : undefined) ||
    (typeof event?.original_task === 'string' ? event.original_task : undefined);

  return {
    workflow_name: workflowName,
    skill_name: skillName,
    steps,
    trigger_conditions: triggerConditions,
    task_goal: taskGoal
  };
}
