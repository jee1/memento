/**
 * Remember Tool - 기억 저장 도구
 *
 * 즉시 저장 (Issue #89): 메모리 항목은 DB에 append-only로 저장된 직후 응답을 반환한다.
 * consolidation 등 augmentation은 BatchScheduler 워커에서 비동기 수행되며,
 * 호출자는 augmentation 완료를 기다리지 않는다.
 *
 * 분해 (#582): 각 메모리 타입 로직은 remember-tool-*.ts 모듈로 분리됨.
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { ToolInputValidationError } from '../../../shared/errors/tool-input-validation-error.js';
import { validateSource } from '../../../shared/validation/source-uri.js';
import { typeParamRequiredFields, validateProceduralMemoryFields, validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { resolveCallerAgentId } from '../../../tools/caller-scope.js';
import { RememberSchema } from './remember-tool-schema.js';
import type { RememberParams } from './remember-tool-schema.js';
import type { RememberToolHost } from './remember-tool-host.js';
import { handleCoreMemory } from './remember-tool-core.js';
import { handleVaultMemory } from './remember-tool-vault.js';
import { handleMemoryItem, type MemoryItemContext } from './remember-tool-memory-item.js';
import { validateReflectionNotesJson } from './remember-tool-reflection.js';
import type { MemoryTypeRequest } from '../../../shared/types/memory.types.js';

export type { RememberParams } from './remember-tool-schema.js';

export class RememberTool extends BaseTool {
  constructor() {
    super(
      'remember',
      '새로운 기억을 저장합니다',
      {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '저장할 내용. episodic 에서 record 를 주면 생략'
          },
          record: {
            type: 'object',
            description: 'episodic 작업 기록',
            properties: {
              decision: { type: 'string', description: '결정' },
              rationale: { type: 'string', description: '근거' },
              rejected: { type: 'string', description: '버린 대안' },
              failed: { type: 'string', description: '안 통한 것. 빈 문자열 허용' },
              next_blocker: { type: 'string', description: '다음 걸림돌' },
            },
            required: ['decision', 'rationale', 'rejected', 'failed', 'next_blocker'],
          },
          type: {
            type: 'string',
            enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
            description: `기억 타입
- working: 지금 처리 중인 정보 (48시간 뒤 삭제)
- episodic: 사건, 작업 완료 기록 (30일 미사용 시 망각)
- semantic: 지식, 사실 (180일)
- procedural: 방법, 절차 (90일)
- core: 에이전트 정체성, 규칙 (key-value, 무기한, always_load 옵션)
- vault: 불변 사실 (key-value, 무기한, immutable 옵션)`
          },
          key: {
            type: 'string',
            description: 'core/vault 키 (필수)'
          },
          value: {
            type: 'string',
            description: 'core/vault 값 (필수)'
          },
          always_load: {
            type: 'boolean',
            default: false
          },
          immutable: {
            type: 'boolean',
            default: true
          },
          task_goal: {
            type: 'string',
            description: 'procedural 작업 목표'
          },
          steps: {
            type: 'string',
            description: 'procedural 단계 (JSON 배열 문자열)'
          },
          reflection_notes: {
            type: 'string',
            description: 'procedural Reflexion 기록 (JSON 객체 문자열)'
          },
          workflow_name: {
            type: 'string',
            description: '프로세스 이름'
          },
          skill_name: {
            type: 'string',
            description: '기술 이름'
          },
          trigger_conditions: {
            type: 'string',
            description: '트리거 조건 (JSON 객체 문자열)'
          },
          memory_id: {
            type: 'string',
            description: '갱신 대상 id. procedural 은 workflow_name+skill_name 도 된다. update_mode 와 함께. 없으면 새 기억(incremental 은 비슷한 기억을 덮기도 함). versioned 는 새 id 반환'
          },
          update_mode: {
            type: 'string',
            enum: ['replace', 'incremental', 'versioned'],
            description: `갱신 방식. content 는 합치지 않고 바꾼다. 안 보낸 칸은 비거나 기본값
- replace: 덮어쓰기
- incremental: steps 이어붙이기. procedural 외에는 tags 합집합, importance 큰 값
- versioned: 새 행, 옛 행 유지(VERSION_OF)`
          },
          expected_version: {
            type: 'integer',
            minimum: 1,
            description: '갱신 시 현재 버전. 불일치면 409 memory_version_conflict'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '태그'
          },
          importance: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.5
          },
          source: { type: 'string', description: '출처' },
          privacy_scope: {
            type: 'string',
            enum: ['private', 'team', 'public'],
            default: 'private'
          },
        },
        // 런타임(validateTypeParam)이 강제하는 것과 동일한 제약을 광고한다 (#853).
        required: typeParamRequiredFields(),
        additionalProperties: false,
      }
    );
  }

  // protected 메서드를 RememberToolHost 인터페이스로 노출하는 위임 객체
  private readonly host: RememberToolHost = {
    logInfo: (msg, data) => this.logInfo(msg, data),
    logWarning: (msg, data) => this.logWarning(msg, data),
    logError: (err, ctx, data) => this.logError(err, ctx, data),
    createSuccessResult: (data) => this.createSuccessResult(data),
    createErrorResult: (error, message, data) => {
      const payload = {
        success: false,
        error: { code: error, message: message ?? error },
        ...(data ? { data } : {}),
      };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        error,
        ...(message ? { message } : {}),
      };
    },
  };

  /** type·source·procedural 필드를 검증하고 저장할 type 을 정한다. 유효한 source 는 정규화해 params 에 되쓴다 */
  private validateInput(parsedParams: RememberParams): MemoryTypeRequest {
    const { type: rawType, source: source_param, reflection_notes, workflow_name, skill_name, trigger_conditions } = parsedParams;

    const typeValidation = validateTypeParam(rawType, 'remember');
    if (!typeValidation.isValid) {
      throw new ToolInputValidationError(typeValidation.message || 'type 파라미터는 필수입니다.');
    }

    const sourceValidation = validateSource(source_param);
    if (!sourceValidation.isValid) {
      const msg = sourceValidation.message ?? 'source URI 형식이 유효하지 않습니다';
      if (mementoConfig.sourceStrict) {
        throw new ToolInputValidationError(`❌ remember: ${msg}`);
      }
      this.logWarning(`⚠️  remember: ${msg} (source='${source_param}')`);
    } else if (sourceValidation.normalizedSource) {
      parsedParams.source = sourceValidation.normalizedSource;
    }

    const type = (rawType || typeValidation.defaultType || 'episodic') as MemoryTypeRequest;

    if (type === 'procedural') {
      if (reflection_notes != null) {
        validateReflectionNotesJson(reflection_notes);
      }
      try {
        validateProceduralMemoryFields({ workflow_name, skill_name, trigger_conditions });
      } catch (error) {
        throw new ToolInputValidationError(`Procedural Memory 필드 검증 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (parsedParams.memory_id && (type === 'core' || type === 'vault')) {
      throw new ToolInputValidationError(
        'memory_id는 core/vault 타입에 사용할 수 없습니다. core/vault는 key로 대상을 지정합니다',
      );
    }
    return type;
  }

  /** memory_item 쓰기 맥락: 호출자(owner·process·session)와 저장 메타데이터 */
  private buildMemoryItemContext(
    parsedParams: RememberParams,
    context: ToolContext,
    type: MemoryTypeRequest,
    ownerId: string | null,
    origin_source: string,
    startTime: number,
  ): MemoryItemContext {
    const sessionId = parsedParams.session_id ?? context.sessionId ?? null;
    const isImplicitTarget = !parsedParams.memory_id;
    return {
      type,
      ownerId,
      processId: parsedParams.process_id ?? context.processId ?? null,
      sessionId,
      numTimes: parsedParams.num_times ?? 1,
      sourceSessionId: parsedParams.source_session_id ?? sessionId,
      confidenceVal: parsedParams.confidence ?? null,
      origin_source,
      startTime,
      project_id_param: parsedParams.project_id ?? (isImplicitTarget ? context.projectId : undefined),
      last_mentioned_at_param: parsedParams.last_mentioned_at ?? null,
    };
  }

  async handle(params: RememberParams, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const parsedParams = RememberSchema.parse(params);
      const ownerId = resolveCallerAgentId(context, parsedParams.owner_id ?? undefined) ?? context.agentId ?? null;
      const type = this.validateInput(parsedParams);
      this.validateDatabase(context);

      const { key, value, always_load, immutable } = parsedParams;
      const origin_source = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: {
          type,
          has_content: !!parsedParams.content,
          has_key: !!key,
          has_value: !!value
        }
      });

      if (type === 'core' || type === 'vault') {
        if (!key || !value) throw new ToolInputValidationError(`type='${type}'일 때는 key와 value가 필수입니다`);
        return type === 'core'
          ? await handleCoreMemory({ key, value, always_load, origin_source, ownerId, startTime }, context, this.host)
          : await handleVaultMemory({ key, value, immutable, origin_source, ownerId, startTime }, context, this.host);
      }

      return await handleMemoryItem(
        parsedParams,
        context,
        this.buildMemoryItemContext(parsedParams, context, type, ownerId, origin_source, startTime),
        this.host
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        params,
        context,
        executionTime
      );
      throw error;
    }
  }
}
