/**
 * Remember Procedure Tool - 절차 기억 전용 저장 엔드포인트 (Issue #57 Phase 2)
 *
 * 전용 엔드포인트·검증·로깅 분리. 저장 로직은 RememberTool의 procedural 경로를 재사용합니다.
 */

import { formatValidationErrors,validateReflectionNotes } from '../../../shared/utils/reflection-notes-schema.js';
import { validateProceduralMemoryFields } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';
import { RememberTool } from './remember-tool.js';

/** remember_procedure 입력 (procedural 전용 필드만, type 없음) */
interface _RememberProcedureParams {
  content: string;
  task_goal?: string | null;
  steps?: string | null;
  reflection_notes?: string | null;
  workflow_name?: string | null;
  skill_name?: string | null;
  trigger_conditions?: string | null;
  update_mode?: 'replace' | 'incremental' | 'versioned';
  tags?: string[];
  importance?: number;
  source?: string | null;
  privacy_scope?: 'private' | 'team' | 'public';
  /** 다중 에이전트 시 소유자 식별자 (미설정 시 context.agentId 사용) */
  owner_id?: string | null;
  /** Memori Attribution (Issue #87) */
  process_id?: string | null;
  session_id?: string | null;
}

export class RememberProcedureTool extends BaseTool {
  private readonly rememberTool: RememberTool;

  constructor() {
    super(
      'remember_procedure',
      'Procedural Memory만 저장하는 전용 엔드포인트입니다. workflow_name, skill_name, steps 등 절차 필드를 검증한 뒤 저장합니다.',
      {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '저장할 절차 설명 (필수)',
          },
          task_goal: { type: 'string', description: '작업 목표 (Procedural Memory용)' },
          steps: { type: 'string', description: '단계별 절차 (JSON 배열 문자열)' },
          reflection_notes: { type: 'string', description: 'Reflexion 기록 (JSON 객체 문자열)' },
          workflow_name: { type: 'string', description: '프로세스 이름 (예: 데이터 마이그레이션, API 배포)' },
          skill_name: { type: 'string', description: '기술/능력 이름 (예: 스키마 백업, 데이터 검증)' },
          trigger_conditions: { type: 'string', description: '트리거 조건 (JSON 객체 문자열)' },
          update_mode: {
            type: 'string',
            enum: ['replace', 'incremental', 'versioned'],
            description: '업데이트 모드: replace(교체), incremental(증분), versioned(버전 관리)',
          },
          tags: { type: 'array', items: { type: 'string' }, description: '태그 목록' },
          importance: { type: 'number', minimum: 0, maximum: 1, description: '중요도 (0-1)', default: 0.5 },
          source: { type: 'string', description: '출처' },
          privacy_scope: {
            type: 'string',
            enum: ['private', 'team', 'public'],
            description: '프라이버시 범위',
            default: 'private',
          },
          owner_id: {
            type: 'string',
            description: '다중 에이전트 시 소유자 식별자 (미설정 시 context.agentId 사용)',
          },
          process_id: {
            type: 'string',
            description: 'Memori Attribution: 프로세스(에이전트/프로그램) 식별자 (Issue #87, 미설정 시 context.processId 사용)',
          },
          session_id: {
            type: 'string',
            description: 'Memori Attribution: 세션(작업 흐름) 식별자 (Issue #87, 미설정 시 context.sessionId 사용)',
          },
        },
        required: ['content'],
      }
    );
    this.rememberTool = new RememberTool();
  }

  /**
   * Given: 유효한 procedural 파라미터와 context.
   * When: handle 호출.
   * Then: remember(type=procedural) 위임 후 memory_id·type 반환.
   *
   * Given: content 누락 또는 검증 실패.
   * When: handle 호출.
   * Then: invalid_params 또는 validation_failed 에러.
   */
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const raw = params as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
      return this.createErrorResult('invalid_params', 'params는 객체여야 합니다.');
    }

    const content = raw.content;
    if (content === undefined || content === null || (typeof content === 'string' && content.trim() === '')) {
      return this.createErrorResult('invalid_params', 'content는 필수이며 비어 있을 수 없습니다.');
    }

    // procedural 전용 검증 (workflow_name, skill_name, trigger_conditions)
    try {
      validateProceduralMemoryFields({
        workflow_name: raw.workflow_name as string | null | undefined,
        skill_name: raw.skill_name as string | null | undefined,
        trigger_conditions: raw.trigger_conditions as string | null | undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logWarning('Procedural 필드 검증 실패', { message });
      return this.createErrorResult('validation_failed', `Procedural Memory 필드 검증 실패: ${message}`);
    }

    // reflection_notes가 제공된 경우 JSON·스키마 검증
    const reflectionNotes = raw.reflection_notes;
    if (reflectionNotes !== undefined && reflectionNotes !== null && reflectionNotes !== '') {
      const str = typeof reflectionNotes === 'string' ? reflectionNotes : String(reflectionNotes);
      const result = validateReflectionNotes(str);
      if (!result.isValid) {
        const message = formatValidationErrors(result);
        this.logWarning('reflection_notes 검증 실패', { message });
        return this.createErrorResult('validation_failed', `reflection_notes 스키마 검증 실패:\n${message}`);
      }
    }

    if (!context.db) {
      return this.createErrorResult('database_unavailable', '데이터베이스를 사용할 수 없습니다.');
    }

    this.logInfo('remember_procedure 호출', {
      workflow_name: raw.workflow_name ?? null,
      skill_name: raw.skill_name ?? null,
    });

    const importance =
      typeof raw.importance === 'number' && raw.importance >= 0 && raw.importance <= 1
        ? raw.importance
        : 0.5;
    const privacy_scope: 'private' | 'team' | 'public' =
      raw.privacy_scope === 'team' || raw.privacy_scope === 'public' ? raw.privacy_scope : 'private';

    const owner_id =
      typeof raw.owner_id === 'string' && raw.owner_id.trim() !== ''
        ? raw.owner_id.trim()
        : context.agentId ?? undefined;
    const process_id =
      typeof raw.process_id === 'string' && raw.process_id.trim() !== ''
        ? raw.process_id.trim()
        : context.processId ?? undefined;
    const session_id =
      typeof raw.session_id === 'string' && raw.session_id.trim() !== ''
        ? raw.session_id.trim()
        : context.sessionId ?? undefined;
    const rememberParams = {
      ...raw,
      type: 'procedural' as const,
      content: typeof content === 'string' ? content : String(content),
      importance,
      privacy_scope,
      owner_id,
      process_id,
      session_id,
    };

    try {
      const result = await this.rememberTool.handle(rememberParams, context);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logError(err instanceof Error ? err : new Error(message), 'remember_procedure 위임 실패', {
        workflow_name: raw.workflow_name,
        skill_name: raw.skill_name,
      });
      return this.createErrorResult('save_failed', message);
    }
  }
}
