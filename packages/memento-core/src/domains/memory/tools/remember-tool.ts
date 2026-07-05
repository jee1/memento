/**
 * Remember Tool - 기억 저장 도구
 *
 * 즉시 저장 (Issue #89): 메모리 항목은 DB에 append-only로 저장된 직후 응답을 반환한다.
 * Triple 추출·콘솔리데이션 등 augmentation은 BatchScheduler 워커에서 비동기 수행되며,
 * 호출자는 augmentation 완료를 기다리지 않는다.
 *
 * 분해 (#582): 각 메모리 타입 로직은 remember-tool-*.ts 모듈로 분리됨.
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { validateSource } from '../../../shared/validation/source-uri.js';
import { validateProceduralMemoryFields, validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { RememberSchema } from './remember-tool-schema.js';
import type { RememberParams } from './remember-tool-schema.js';
import type { RememberToolHost } from './remember-tool-host.js';
import { handleCoreMemory } from './remember-tool-core.js';
import { handleVaultMemory } from './remember-tool-vault.js';
import { handleMemoryItem } from './remember-tool-memory-item.js';
import { validateReflectionNotesJson } from './remember-tool-reflection.js';
import type { MemoryTypeRequest } from '../../../shared/types/index.js';

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
            description: '저장할 내용 (type이 core/vault가 아닐 때 필수)'
          },
          type: {
            type: 'string',
            enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
            description: `기억 타입. 각 타입의 의미와 사용 시점:
- 'working': 현재 처리 중인 정보 (48시간 TTL, 세션 종료 시 episodic으로 전환). 예: "현재 버그 수정 작업 진행 중"
- 'episodic': 사건과 경험 기록 (90일 TTL, 핀 고정 시 무기한). 예: "오늘 회의에서 결정한 사항", "작업 완료 기록"
- 'semantic': 지식과 사실 (무기한 보존). 예: "React Hooks 사용법", "에러 해결 방법", "코드 패턴"
- 'procedural': 방법과 절차 (무기한 보존). 예: "PRD 기반 작업 목록 생성 절차", "배포 절차"
- 'core': 에이전트 정체성, 규칙, 지침 (무기한 보존, key-value 형식, always_load 옵션 지원). 예: "나는 도움이 되는 어시스턴트다", "코딩 스타일 규칙"
- 'vault': 불변 지식, 사실 (무기한 보존, key-value 형식, immutable 옵션 지원). 예: "빛의 속도는 299,792,458 m/s", "수학 공식"
기본값: 'episodic'`,
            default: 'episodic'
          },
          key: {
            type: 'string',
            description: 'Core Memory 또는 Knowledge Vault의 키 (type이 core/vault일 때 필수)'
          },
          value: {
            type: 'string',
            description: 'Core Memory 또는 Knowledge Vault의 값 (type이 core/vault일 때 필수)'
          },
          always_load: {
            type: 'boolean',
            description: '서버 시작 시 자동 로드 여부 (Core Memory용, 기본값: false)',
            default: false
          },
          immutable: {
            type: 'boolean',
            description: '불변 데이터 여부 (Knowledge Vault용, 기본값: true)',
            default: true
          },
          task_goal: {
            type: 'string',
            description: '작업 목표 (Procedural Memory용)'
          },
          steps: {
            type: 'string',
            description: '단계별 절차 (JSON 배열 문자열, Procedural Memory용)'
          },
          reflection_notes: {
            type: 'string',
            description: 'Reflexion 기록 (JSON 객체 문자열, Procedural Memory용)'
          },
          workflow_name: {
            type: 'string',
            description: '프로세스 이름 (예: "데이터 마이그레이션", "API 배포")'
          },
          skill_name: {
            type: 'string',
            description: '기술/능력 이름 (예: "스키마 백업", "데이터 검증")'
          },
          trigger_conditions: {
            type: 'string',
            description: '트리거 조건 (JSON 객체 문자열)'
          },
          update_mode: {
            type: 'string',
            enum: ['replace', 'incremental', 'versioned'],
            description: '업데이트 모드: replace (교체), incremental (증분), versioned (버전 관리)'
          },
          enable_triple_extraction: {
            type: 'boolean',
            description: 'Triple 추출 활성화 여부 (기본값: true). type="episodic"일 때만 적용됩니다.',
            default: true
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '태그 목록'
          },
          importance: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '중요도 (0-1)',
            default: 0.5
          },
          source: { type: 'string', description: '출처' },
          privacy_scope: {
            type: 'string',
            enum: ['private', 'team', 'public'],
            description: '프라이버시 범위',
            default: 'private'
          }
        },
        required: []
      }
    );
  }

  async handle(params: RememberParams, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const parsedParams = RememberSchema.parse(params);
      const {
        type: rawType,
        key, value, always_load, immutable,
        reflection_notes, workflow_name, skill_name, trigger_conditions,
        owner_id: owner_id_param, process_id: process_id_param,
        session_id: session_id_param, project_id: project_id_param,
        num_times: num_times_param, last_mentioned_at: last_mentioned_at_param,
        source_session_id: source_session_id_param, confidence: confidence_param,
        source: source_param,
      } = parsedParams;

      const ownerId = owner_id_param ?? context.agentId ?? null;
      const processId = process_id_param ?? context.processId ?? null;
      const sessionId = session_id_param ?? context.sessionId ?? null;
      const numTimes = num_times_param ?? 1;
      const sourceSessionId = source_session_id_param ?? sessionId;
      const confidenceVal = confidence_param ?? null;

      const typeParamMode = mementoConfig.typeParamMode;
      const typeValidation = validateTypeParam(rawType, typeParamMode, 'remember');
      if (!typeValidation.isValid) {
        throw new Error(typeValidation.message || 'type 파라미터는 필수입니다.');
      }
      if (typeValidation.message) {
        this.logWarning(typeValidation.message);
      }

      const sourceValidation = validateSource(source_param);
      if (!sourceValidation.isValid) {
        const msg = sourceValidation.message ?? 'source URI 형식이 유효하지 않습니다';
        if (mementoConfig.sourceStrict) {
          throw new Error(`❌ remember: ${msg}`);
        }
        this.logWarning(`⚠️  remember: ${msg} (source='${source_param}')`);
      }

      const type = (rawType || typeValidation.defaultType || 'episodic') as MemoryTypeRequest;

      if (type === 'procedural' && reflection_notes != null) {
        validateReflectionNotesJson(reflection_notes);
      }
      if (type === 'procedural') {
        try {
          validateProceduralMemoryFields({ workflow_name, skill_name, trigger_conditions });
        } catch (error) {
          throw new Error(`Procedural Memory 필드 검증 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.validateDatabase(context);

      // protected 메서드를 RememberToolHost 인터페이스로 노출하는 위임 객체
      const host: RememberToolHost = {
        logInfo: (msg, data) => this.logInfo(msg, data),
        logWarning: (msg, data) => this.logWarning(msg, data),
        logError: (err, ctx, data) => this.logError(err, ctx, data),
        createSuccessResult: (data) => this.createSuccessResult(data)
      };

      const origin_source = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: {
          type,
          has_content: !!parsedParams.content,
          has_key: !!key,
          has_value: !!value,
          type_param_mode: typeParamMode,
          type_was_defaulted: !rawType
        }
      });

      if (type === 'core') {
        if (!key || !value) throw new Error("type='core'일 때는 key와 value가 필수입니다");
        return await handleCoreMemory({ key, value, always_load, origin_source, ownerId, startTime }, context, host);
      }

      if (type === 'vault') {
        if (!key || !value) throw new Error("type='vault'일 때는 key와 value가 필수입니다");
        return await handleVaultMemory({ key, value, immutable, origin_source, ownerId, startTime }, context, host);
      }

      return await handleMemoryItem(
        parsedParams,
        context,
        {
          type, ownerId, processId, sessionId,
          numTimes, sourceSessionId, confidenceVal,
          origin_source, startTime,
          project_id_param: project_id_param ?? null,
          last_mentioned_at_param: last_mentioned_at_param ?? null
        },
        host
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
