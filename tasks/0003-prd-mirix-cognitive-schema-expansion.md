# 0003-prd-mirix-cognitive-schema-expansion.md

## Introduction/Overview

이번 개편은 Memento MCP 서버의 데이터 스키마와 프로토콜을 인지 과학(CoALA) 및 엔지니어링(MIRIX) 모델에 기반해 재구성하는 작업입니다.

기존 Memento가 단순한 기억 저장소(passive repository)에 머물렀다면, 이번 버전은 **자기 성찰, 학습, 자동 교정이 가능한 능동적 인지 메모리 시스템(active cognitive system)**으로 진화하는 초석이 됩니다.

현재 구조는 `memory_item` 단일 테이블에 모든 메모리를 저장하며, `type` 필드로 'working', 'episodic', 'semantic', 'procedural'을 구분합니다. 그러나 **Core Memory**와 **Knowledge Vault** 타입이 부재하며, Procedural Memory에 Reflexion 기록을 위한 필드가 없어 에이전트의 Reflexion이나 자동 학습 과정에서 학습된 기술이나 지속적 페르소나 정보가 저장될 공간이 없어 기억이 일회성에 머물고 장기적 학습이 불가능한 문제를 해결합니다.

## Goals

1. **MIRIX 기반 5대 메모리 스키마 구축**: Core Memory, Episodic Memory, Semantic Memory, Procedural Memory, Knowledge Vault를 모두 지원하는 통합 메모리 인프라 계층 제공
2. **Reflexion 기록 인프라 구축**: Procedural Memory에 `reflection_notes` 필드 추가 및 수동 Reflexion 기록 지원 (Phase 1). 자동 Reflexion 실행은 Phase 2에서 구현
3. **마이그레이션 자동화**: 기존 스키마 자동 탐지 및 데이터 마이그레이션 수행 (데이터 손실 최소화 목표: 99.9% 이상)
4. **데이터 출처 추적**: 모든 메모리에 `origin_source` 필드를 추가하여 데이터 출처(도구명, 호출자, 시스템 등) 추적
5. **Core Memory 자동 로드**: 서버 시작 시 `always_load=true`인 Core Memory 자동 로드
6. **MCP Protocol 명확화**: `type` 파라미터를 단계적으로 필수화하여 메모리 타입을 명시적으로 지정

## User Stories

### AI 에이전트 관점
- **US-001**: AI 에이전트로서 내 핵심 페르소나와 지침 정보를 Core Memory에 저장하여 세션 재시작 후에도 일관된 정체성을 유지하고 싶다
- **US-002**: AI 에이전트로서 학습한 기술과 워크플로우를 Procedural Memory에 저장하여 향후 유사한 작업에서 자동으로 활용하고 싶다
- **US-003 (Phase 1)**: AI 에이전트로서 작업 실패 시 수동으로 Reflexion을 기록하여 다음 시도에서 개선된 방법을 사용하고 싶다
- **US-003 (Phase 2, 후속)**: AI 에이전트로서 작업 실패 시 자동으로 Reflexion이 기록되어 다음 시도에서 개선된 방법을 사용하고 싶다
- **US-004**: AI 에이전트로서 변경 불가능한 중요 지식(예: 사용자 정의 규칙, 고정 지식)을 Knowledge Vault에 안전하게 보관하고 싶다
- **US-005**: AI 에이전트로서 각 기억의 출처를 추적하여 신뢰성을 판단하고 싶다

### 시스템 관점
- **US-006**: 시스템 관리자로서 기존 데이터를 손실 없이 새로운 스키마로 자동 마이그레이션하고 싶다
- **US-007**: 시스템 관리자로서 마이그레이션 실패 시 자동 롤백되어 데이터 무결성을 보장받고 싶다
- **US-008**: 시스템 관리자로서 서버 시작 시 Core Memory가 자동으로 로드되어 에이전트가 즉시 작동 가능한 상태가 되기를 원한다

## Functional Requirements

### 1. Core Memory 모듈
1.1. `core_memory` 별도 테이블 생성 (기존 `memory_item`과 분리)
   - 필드: `core_id` (TEXT, PRIMARY KEY), `agent_id` (TEXT, NOT NULL), `key` (TEXT, NOT NULL), `value` (TEXT, NOT NULL), `always_load` (BOOLEAN, DEFAULT 0), `origin_source` (TEXT, JSON 형식), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP)
   - 제약: `(agent_id, key)` UNIQUE
   - **참고**: `agent_id`는 향후 다중 에이전트 지원을 위한 필드입니다. 현재 단일 에이전트 환경에서는 기본값(예: "default")을 사용하며, 동일 에이전트 내에서도 프로필 구분 등에 활용할 수 있습니다.
1.2. Core Memory는 에이전트의 핵심 정체성, 지침, 인격 데이터를 저장
1.3. `always_load=true`인 Core Memory는 서버 시작 시 자동으로 로드되어 메모리에 유지
1.4. `remember(type='core')` MCP Tool을 통해 Core Memory 저장 가능
1.5. `recall(type='core')` MCP Tool을 통해 Core Memory 조회 가능
1.6. **처리 흐름**: `remember` Tool에서 `type='core'`일 때:
   - `key`, `value` 파라미터 검증 (필수)
   - `core_memory` 테이블에 INSERT (별도 DAO/서비스 사용)
   - `memory_item` 테이블에는 저장하지 않음
   - 임베딩 생성 및 FTS/VEC 인덱싱은 수행하지 않음 (Core Memory는 검색 대상 아님)
   - `always_load=true`인 경우 메모리 캐시에 즉시 로드

### 2. Episodic Memory 확장
2.1. 기존 `memory_item` 테이블의 `type='episodic'` 레코드를 Episodic Memory로 사용
2.2. `memory_item` 테이블에 `origin_source` 필드 추가 (JSON 형식)
2.3. 기존 `type='episodic'` 데이터는 그대로 유지 (마이그레이션 불필요)
2.4. `remember(type='episodic')` MCP Tool을 통해 Episodic Memory 저장 가능 (기존 `memory_item`에 저장)
2.5. `recall(type='episodic')` MCP Tool을 통해 Episodic Memory 조회 가능

### 3. Semantic Memory 확장
3.1. 기존 `memory_item` 테이블의 `type='semantic'` 레코드를 Semantic Memory로 사용
3.2. `memory_item` 테이블에 `origin_source` 필드 추가 (JSON 형식)
3.3. 기존 `type='semantic'` 데이터는 그대로 유지 (마이그레이션 불필요)
3.4. `remember(type='semantic')` MCP Tool을 통해 Semantic Memory 저장 가능 (기존 `memory_item`에 저장)
3.5. `recall(type='semantic')` MCP Tool을 통해 Semantic Memory 조회 가능

### 4. Procedural Memory 확장
4.1. 기존 `memory_item` 테이블의 `type='procedural'` 레코드를 Procedural Memory로 사용
4.2. `memory_item` 테이블에 다음 필드 추가:
   - `task_goal` (TEXT, NULL) - 작업 목표 (Procedural Memory 전용)
   - `steps` (TEXT, NULL) - 단계별 절차 (JSON 배열 형식, Procedural Memory 전용)
   - `reflection_notes` (TEXT, NULL) - Reflexion 기록 (JSON 형식, Procedural Memory 전용)
4.3. 학습된 기술 및 워크플로우를 저장
4.4. `reflection_notes` 필드: Phase 1에서는 수동으로 업데이트, Phase 2에서는 Reflexion Worker가 자동으로 업데이트
4.5. `remember(type='procedural')` MCP Tool을 통해 Procedural Memory 저장 가능 (기존 `memory_item`에 저장)
4.6. `recall(type='procedural')` MCP Tool을 통해 Procedural Memory 조회 가능

### 5. Knowledge Vault 추가
5.1. `knowledge_vault` 별도 테이블 생성 (기존 `memory_item`과 분리)
   - 필드: `vault_id` (TEXT, PRIMARY KEY), `agent_id` (TEXT, NOT NULL), `key` (TEXT, NOT NULL), `value` (TEXT, NOT NULL), `immutable` (BOOLEAN, DEFAULT 1), `version` (INTEGER, DEFAULT 1), `previous_version_id` (TEXT, NULL), `admin_override` (BOOLEAN, DEFAULT 0), `deleted_at` (TIMESTAMP, NULL), `origin_source` (TEXT, JSON 형식), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP)
   - 제약: `(agent_id, key, version)` UNIQUE 또는 `(agent_id, key)` UNIQUE WHERE `deleted_at IS NULL` (버전 관리와 호환)
   - **참고**: `agent_id`는 향후 다중 에이전트 지원을 위한 필드입니다. 현재 단일 에이전트 환경에서는 기본값을 사용합니다.
   - **버전 관리 제약 해결**: 동일 `(agent_id, key)` 조합으로 여러 버전을 저장하기 위해 `version`을 UNIQUE 제약에 포함하거나, `deleted_at IS NULL` 조건을 사용하여 활성 버전만 UNIQUE 제약 적용
   - **향후 확장 필드**: `admin_override`, `deleted_at` 필드는 향후 기능을 위한 스키마이며, 이번 단계에서는 필드만 추가하고 실제 로직은 구현하지 않습니다.
5.2. 변경 불가능한 영구 지식 저장소 (`immutable=true`)
5.3. Core Memory와의 차이: Vault는 불변 데이터, Core는 변경 가능한 페르소나
5.4. `remember(type='vault')` MCP Tool을 통해 Knowledge Vault 저장 가능
5.5. `recall(type='vault')` MCP Tool을 통해 Knowledge Vault 조회 가능
5.6. **처리 흐름**: `remember` Tool에서 `type='vault'`일 때:
   - `key`, `value` 파라미터 검증 (필수)
   - `knowledge_vault` 테이블에 INSERT (별도 DAO/서비스 사용)
   - `memory_item` 테이블에는 저장하지 않음
   - 임베딩 생성 및 FTS/VEC 인덱싱은 수행하지 않음 (Vault는 검색 대상 아님)
   - `immutable=true`인 경우 업데이트/삭제 시도 시 에러 반환
5.7. **불변 데이터 갱신 플로우 (향후 구현, 이번 단계에서는 스키마만 준비)**:
   - 5.7.1. 버전 관리 로직 (후속 작업): 기존 레코드를 삭제하지 않고 새 버전을 생성 (`version` 증가, `previous_version_id`에 이전 버전 ID 저장)
   - 5.7.2. 관리자 Override 로직 (후속 작업): `admin_override=true` 플래그를 가진 요청은 버전 기록 후 업데이트 허용
   - 5.7.3. Soft Delete 로직 (후속 작업): `deleted_at` 필드를 사용한 논리적 삭제 지원
   - 5.7.4. **이번 단계 범위**: 버전 관리, 관리자 Override, Soft Delete를 위한 스키마 필드(`version`, `previous_version_id`, `admin_override`, `deleted_at`)만 추가하고, 실제 동작 로직은 후속 작업으로 진행

### 6. Reflexion 기록 인프라 (Phase 1: 수동 호출)
6.1. **Phase 1 범위**: 이번 단계에서는 Reflexion 기록을 위한 인프라만 구축하고, 수동 호출만 지원합니다.
6.2. `memory_item.reflection_notes` 필드에 JSON 형식으로 Reflection 내용 저장 가능 (Procedural Memory 전용)
6.3. Reflection 내용 JSON 형식:
   ```json
   {
     "failure_type": "tool_error|user_feedback|metric_failure",
     "failure_description": "...",
     "original_task": "...",
     "lessons_learned": "...",
     "suggested_improvements": "...",
     "timestamp": "2025-01-01T00:00:00Z",
     "phase": "manual"
   }
   ```
6.4. 수동 Reflexion 기록:
   - `remember(type='procedural')` 호출 시 `reflection_notes` 필드에 직접 기록
   - 또는 별도 MCP Tool `update_reflection` (향후 구현)을 통해 기록
6.5. **Phase 2 (후속 작업)**: 자동 Reflexion 실행
   - 6.5.1. 실패 경험($sr_t$) 자동 감지 및 백그라운드 Reflexion 기록
   - 6.5.2. 실패 경험 정의:
     - MCP 도구 호출 실패(에러 반환)
     - 사용자 피드백으로 명시된 실패
     - 특정 성공 지표 미달성
   - 6.5.3. `auto_reflect` 내부 함수를 통해 Reflexion Worker가 자동 호출
   - 6.5.4. 동일한 `task_goal`에 대한 반복 실패 시 기존 `reflection_notes`에 추가 기록

### 7. origin_source 필드 추가
7.1. `memory_item` 테이블에 `origin_source` 필드 추가 (TEXT, JSON 형식)
7.2. `core_memory`, `knowledge_vault` 테이블에도 `origin_source` 필드 포함
7.3. JSON 형식 예시:
   ```json
   {
     "tool": "remember",
     "caller": "user|system|reflexion_worker",
     "timestamp": "2025-01-01T00:00:00Z",
     "context": {
       "session_id": "...",
       "request_id": "..."
     }
   }
   ```
7.4. `remember` Tool 호출 시 자동으로 `origin_source` 기록
7.5. `recall` 시 `origin_source` 정보도 함께 반환

### 8. 마이그레이션 자동화
8.1. `npx memento-migrate` 또는 서버 시작 시 기존 스키마 자동 탐지
8.2. 기존 스키마 감지:
   - `memory_item` 테이블 존재 여부 확인
   - `memory_embedding` 테이블 존재 여부 확인
   - `memento_schema_version` 메타데이터 확인 (없으면 생성)
8.3. 마이그레이션 단계:
   - 1단계: 기존 데이터 백업 (백업 위치: `data/backups/migration_YYYYMMDD_HHMMSS.db`)
   - 2단계: 새로운 스키마 생성:
     - `core_memory` 테이블 생성
     - `knowledge_vault` 테이블 생성
     - `memory_item` 테이블에 필드 추가: `origin_source`, `task_goal`, `steps`, `reflection_notes`
   - 3단계: 기존 데이터 유지 (기존 `memory_item` 데이터는 그대로 유지, 마이그레이션 불필요)
   - 4단계: `origin_source` 필드 기본값 설정 (NULL → 빈 JSON 객체 `{}`)
   - 5단계: 기존 의존성 유지 확인:
     - `memory_embedding` 테이블의 `memory_id` FK가 `memory_item`을 참조하는지 확인
     - FTS5 트리거가 정상 작동하는지 확인
     - VEC 테이블 트리거가 정상 작동하는지 확인
   - 6단계: 데이터 무결성 검증 (레코드 수 비교, 필수 필드 검증)
   - 7단계: 스키마 버전 태그 기록 (`memento_schema_version = 2.0`)
8.4. **마이그레이션 실패 시 대응 절차**:
   - 8.4.1. 자동 롤백 시도:
     - 백업 데이터로 복원
     - 트랜잭션 롤백
     - 에러 로그 기록 (`data/logs/migration_error_YYYYMMDD_HHMMSS.log`)
   - 8.4.2. 롤백 실패 시:
     - 백업 파일 위치 명시 (`data/backups/`)
     - 수동 복구 가이드 제공
     - 사용자에게 명확한 알림 및 복구 절차 안내
   - 8.4.3. 재시도 전략:
     - 마이그레이션 실패 시 자동 재시도는 하지 않음 (데이터 손실 위험)
     - 사용자가 문제 해결 후 수동으로 재시도
8.5. 마이그레이션 성공 시:
   - 백업 데이터 보존 기간: 기본 30일 (설정으로 변경 가능)
   - 마이그레이션 로그 저장 (`data/logs/migration_YYYYMMDD_HHMMSS.log`)
   - 성공 메시지 및 마이그레이션 요약 정보 출력
8.6. **데이터 손실 목표**: 99.9% 이상 보존 (I/O 오류, 디스크 공간 부족 등 예외 상황 제외)

### 9. MCP Protocol 확장
9.0. **`remember` Tool API 파라미터 확장**
   - 9.0.1. 현재 상태: `remember` Tool은 `content, type, tags, importance, source, privacy_scope` 파라미터만 지원
   - 9.0.2. Core Memory 저장을 위한 파라미터 추가:
     - `key` (TEXT, required when `type='core'`): Core Memory의 키
     - `value` (TEXT, required when `type='core'`): Core Memory의 값
     - `always_load` (BOOLEAN, optional, default: false): 서버 시작 시 자동 로드 여부
   - 9.0.3. Knowledge Vault 저장을 위한 파라미터 추가:
     - `key` (TEXT, required when `type='vault'`): Vault의 키
     - `value` (TEXT, required when `type='vault'`): Vault의 값
     - `immutable` (BOOLEAN, optional, default: true): 불변 데이터 여부
   - 9.0.4. Procedural Memory 저장을 위한 파라미터 추가:
     - `task_goal` (TEXT, optional): 작업 목표
     - `steps` (TEXT, optional, JSON 배열 형식): 단계별 절차
     - `reflection_notes` (TEXT, optional, JSON 형식): Reflexion 기록
   - 9.0.5. **조건부 필수 파라미터**: `type`에 따라 필수 파라미터가 달라짐
     - `type='core'` 또는 `type='vault'`: `key`, `value` 필수, `content`는 선택적
     - `type='procedural'`: `content` 필수, `task_goal`, `steps`, `reflection_notes`는 선택적
     - `type='episodic'` 또는 `type='semantic'`: 기존과 동일 (`content` 필수)
   - 9.0.6. **`key`, `value` 필드 추가 및 JSON 형태 정의**:
     - **필드 위치**: 루트 레벨 필드로 추가 (중첩 객체 아님)
     - **CommonSchemas 확장** (`src/tools/types.ts`):
       ```typescript
       export const CommonSchemas = {
         // 기존 스키마 유지
         Content: z.string().min(1, 'Content cannot be empty').optional(), // optional로 변경
         MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']), // 확장
         // 새 스키마 추가
         Key: z.string().min(1, 'Key cannot be empty'),
         Value: z.string().min(1, 'Value cannot be empty'),
         AlwaysLoad: z.boolean().default(false).optional(),
         Immutable: z.boolean().default(true).optional(),
         TaskGoal: z.string().optional(),
         Steps: z.string().optional(), // JSON 배열 문자열
         ReflectionNotes: z.string().optional(), // JSON 객체 문자열
       };
       ```
     - **RememberSchema 확장** (`src/tools/remember-tool.ts`):
       ```typescript
       const RememberSchema = z.object({
         content: CommonSchemas.Content, // optional로 변경
         type: CommonSchemas.MemoryType.default('episodic'),
         // Core/Vault용 필드 추가
         key: z.string().optional(),
         value: z.string().optional(),
         always_load: CommonSchemas.AlwaysLoad,
         immutable: CommonSchemas.Immutable,
         // Procedural용 필드 추가
         task_goal: CommonSchemas.TaskGoal,
         steps: CommonSchemas.Steps,
         reflection_notes: CommonSchemas.ReflectionNotes,
         // 기존 필드 유지
         tags: CommonSchemas.Tags,
         importance: CommonSchemas.Importance.default(0.5),
         source: CommonSchemas.Source,
         privacy_scope: CommonSchemas.PrivacyScope.default('private'),
       }).refine((data) => {
         // 조건부 필수 검증
         if (data.type === 'core' || data.type === 'vault') {
           if (!data.key || !data.value) {
             return false; // key, value 필수
           }
         } else {
           if (!data.content) {
             return false; // content 필수
           }
         }
         return true;
       }, {
         message: "type='core' 또는 'vault'일 때는 key, value가 필수이고, 나머지는 content가 필수입니다"
       });
       ```
     - **JSON 요청 예시**:
       ```json
       // Core Memory 저장
       {
         "type": "core",
         "key": "persona",
         "value": "I am a helpful assistant",
         "always_load": true
       }
       
       // Knowledge Vault 저장
       {
         "type": "vault",
         "key": "user_rules",
         "value": "Never share personal information",
         "immutable": true
       }
       
       // Episodic Memory 저장 (기존과 동일)
       {
         "type": "episodic",
         "content": "User asked about React hooks",
         "importance": 0.7
       }
       
       // Procedural Memory 저장
       {
         "type": "procedural",
         "content": "How to deploy a React app",
         "task_goal": "Deploy React application to production",
         "steps": "[\"build\", \"test\", \"deploy\"]",
         "reflection_notes": "{\"lessons\": \"Always run tests before deploy\"}"
       }
       ```
   - 9.0.7. **`content` 필드 조건부 필수 처리**:
     - `CommonSchemas.Content`를 `z.string().optional()`로 변경
     - `RememberSchema.refine()`을 사용한 런타임 조건부 검증
     - `type='core'` 또는 `type='vault'`일 때: `content` 검증 생략, `key`, `value` 필수
     - 나머지 타입: `content` 필수, `key`, `value` 무시
   - 9.0.8. **하위 호환성**: 기존 파라미터(`content`, `tags`, `importance`, `source`, `privacy_scope`)는 계속 지원
   - 9.0.9. **기존 클라이언트 업그레이드 가이드**:
     - 기존 클라이언트: `content` 필수 사용 (변경 없음)
     - Core/Vault 저장 시: `type`, `key`, `value` 필드 추가
     - `content`는 Core/Vault 저장 시 생략 가능 (하지만 제공해도 무시됨)

9.1. **`remember` Tool의 `type` 파라미터 확장 및 단계적 필수화**
   - 9.1.0. **타입 분리 전략 (중요)**:
     - **문제**: `MemoryType`을 전역으로 확장하면 도메인 모델(`MemoryItem`)과 불일치 발생
       - `MemoryItem.type`은 `memory_item` 테이블의 `type` 필드를 나타냄
       - DB CHECK 제약은 여전히 4개 값만 허용
       - 전역 확장 시 컴파일 타임에는 'core'/'vault'도 허용되지만 런타임에 DB 제약으로 실패
     - **해결 방안**: 요청 파라미터용 타입과 도메인 모델 타입 분리
       ```typescript
       // src/types/index.ts
       // 도메인 모델용 타입 (memory_item 테이블용, 변경 없음)
       export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
       
       // 요청 파라미터용 타입 (MCP Tool 파라미터용, 확장)
       export type MemoryTypeRequest = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault';
       
       // 타입 가드 함수
       export function isMemoryItemType(type: MemoryTypeRequest): type is MemoryType {
         return type === 'working' || type === 'episodic' || type === 'semantic' || type === 'procedural';
       }
       ```
     - **사용 위치**:
       - `MemoryTypeRequest`: MCP Tool 파라미터, `CommonSchemas.MemoryType`, 클라이언트 타입
       - `MemoryType`: 도메인 모델(`MemoryItem`), `memory_item` 테이블 저장 시
     - **타입 변환**: `memory_item` 저장 시 `isMemoryItemType()` 가드로 검증 후 변환
   - 9.1.1. **MemoryType enum 확장 (요청 파라미터 레이어)**:
     - 현재: `CommonSchemas.MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural'` (src/tools/types.ts)
     - 확장: `CommonSchemas.MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault'`
     - 확장 위치:
       - `src/tools/types.ts`: `CommonSchemas.MemoryType` enum 확장 (요청 파라미터용)
       - `src/types/index.ts`: `MemoryTypeRequest` 타입 추가 (요청 파라미터용)
       - `src/types/index.ts`: `MemoryType` 타입은 그대로 유지 (도메인 모델용)
       - `src/npm-client/types.ts`: 클라이언트 타입 확장 (`MemoryTypeRequest` 사용)
     - **목적**: MCP Tool의 `type` 파라미터가 `'core'`, `'vault'`를 받을 수 있도록 타입 정의 확장
   - 9.1.1a. **remember Tool JSON Schema 메타데이터 확장 (구체적 코드 수정 지침)**:
     - **⚠️ 현재 상태 (구현 전)**: 
       - `src/tools/remember-tool.ts:29-57`에서 `type` enum이 4개 값만 허용: `['working', 'episodic', 'semantic', 'procedural']`
       - `key`, `value`, `always_load`, `immutable`, `task_goal`, `steps`, `reflection_notes` 필드가 존재하지 않음
       - `RememberSchema` (14-21 라인)도 동일하게 제한적
     - **목표 상태 (구현 후)**:
       - `type` enum 확장: `['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']`
       - 새 필드 추가: `key`, `value`, `always_load`, `immutable`, `task_goal`, `steps`, `reflection_notes`
       - 조건부 필수 검증 로직 추가
     - **해결 방안**: BaseTool의 `inputSchema`에 `type` enum 확장 및 새 필드 추가
     - **수정 대상 파일**: `src/tools/remember-tool.ts`
     - **구체적 수정 단계**:
       
       **1단계: RememberSchema (Zod) 확장 (14-21 라인)**
       ```typescript
       // Before (현재):
       const RememberSchema = z.object({
         content: CommonSchemas.Content,
         type: CommonSchemas.MemoryType.default('episodic'),
         tags: CommonSchemas.Tags,
         importance: CommonSchemas.Importance.default(0.5),
         source: CommonSchemas.Source,
         privacy_scope: CommonSchemas.PrivacyScope.default('private'),
       });
       
       // After (수정 후):
       const RememberSchema = z.object({
         content: CommonSchemas.Content.optional(), // 조건부 필수로 변경
         type: CommonSchemas.MemoryType.default('episodic'), // 확장된 타입 사용
         // Core/Vault용 필드
         key: z.string().optional(),
         value: z.string().optional(),
         always_load: z.boolean().optional(),
         immutable: z.boolean().optional(),
         // Procedural Memory용 필드
         task_goal: z.string().optional(),
         steps: z.string().optional(), // JSON 배열 문자열
         reflection_notes: z.string().optional(), // JSON 객체 문자열
         // 기존 필드 유지
         tags: CommonSchemas.Tags,
         importance: CommonSchemas.Importance.default(0.5),
         source: CommonSchemas.Source,
         privacy_scope: CommonSchemas.PrivacyScope.default('private'),
       }).refine((data) => {
         // 조건부 필수 검증
         if (data.type === 'core' || data.type === 'vault') {
           // Core/Vault는 key, value 필수
           if (!data.key || !data.value) {
             return false;
           }
           // content는 선택적 (제공되면 무시)
         } else {
           // 나머지 타입은 content 필수
           if (!data.content) {
             return false;
           }
         }
         return true;
       }, {
         message: "type='core' 또는 'vault'일 때는 key와 value가 필수이고, 나머지 타입일 때는 content가 필수입니다"
       });
       ```
       
       **2단계: BaseTool inputSchema 확장 (28-59 라인)**
       ```typescript
       // Before (현재, 28-59 라인):
       super(
         'remember',
         '새로운 기억을 저장합니다',
         {
           type: 'object',
           properties: {
             content: { type: 'string', description: '저장할 내용' },
             type: { 
               type: 'string', 
               enum: ['working', 'episodic', 'semantic', 'procedural'], // 4개만
               description: '기억 타입',
               default: 'episodic'
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
           required: ['content']
         }
       );
       
       // After (수정 후, 28-59 라인):
       super(
         'remember',
         '새로운 기억을 저장합니다',
         {
           type: 'object',
           properties: {
             content: { 
               type: 'string', 
               description: '저장할 내용 (type이 core 또는 vault가 아닌 경우 필수)' 
             },
             type: { 
               type: 'string', 
               enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'], // 확장
               description: '기억 타입',
               default: 'episodic'
             },
             // Core/Vault용 필드 추가
             key: { 
               type: 'string', 
               description: 'Core/Vault용 키 (type이 core 또는 vault일 때 필수)' 
             },
             value: { 
               type: 'string', 
               description: 'Core/Vault용 값 (type이 core 또는 vault일 때 필수)' 
             },
             always_load: { 
               type: 'boolean', 
               description: '서버 시작 시 자동 로드 여부 (Core Memory용, 기본값: false)' 
             },
             immutable: { 
               type: 'boolean', 
               description: '불변 데이터 여부 (Knowledge Vault용, 기본값: false)' 
             },
             // Procedural Memory용 필드 추가
             task_goal: { 
               type: 'string', 
               description: '작업 목표 (Procedural Memory용)' 
             },
             steps: { 
               type: 'string', 
               description: '단계별 절차, JSON 배열 형식 문자열 (Procedural Memory용, 예: "[\"step1\", \"step2\"]")' 
             },
             reflection_notes: { 
               type: 'string', 
               description: 'Reflexion 기록, JSON 형식 문자열 (Procedural Memory용)' 
             },
             // 기존 필드 유지
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
           required: [] // 조건부 필수는 런타임 검증 (RememberSchema.refine()에서 처리)
         }
       );
       ```
       
       **3단계: handle 메서드에서 새 파라미터 처리 (63 라인 이후)**
       ```typescript
       // handle 메서드 시작 부분 수정 (64 라인):
       async handle(params: any, context: ToolContext): Promise<ToolResult> {
         const { 
           content, 
           type, 
           key, 
           value, 
           always_load, 
           immutable, 
           task_goal, 
           steps, 
           reflection_notes,
           tags, 
           importance, 
           source, 
           privacy_scope 
         } = RememberSchema.parse(params);
         
         // type에 따른 분기 처리
         if (type === 'core' || type === 'vault') {
           // Core/Vault 저장 로직 (별도 서비스 호출)
           // ... (9.5 섹션 참조)
         } else {
           // 기존 memory_item 저장 로직
           // ... (기존 코드 유지)
         }
       }
       ```
     - **수정 순서**:
       1. `CommonSchemas.MemoryType` 확장 (9.1.1 참조)
       2. `RememberSchema` 확장 (1단계)
       3. `BaseTool inputSchema` 확장 (2단계)
       4. `handle` 메서드 수정 (3단계)
     - **중요**: 
       - JSON Schema는 MCP 클라이언트가 요청을 생성하는 유일한 경로이므로 반드시 확장해야 함
       - `RememberSchema`와 `inputSchema`는 동기화되어야 함 (필드명, 타입, 설명 일치)
       - 조건부 필수 검증은 `RememberSchema.refine()`에서 처리하고, `inputSchema.required`는 빈 배열로 설정
   - 9.1.1b. **타입 분리 전략 적용 경로 (구체적 파일 목록 및 MemoryTypeRequest 사용 위치)**:
     - **⚠️ 현재 상태 (구현 전)**: 
       - `CommonSchemas.MemoryType`이 도메인 타입(`MemoryType`)을 직접 사용
       - `src/tools/types.ts:52`에서 `MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural'])` (4개 값만)
       - `src/types/index.ts:5`에서 `MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural'` (4개 값만)
       - `MemoryTypeRequest` 타입이 존재하지 않음
     - **목표 상태 (구현 후)**: 
       - 요청 파라미터용 타입(`MemoryTypeRequest`)과 도메인 모델 타입(`MemoryType`) 분리
       - `CommonSchemas.MemoryType`이 `MemoryTypeRequest`를 사용 (6개 값)
       - `MemoryType`은 도메인 모델용으로 유지 (4개 값)
     - **수정 대상 파일 및 내용**:
       
       **1단계: 타입 정의 추가 및 확장**
       - **`src/types/index.ts`**:
         ```typescript
         // 도메인 모델용 타입 (기존 유지)
         export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
         
         // 요청 파라미터용 타입 (신규 추가)
         export type MemoryTypeRequest = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault';
         
         // 타입 가드 함수 (신규 추가)
         export function isMemoryItemType(type: MemoryTypeRequest): type is MemoryType {
           return type === 'working' || type === 'episodic' || type === 'semantic' || type === 'procedural';
         }
         ```
       - **`src/tools/types.ts`**:
         ```typescript
         // CommonSchemas.MemoryType을 MemoryTypeRequest로 확장
         MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']),
         ```
       
       **2단계: Tool 구현 파일 수정**
       - **`src/tools/remember-tool.ts`**:
         - **Import 추가** (파일 상단):
           ```typescript
           import { isMemoryItemType, type MemoryTypeRequest } from '../types/index.js';
           ```
         - **RememberSchema 수정** (14-21 라인):
           - `type: CommonSchemas.MemoryType` 사용 (자동으로 확장된 타입 사용, `MemoryTypeRequest`와 동일)
           - 타입은 `MemoryTypeRequest`로 추론됨
         - **handle 메서드 수정** (64 라인 이후):
           ```typescript
           async handle(params: any, context: ToolContext): Promise<ToolResult> {
             const { type, ... } = RememberSchema.parse(params);
             // type은 MemoryTypeRequest 타입
             
             if (type === 'core' || type === 'vault') {
               // 별도 테이블 저장 로직
             } else {
               // 타입 가드로 검증 및 변환
               if (!isMemoryItemType(type)) {
                 throw new Error(`Invalid memory type: ${type}`);
               }
               // 이제 type은 MemoryType으로 좁혀짐
               // memory_item 저장
             }
           }
           ```
       - **`src/tools/recall-tool.ts`**:
         - **Import 추가** (파일 상단):
           ```typescript
           import { isMemoryItemType, type MemoryTypeRequest } from '../types/index.js';
           import type { MemoryType } from '../types/index.js';
           ```
         - **RecallSchema 수정** (11-26 라인):
           - `type: CommonSchemas.MemoryType.optional()` 사용 (확장된 타입)
           - `memory_types: z.array(CommonSchemas.MemoryType).optional()` 사용 (확장된 타입)
           - 타입은 `MemoryTypeRequest`로 추론됨
         - **handle 메서드 수정** (9.2.3.2a 참조):
           ```typescript
           // memory_types 배열 전처리
           if (memory_types && memory_types.length > 0) {
             // 'core'/'vault' 필터링
             const filteredTypes = memory_types.filter(t => t !== 'core' && t !== 'vault');
             // 타입 가드 적용: MemoryTypeRequest[] -> MemoryType[]
             const validMemoryTypes = filteredTypes.filter(isMemoryItemType) as MemoryType[];
             // 검색 엔진 호출 시 validMemoryTypes 사용
           }
           ```
       - **`src/tools/memory-injection-prompt.ts`**:
         - **Import 추가** (파일 상단):
           ```typescript
           import { isMemoryItemType, type MemoryTypeRequest } from '../types/index.js';
           import type { MemoryType } from '../types/index.js';
           ```
         - **MemoryInjectionSchema 수정** (10-16 라인):
           ```typescript
           // Before (현재):
           memory_types: z.array(z.enum(['working', 'episodic', 'semantic', 'procedural'])).optional()
           
           // After (수정 후):
           memory_types: z.array(CommonSchemas.MemoryType).optional()
           // 타입은 MemoryTypeRequest[]로 추론됨
           ```
         - **handle 메서드 수정** (60-67 라인):
           ```typescript
           // memory_types 배열 전처리
           if (memory_types && memory_types.length > 0) {
             // 'core'/'vault' 필터링
             const filteredTypes = memory_types.filter(t => t !== 'core' && t !== 'vault');
             // 타입 가드 적용: MemoryTypeRequest[] -> MemoryType[]
             const validMemoryTypes = filteredTypes.filter(isMemoryItemType) as MemoryType[];
             // 검색 엔진 호출 시 validMemoryTypes 사용
           }
           ```
       
       **3단계: 서비스 레이어 수정**
       - **`src/services/memory-embedding-service.ts`**:
         - `MemoryType` import 유지 (도메인 모델용)
         - 파라미터로 `MemoryTypeRequest` 받을 경우 타입 가드 적용
       - **`src/algorithms/hybrid-search-engine.ts`**:
         - `MemoryType` import 유지 (도메인 모델용)
         - `types` 파라미터는 `MemoryType[]` 유지 (memory_item 검색용)
       
       **4단계: 클라이언트 라이브러리 수정**
       - **`src/npm-client/types.ts`**:
         ```typescript
         // MemoryTypeRequest로 확장
         export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault';
         ```
       - **`src/npm-client/utils.ts`**:
         ```typescript
         // isValidMemoryType 함수 확장
         export function isValidMemoryType(type: string): type is MemoryType {
           return ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'].includes(type);
         }
         ```
       - **`src/npm-client/memory-manager.ts`**:
         - `MemoryType` 사용 (확장된 타입 사용)
         - `searchByType` 메서드에서 'core'/'vault' 처리 추가
       
       **5단계: 타입 가드 사용 위치 요약**
       - `memory_item` 테이블 저장 전: `isMemoryItemType()` 호출 필수
       - `memory_types` 배열 필터링: 'core'/'vault' 제거
       - 검색 엔진 호출 전: `MemoryType[]`로 변환
       
     - **마이그레이션 순서**:
       1. `src/types/index.ts`에 `MemoryTypeRequest` 및 타입 가드 추가
       2. `src/tools/types.ts`에서 `CommonSchemas.MemoryType` 확장
       3. Tool 구현 파일들 수정 (remember, recall, memory-injection-prompt)
       4. 서비스 레이어 수정 (필요 시 타입 가드 적용)
       5. 클라이언트 라이브러리 수정
       6. 테스트 및 검증
   - 9.1.2. **도메인 모델 타입 유지 (데이터베이스 레이어)**:
     - `MemoryType` 타입: 도메인 모델용으로 그대로 유지
       - 현재: `MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural'` (src/types/index.ts)
       - 유지: `MemoryItem.type`은 `MemoryType` 타입 사용 (변경 없음)
     - `memory_item` 테이블: CHECK 제약 변경 없음
       - 현재: `type TEXT CHECK (type IN ('working','episodic','semantic','procedural'))` (src/database/schema.sql)
       - 유지: `'core'`, `'vault'`는 `memory_item`에 저장되지 않으므로 CHECK 제약에 포함하지 않음
     - `core_memory` 테이블: 별도 테이블이므로 `memory_item`의 CHECK 제약과 무관
     - `knowledge_vault` 테이블: 별도 테이블이므로 `memory_item`의 CHECK 제약과 무관
     - **타입 안전성**: `memory_item` 저장 시 타입 가드로 검증
       ```typescript
       // memory_item 저장 시
       if (!isMemoryItemType(type)) {
         throw new Error(`type '${type}'는 memory_item 테이블에 저장할 수 없습니다. 'core'와 'vault'는 별도 테이블을 사용하세요.`);
       }
       // 이제 type은 MemoryType으로 좁혀짐
       await insertMemoryItem({ ...data, type });
       ```
     - **일관성**: 
       - 요청 파라미터: `MemoryTypeRequest` (확장된 타입)
       - 도메인 모델: `MemoryType` (기존 타입 유지)
       - DB 제약: `memory_item` 테이블은 기존 값만 허용
   - 9.1.3. Phase 1 (v2.0.0): 경고 로그 단계
     - `type` 파라미터 없이 호출 시 경고 로그 출력
     - 기본값으로 `type='episodic'` 자동 적용 (하위 호환성 유지)
     - 경고 메시지: "`type` 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 향후 버전에서는 필수 파라미터가 됩니다."
     - `type='core'` 또는 `type='vault'` 호출 시 `key`, `value` 파라미터 검증
   - 9.1.4. Phase 2 (v2.1.0): Deprecation 단계
     - `type` 파라미터 없이 호출 시 Deprecation 경고 반환 (에러 아님)
     - 기본값으로 `type='episodic'` 자동 적용 (하위 호환성 유지)
     - Deprecation 메시지에 마이그레이션 가이드 링크 포함
   - 9.1.5. Phase 3 (v3.0.0): Hard Error 단계
     - `type` 파라미터 필수 (없으면 에러 반환)
     - 에러 메시지: "`type` 파라미터는 필수입니다. 'core' | 'episodic' | 'semantic' | 'procedural' | 'vault' 중 하나를 지정해주세요."
   - 9.1.6. 서버 설정으로 단계 제어 가능 (환경 변수: `MEMENTO_TYPE_PARAM_MODE=warn|deprecate|error`)
9.2. **`recall` Tool 확장 및 Core/Vault 조회 지원**
   - 9.2.1. **현재 구현 상태**:
     - `query` 파라미터 필수 (검색 쿼리)
     - `memory_types` 배열로 타입 필터링 (단일 `type` 파라미터 아님)
     - 하이브리드 검색 엔진 사용 (텍스트 + 벡터 검색)
     - Core/Vault에 대한 특별한 처리가 없음
   - 9.2.2. **확장 방안**: Core/Vault 조회를 위한 두 가지 접근 방법
     - **방법 1: `recall` Tool 확장 (권장)**
       - `type` 파라미터 추가 (단일 값, 선택적)
       - `type='core'` 또는 `type='vault'`일 때:
         - `query` 파라미터를 선택적으로 변경 (없으면 전체 조회 또는 키 기반 조회)
         - `key` 파라미터 추가 (선택적, 특정 키 조회 시 사용)
         - 별도 조회 로직 사용 (검색 엔진 사용 안 함)
       - `type`이 없거나 `type='episodic'`, `'semantic'`, `'procedural'`, `'working'`일 때:
         - 기존 로직 유지 (`query` 필수, `memory_types` 배열 사용)
     - **방법 2: 별도 Tool 생성**
       - `get_core_memory` Tool: Core Memory 조회 전용
       - `get_vault` Tool: Knowledge Vault 조회 전용
       - `recall` Tool은 기존대로 유지 (Memory Item 검색만)
   - 9.2.3. **권장: 방법 1 (recall Tool 확장) - API 계약 명확화**
     - 9.2.3.0. **RecallSchema 확장 구체적 코드 수정 지침**:
     - **⚠️ 현재 상태 (구현 전)**:
       - `src/tools/recall-tool.ts:11-26`에서 `RecallSchema`가 `query`를 필수로 검증
       - `src/tools/recall-tool.ts:40-44`에서 `memory_types` enum이 4개 값만 허용: `['working', 'episodic', 'semantic', 'procedural']`
       - JSON Schema 메타데이터에 `type`, `key`, `agent_id` 파라미터가 없음
     - **목표 상태 (구현 후)**:
       - `query`를 조건부 필수로 변경
       - `type`, `key`, `agent_id` 파라미터 추가
       - `memory_types` enum을 6개 값으로 확장 (런타임에서 필터링)
     - **해결 방안**: `RecallSchema`와 JSON Schema 메타데이터를 모두 확장
     - **수정 대상 파일**: `src/tools/recall-tool.ts`
     - **구체적 수정 단계**:
       
       **1단계: RecallSchema (Zod) 확장 (11-26 라인)**
     - **RecallSchema 확장 코드** (`src/tools/recall-tool.ts`):
       ```typescript
       const RecallSchema = z.object({
         // query를 optional로 변경 (조건부 필수는 refine에서 처리)
         query: z.string().min(1, 'Query cannot be empty').optional(),
         // 새 파라미터 추가
         type: CommonSchemas.MemoryType.optional(), // 확장된 MemoryTypeRequest 사용
         key: z.string().optional(),
         agent_id: z.string().optional().default('default'),
         // 기존 파라미터 유지
         memory_types: z.array(CommonSchemas.MemoryType).optional(),
         tags: z.array(z.string()).optional(),
         privacy_scope: z.array(CommonSchemas.PrivacyScope).optional(),
         time_from: z.string().optional(),
         time_to: z.string().optional(),
         pinned: z.boolean().optional(),
         importance_min: z.number().min(0).max(1).optional(),
         importance_max: z.number().min(0).max(1).optional(),
         limit: CommonSchemas.Limit,
         vector_weight: z.number().min(0).max(1).optional(),
         text_weight: z.number().min(0).max(1).optional(),
         enable_hybrid: z.boolean().optional(),
         include_metadata: z.boolean().optional()
       }).refine((data) => {
         // 조건부 필수 검증
         if (data.type === 'core' || data.type === 'vault') {
           // query는 선택적 (없어도 됨)
           return true;
         } else {
           // 나머지 타입은 query 필수
           if (!data.query) {
             return false;
           }
         }
         return true;
       }, {
         message: "type='core' 또는 'vault'가 아닌 경우 query 파라미터는 필수입니다"
       });
       ```
       **2단계: BaseTool inputSchema 확장 (29-100 라인)**
       ```typescript
       // Before (현재, 29-100 라인):
       super(
         'recall',
         '관련 기억을 검색합니다',
         {
           type: 'object',
           properties: {
             query: { 
               type: 'string', 
               description: '검색 쿼리' 
             },
             memory_types: { 
               type: 'array', 
               items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural'] }, // 4개만
               description: '기억 타입 필터 (선택사항)'
             },
             // ... 기존 필드 유지
           },
           required: ['query']
         }
       );
       
       // After (수정 후, 29-100 라인):
       super(
         'recall',
         '관련 기억을 검색합니다',
         {
           type: 'object',
           properties: {
             query: { 
               type: 'string', 
               description: '검색 쿼리 (type이 core 또는 vault가 아닌 경우 필수)' 
             },
             type: { 
               type: 'string', 
               enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'], // 확장
               description: '단일 메모리 타입 지정 (선택사항)'
             },
             key: { 
               type: 'string', 
               description: 'Core/Vault 조회 시 특정 키 지정 (선택사항)' 
             },
             agent_id: { 
               type: 'string', 
               description: '에이전트 ID (Core/Vault 조회 시 사용, 기본값: "default")' 
             },
             memory_types: { 
               type: 'array', 
               items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] }, // 확장: 런타임에서 필터링
               description: '기억 타입 필터 (선택사항, type 파라미터와 동시 사용 시 type 우선). core/vault는 자동으로 제거됩니다.'
             },
             // 기존 필드 유지
             tags: { 
               type: 'array', 
               items: { type: 'string' },
               description: '태그 필터 (선택사항)'
             },
             // ... 나머지 필드 유지
           },
           required: [] // 조건부 필수는 런타임 검증 (RecallSchema.refine()에서 처리)
         }
       );
       ```
       
       **3단계: handle 메서드에서 새 파라미터 처리 (9.2.3.2a 참조)**
     - **수정 순서**:
       1. `CommonSchemas.MemoryType` 확장 (9.1.1 참조)
       2. `RecallSchema` 확장 (1단계)
       3. `BaseTool inputSchema` 확장 (2단계)
       4. `handle` 메서드 수정 (3단계, 9.2.3.2a 참조)
     - **중요**: 
       - JSON Schema는 MCP 클라이언트가 요청을 생성하는 유일한 경로이므로 반드시 확장해야 함
       - `RecallSchema`와 `inputSchema`는 동기화되어야 함 (필드명, 타입, 설명 일치)
       - 조건부 필수 검증은 `RecallSchema.refine()`에서 처리하고, `inputSchema.required`는 빈 배열로 설정
       - `memory_types` enum은 6개 값으로 확장하되, 런타임에서 'core'/'vault' 필터링 (9.2.3.2a 참조)
     - 9.2.3.1. **파라미터 확장 및 정의**:
       - `type` (TEXT, optional): 단일 메모리 타입 지정 (`'core' | 'vault' | 'episodic' | 'semantic' | 'procedural' | 'working'`)
       - `key` (TEXT, optional): Core/Vault 조회 시 특정 키 지정 (없으면 전체 조회)
       - `agent_id` (TEXT, optional, default: "default"): 에이전트 ID (Core/Vault 조회 시 사용)
       - `query` (TEXT, conditional): 
         - `type='core'` 또는 `type='vault'`일 때: **선택적** (없으면 전체 조회 또는 키 기반 조회)
         - 나머지 타입: **필수** (검색 쿼리)
       - `memory_types` (ARRAY, optional): 기존 파라미터 유지 (하위 호환성)
     - 9.2.3.2. **파라미터 우선순위 및 병행 규칙**:
       - `type` 파라미터가 있으면: 단일 타입 조회 모드
       - `type`이 없으면: 기존 검색 모드 (`memory_types` 배열 사용)
       - `type`과 `memory_types` 동시 사용 시: **`type` 우선, `memory_types` 무시** (경고 로그 출력)
       - `type='core'` 또는 `type='vault'`일 때 `query` 제공 시: **무시** (경고 로그 출력, 조회는 진행)
     - 9.2.3.2a. **`memory_types` 배열에 'core'/'vault' 포함 시 처리 전략**:
       - **JSON Schema 정책**: `memory_types` 배열의 enum은 6개 값 모두 허용 ('working', 'episodic', 'semantic', 'procedural', 'core', 'vault')
         - **이유**: 
           - 클라이언트가 실수로 'core'/'vault'를 포함해도 런타임에서 처리 가능
           - `type` 파라미터와 `memory_types`를 동시에 사용할 때 유연성 확보
           - 하위 호환성 및 점진적 마이그레이션 지원
       - **런타임 처리 전략**: 자동 필터링 + 경고 로그
         ```typescript
         // memory_types 배열 전처리 (recall-tool.ts에서 실행)
         if (memory_types && memory_types.length > 0) {
           const invalidTypes = memory_types.filter(t => t === 'core' || t === 'vault');
           if (invalidTypes.length > 0) {
             // 경고 로그 출력
             this.logWarning('memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.', {
               invalid_types: invalidTypes,
               original_memory_types: memory_types,
               suggestion: 'Core/Vault 조회는 단일 type 파라미터를 사용하세요.'
             });
             // 'core', 'vault' 제거
             const filteredTypes = memory_types.filter(t => t !== 'core' && t !== 'vault');
             
             // 모든 타입이 제거되면 에러
             if (filteredTypes.length === 0) {
               throw new Error("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요.");
             }
             
             // 필터링된 배열로 교체
             memory_types = filteredTypes;
           }
         }
         
         // 타입 가드 적용 (MemoryTypeRequest[] -> MemoryType[])
         const validMemoryTypes = memory_types.filter(isMemoryItemType) as MemoryType[];
         ```
       - **처리 흐름**:
         1. JSON Schema 검증: 6개 값 모두 허용 (클라이언트 요청 생성 가능)
         2. 런타임 전처리: 'core'/'vault' 자동 제거 + 경고 로그
         3. 타입 가드 적용: `MemoryTypeRequest[]` -> `MemoryType[]` 변환
         4. 검색 엔진 호출: `MemoryType[]` 사용 (memory_item 검색)
       - **에러 메시지**: 
         - 경고: "memory_types 배열에서 'core'/'vault'는 자동으로 제거됩니다. Core/Vault 조회는 단일 type 파라미터를 사용하세요."
         - 에러 (모든 타입 제거 시): "memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요."
       - **하위 호환성**: 
         - 기존 클라이언트: `memory_types`에 4개 값만 사용 (변경 없음)
         - 신규 클라이언트: 실수로 'core'/'vault' 포함 시 자동 필터링 + 경고
         - 점진적 마이그레이션: 클라이언트가 경고를 보고 올바른 사용법 학습
       - **동일한 처리 적용 위치**:
         - `src/tools/recall-tool.ts`: `memory_types` 배열 처리
         - `src/tools/memory-injection-prompt.ts`: `memory_types` 배열 처리
     - 9.2.3.3. **Core Memory 조회 로직 및 API 계약**:
       ```typescript
       if (type === 'core') {
         // agent_id 처리: 파라미터에서 받거나 기본값 "default" 사용
         const agentId = params.agent_id || 'default';
         
         if (key) {
           // 특정 키 조회
           - CoreMemoryService.findByKey(agentId, key)
           - 응답: 단일 Core Memory 객체 또는 null
           - query 파라미터 무시 (제공되면 경고 로그)
         } else {
           // 전체 Core Memory 조회 (query 없이)
           - CoreMemoryService.findAll(agentId)
           - 응답: Core Memory 배열
           - query 파라미터 무시 (제공되면 경고 로그)
         }
         - 메모리 캐시 우선 조회 (always_load=true인 경우)
         - 검색 엔진 사용 안 함
         - memory_types 파라미터 무시 (제공되면 경고 로그)
       }
       ```
     - 9.2.3.4. **Knowledge Vault 조회 로직 및 API 계약**:
       ```typescript
       if (type === 'vault') {
         // agent_id 처리: 파라미터에서 받거나 기본값 "default" 사용
         const agentId = params.agent_id || 'default';
         
         if (key) {
           // 특정 키 조회 (활성 버전만)
           - KnowledgeVaultService.findByKey(agentId, key, deleted_at IS NULL)
           - 응답: 단일 Vault 객체 또는 null
           - query 파라미터 무시 (제공되면 경고 로그)
         } else {
           // 전체 Vault 조회 (활성 버전만, query 없이)
           - KnowledgeVaultService.findAll(agentId, deleted_at IS NULL)
           - 응답: Vault 배열
           - query 파라미터 무시 (제공되면 경고 로그)
         }
         - 검색 엔진 사용 안 함
         - memory_types 파라미터 무시 (제공되면 경고 로그)
       }
       ```
     - 9.2.3.5. **Memory Item 조회 로직 (기존)**:
       ```typescript
       else {
         // query 필수 검증 (refine에서 이미 검증했지만, 명시적으로 확인)
         if (!query) {
           throw new Error("query 파라미터는 필수입니다 (type='core' 또는 'vault'가 아닌 경우)");
         }
         
         // memory_types 배열 전처리 ('core'/'vault' 제거)
         let filteredMemoryTypes = memory_types;
         if (memory_types && memory_types.length > 0) {
           const invalidTypes = memory_types.filter(t => t === 'core' || t === 'vault');
           if (invalidTypes.length > 0) {
             this.logWarning('memory_types에서 core/vault 제거', { invalidTypes });
             filteredMemoryTypes = memory_types.filter(t => t !== 'core' && t !== 'vault');
             if (filteredMemoryTypes.length === 0) {
               throw new Error("memory_types 배열에 유효한 타입이 없습니다.");
             }
           }
         }
         
         - 하이브리드 검색 엔진 사용
         - filteredMemoryTypes 배열로 필터링 (기존 로직)
         - agent_id 파라미터 무시 (제공되면 경고 로그)
       }
       ```
     - 9.2.3.6. **JSON 요청 예시**:
       ```json
       // Core Memory 전체 조회
       {
         "type": "core"
       }
       
       // Core Memory 특정 키 조회
       {
         "type": "core",
         "key": "persona",
         "agent_id": "default"
       }
       
       // Knowledge Vault 전체 조회
       {
         "type": "vault"
       }
       
       // Knowledge Vault 특정 키 조회
       {
         "type": "vault",
         "key": "user_rules",
         "agent_id": "default"
       }
       
       // Memory Item 검색 (기존과 동일)
       {
         "query": "React hooks",
         "memory_types": ["episodic", "semantic"],
         "limit": 10
       }
       
       // Memory Item 검색 (새로운 방식)
       {
         "type": "episodic",
         "query": "React hooks",
         "limit": 10
       }
       ```
     - 9.2.3.7. **응답 형식 통일**:
       - Core Memory 조회 응답:
         ```json
         // 단일 조회
         {
           "items": [{
             "memory_id": "core_1234567890_abc",
             "type": "core",
             "key": "persona",
             "value": "I am a helpful assistant",
             "always_load": true,
             "created_at": "2025-01-01T00:00:00Z"
           }],
           "total_count": 1,
           "query_time": 5
         }
         
         // 전체 조회
         {
           "items": [
             { "memory_id": "core_1", "type": "core", "key": "persona", "value": "..." },
             { "memory_id": "core_2", "type": "core", "key": "instructions", "value": "..." }
           ],
           "total_count": 2,
           "query_time": 10
         }
         ```
       - Knowledge Vault 조회 응답: Core Memory와 동일한 형식
       - Memory Item 검색 응답: 기존과 동일한 형식 유지
   - 9.2.4. **하위 호환성 전략**:
     - 기존 클라이언트: `query` + `memory_types` 배열 사용 (변경 없음)
       - `query` 필수, `memory_types` 배열로 필터링
       - Core/Vault 조회 불가 (기존 동작 유지)
     - 새로운 클라이언트: `type` 단일 파라미터 사용 가능
       - `type='core'` 또는 `type='vault'`: `query` 선택적, `key`로 특정 조회 가능
       - `type='episodic'`, `'semantic'`, `'procedural'`, `'working'`: `query` 필수 (기존과 동일)
     - `type`과 `memory_types` 동시 사용 시: `type` 우선, `memory_types` 무시 (경고 로그)
     - `type='core'` 또는 `type='vault'`일 때 `query` 제공 시: 무시 (경고 로그)
   - 9.2.5. **에러 처리 및 검증**:
     - **스키마 레벨 검증**: `RecallSchema.refine()`을 사용한 조건부 필수 검증
       - `type='core'` 또는 `type='vault'`일 때: `query` 선택적 (없어도 됨)
       - 나머지 타입: `query` 필수 (없으면 에러)
     - **런타임 검증**:
       - `type`이 없고 `query`도 없으면: 에러 반환 ("query 파라미터는 필수입니다")
       - `type='core'` 또는 `type='vault'`가 아닌데 `query` 없으면: 에러 반환
     - **파라미터 병행 처리**:
       - `type`과 `memory_types` 동시 사용: 경고 로그, `type` 우선 적용, `memory_types` 무시
       - `type='core'` 또는 `type='vault'`일 때 `query` 제공: 경고 로그, 무시
       - `memory_types` 배열에 'core'/'vault' 포함: 자동 필터링, 경고 로그, 나머지 타입으로 검색 진행
       - `memory_types` 배열에 'core'/'vault'만 포함: 에러 반환 ("유효한 타입이 없습니다")
9.3. `auto_reflect` 내부 함수 추가 (internal only, Phase 2에서 구현)
   - Reflexion Worker가 백그라운드에서 호출
   - MCP Tool로 노출되지 않음
   - 이번 단계에서는 스키마만 준비
9.4. `migrate` 내부 CLI 명령 추가 (internal only)
   - 설치 시 자동 감지 후 스키마 업데이트
   - MCP Tool로 노출되지 않음
9.5. **`remember`/`recall` Tool 처리 흐름 상세**
   - 9.5.1. **`remember` Tool 분기 로직**:
     ```typescript
     if (type === 'core') {
       // Core Memory 저장
       - key, value 파라미터 검증 (필수)
       - content 파라미터는 선택적 (검증 생략)
       - CoreMemoryService.save() 호출
       - core_memory 테이블에 INSERT
       - always_load=true인 경우 메모리 캐시에 로드
       - 임베딩/FTS/VEC 인덱싱은 수행하지 않음
       - 응답: { memory_id: core_id, type: 'core', ... }
     } else if (type === 'vault') {
       // Knowledge Vault 저장
       - key, value 파라미터 검증 (필수)
       - content 파라미터는 선택적 (검증 생략)
       - KnowledgeVaultService.save() 호출
       - knowledge_vault 테이블에 INSERT
       - immutable=true인 경우 업데이트/삭제 검증
       - 임베딩/FTS/VEC 인덱싱은 수행하지 않음
       - 응답: { memory_id: vault_id, type: 'vault', ... }
     } else {
       // 기존 memory_item 저장 (episodic, semantic, procedural, working)
       - content 파라미터 검증 (필수)
       - MemoryItemService.save() 호출
       - memory_item 테이블에 INSERT
       - 임베딩 생성 및 FTS/VEC 인덱싱 수행
       - 응답: { memory_id: id, type: type, ... }
     }
     ```
   - 9.5.2. **`recall` Tool 분기 로직**:
     ```typescript
     // 파라미터 우선순위: type > memory_types
     if (type === 'core') {
       // Core Memory 조회 (query 선택적)
       if (key) {
         // 특정 키 조회
         - CoreMemoryService.findByKey(agent_id, key)
         - 응답: 단일 Core Memory 객체 또는 null
       } else {
         // 전체 Core Memory 조회
         - CoreMemoryService.findAll(agent_id)
         - 응답: Core Memory 배열
       }
       - 메모리 캐시 우선 조회 (always_load=true인 경우)
       - 검색 엔진 사용 안 함 (query 무시)
     } else if (type === 'vault') {
       // Knowledge Vault 조회 (query 선택적)
       if (key) {
         // 특정 키 조회 (활성 버전만)
         - KnowledgeVaultService.findByKey(agent_id, key, deleted_at IS NULL)
         - 응답: 단일 Vault 객체 또는 null
       } else {
         // 전체 Vault 조회 (활성 버전만)
         - KnowledgeVaultService.findAll(agent_id, deleted_at IS NULL)
         - 응답: Vault 배열
       }
       - 검색 엔진 사용 안 함 (query 무시)
     } else {
       // 기존 memory_item 검색 (query 필수)
       - query 파라미터 검증 (필수)
       - memory_types 배열로 필터링 (기존 로직)
       - 하이브리드 검색 엔진 사용
       - memory_item 테이블에서 검색
       - FTS/VEC 검색 지원
       - 응답: 검색 결과 배열
     }
     ```
   - 9.5.3. **서비스 레이어 분리**:
     - `CoreMemoryService`: Core Memory 전용 서비스 (새로 생성)
     - `KnowledgeVaultService`: Knowledge Vault 전용 서비스 (새로 생성)
     - `MemoryItemService`: 기존 memory_item 서비스 (기존 로직 유지)
   - 9.5.4. **DAO 레이어 분리**:
     - `CoreMemoryRepository`: core_memory 테이블 접근 (새로 생성)
     - `KnowledgeVaultRepository`: knowledge_vault 테이블 접근 (새로 생성)
     - `MemoryItemRepository`: memory_item 테이블 접근 (기존 유지)
   - 9.5.5. **캐시 연동**:
     - Core Memory: `always_load=true`인 항목은 서버 시작 시 메모리 캐시에 로드
     - Core Memory 변경 시 캐시 자동 업데이트
     - Knowledge Vault: 캐시 사용 안 함 (불변 데이터)
     - Memory Item: 기존 캐시 로직 유지
   - 9.5.6. **응답 형식 정의**:
     - **통일된 응답 필드**: 모든 타입에서 `memory_id` 필드 사용 (클라이언트 호환성)
     - **응답 필드 매핑**:
       - `type='core'`: `memory_id` = `core_id` (core_memory 테이블의 core_id)
       - `type='vault'`: `memory_id` = `vault_id` (knowledge_vault 테이블의 vault_id)
       - `type='episodic'`, `'semantic'`, `'procedural'`, `'working'`: `memory_id` = `id` (memory_item 테이블의 id)
     - **응답 예시**:
       ```json
       // Core Memory 응답
       {
         "memory_id": "core_1234567890_abc",
         "type": "core",
         "key": "persona",
         "value": "I am a helpful assistant",
         "always_load": true,
         "created_at": "2025-01-01T00:00:00Z"
       }
       
       // Knowledge Vault 응답
       {
         "memory_id": "vault_1234567890_xyz",
         "type": "vault",
         "key": "user_rules",
         "value": "Never share personal information",
         "immutable": true,
         "created_at": "2025-01-01T00:00:00Z"
       }
       
       // Memory Item 응답 (기존과 동일)
       {
         "memory_id": "mem_1234567890_def",
         "type": "episodic",
         "content": "User asked about React hooks",
         "importance": 0.7,
         "created_at": "2025-01-01T00:00:00Z"
       }
       ```
     - **하위 호환성**: 기존 클라이언트는 `memory_id` 필드로 모든 타입의 메모리를 식별 가능

9.6. **호환성 전략**
   - 9.6.1. 버전 플래그: `memento_schema_version`으로 클라이언트가 지원하는 기능 확인 가능
   - 9.6.2. 마이그레이션 가이드: PRD에 포함된 마이그레이션 가이드를 문서화하여 제공
   - 9.6.3. 자동 Fallback: Phase 1-2에서는 기본값으로 동작하여 기존 클라이언트 중단 방지

### 10. Core Memory 자동 로드
10.1. 서버 시작 시 `always_load=true`인 Core Memory 자동 로드
10.2. 로드된 Core Memory는 메모리에 유지되어 빠른 접근 가능
10.3. Core Memory 변경 시 메모리 캐시 자동 업데이트
10.4. `recall(type='core')` 호출 시 메모리 캐시 우선 조회

## Non-Goals (Out of Scope)

1. **성능 최적화**: 기능 구현 우선, 성능 최적화는 후속 작업으로 진행
2. **PostgreSQL 마이그레이션**: 이번 단계에서는 SQLite만 지원, PostgreSQL 확장은 별도 작업
3. **Consolidation Engine**: Consolidation 기능은 이번 단계에서 제외 (향후 확장)
4. **UI/대시보드**: 스키마 변경에 대한 UI는 이번 단계에서 제외
5. **다중 에이전트 지원**: 이번 단계에서는 단일 에이전트 환경만 고려 (단, 향후 확장을 위해 `agent_id` 필드는 스키마에 포함)
6. **메모리 타입 간 자동 변환**: 사용자가 명시적으로 타입을 지정해야 함
7. **Reflexion 자동 실행 (Phase 2)**: Reflexion Worker의 자동 실행은 Phase 2에서 구현, 이번 단계(Phase 1)에서는 수동 호출만 지원
8. **Knowledge Vault 버전 관리 로직**: 버전 관리 스키마는 구현하지만, 실제 버전 관리 로직(버전 비교, 이전 버전 조회 등)은 후속 작업
9. **Knowledge Vault 관리자 Override**: 관리자 권한 모델 및 override 플로우는 후속 작업

## Design Considerations

### 데이터베이스 스키마 설계
- **하이브리드 구조**: 
  - 기존 `memory_item` 테이블 확장: Episodic, Semantic, Procedural Memory는 `memory_item`에 저장 (기존 의존성 유지)
  - 별도 테이블: Core Memory(`core_memory`), Knowledge Vault(`knowledge_vault`)는 별도 테이블로 분리
- **기존 의존성 유지**:
  - `memory_embedding` 테이블은 `memory_item.id`를 FK로 참조 (변경 없음)
  - FTS5 가상 테이블과 트리거는 `memory_item` 테이블에 의존 (변경 없음)
  - VEC 테이블과 트리거는 `memory_embedding` 테이블에 의존 (변경 없음)
  - `memory_tag`, `memory_item_tag`, `memory_link`, `feedback_event`는 `memory_item`을 참조 (변경 없음)
- **인덱스**: 
  - `core_memory`: `agent_id`, `key`, `created_at` 인덱스 생성
  - `knowledge_vault`: `agent_id`, `key`, `version`, `deleted_at` 인덱스 생성
  - `memory_item`: 기존 인덱스 유지, `origin_source` JSON 인덱스 추가 고려
  - **참고**: `agent_id` 인덱스는 향후 다중 에이전트 지원을 위한 것이며, 현재 단일 에이전트 환경에서도 프로필 구분 등에 활용 가능
- **메타데이터**: `memento_schema_version` 테이블로 스키마 버전 관리
- **마이그레이션 이력**: `migration_history` 테이블로 마이그레이션 이력 추적

### MCP Protocol 설계
- **API 파라미터 확장**: 
  - `remember` Tool에 `key`, `value`, `always_load`, `immutable`, `task_goal`, `steps`, `reflection_notes` 파라미터 추가
  - 조건부 필수 파라미터: `type`에 따라 필수 파라미터가 달라짐
  - 하위 호환성: 기존 파라미터(`content`, `tags`, `importance`, `source`, `privacy_scope`)는 계속 지원
- **`recall` Tool 확장**:
  - `type` 파라미터 추가 (단일 값, 선택적)
  - `key` 파라미터 추가 (Core/Vault 조회 시 특정 키 지정)
  - `query` 파라미터 조건부 필수: `type='core'` 또는 `type='vault'`일 때 선택적, 나머지는 필수
  - `memory_types` 배열 파라미터 유지 (하위 호환성)
  - 파라미터 우선순위: `type` > `memory_types` (동시 사용 시 `type` 우선)
- **타입 정의 확장**:
  - 애플리케이션 레이어: `MemoryType` enum에 `'core'`, `'vault'` 추가
    - 서버 타입 정의(`src/tools/types.ts`, `src/types/index.ts`) 확장
    - 클라이언트 타입 정의(`src/npm-client/types.ts`) 확장
  - 데이터베이스 레이어: `memory_item` 테이블의 CHECK 제약은 변경하지 않음
    - `memory_item.type`은 여전히 `'working'`, `'episodic'`, `'semantic'`, `'procedural'`만 허용
    - `core`와 `vault`는 별도 테이블에 저장되므로 `memory_item` 제약과 무관
- **처리 흐름 분기**:
  - `remember` Tool: `type`에 따라 다른 서비스/DAO 사용
  - `recall` Tool: `type`에 따라 조회 방식 분기
    - Core/Vault: 키 기반 또는 전체 조회 (검색 엔진 사용 안 함)
    - Memory Item: 기존 검색 로직 유지 (하이브리드 검색)
  - Core/Vault는 별도 테이블, 나머지는 `memory_item` 테이블 사용
  - 임베딩/FTS/VEC 인덱싱은 `memory_item`에만 적용 (Core/Vault는 제외)
- **타입 명시화**: 단계적 롤아웃을 통해 `remember`/`recall` 호출에 `type` 파라미터를 점진적으로 필수화
- **하위 호환성**: Phase 1-2에서는 기본값(`episodic`)으로 동작하여 기존 클라이언트 중단 방지
- **에러 메시지**: Phase 3부터는 명확한 에러 메시지 제공 (마이그레이션 가이드 포함)
- **버전 관리**: `memento_schema_version`으로 클라이언트가 지원하는 기능 확인 가능

### Reflexion Worker 설계 (Phase 1: 인프라만)
- **Phase 1**: Reflexion 기록을 위한 스키마 및 수동 호출 인터페이스만 구현
- **Phase 2 (후속)**: 자동 실패 감지 및 백그라운드 Reflexion 기록
  - 실패 감지 시 비동기로 Reflexion 기록
  - 에러 처리: Reflexion 기록 실패 시에도 메인 프로세스에 영향 없음
  - 로깅: 모든 Reflexion 기록은 로그로 추적

### 마이그레이션 설계
- **안전성 우선**: 데이터 손실 방지를 위한 다단계 검증
- **롤백 지원**: 각 단계별 롤백 포인트 설정 및 자동 롤백 시도
- **실패 대응**: 롤백 실패 시 수동 복구 가이드 제공
- **로깅**: 마이그레이션 과정의 모든 단계를 로그로 기록 (`data/logs/migration_*.log`)
- **백업 관리**: 백업 파일 위치 명시 및 보존 기간 설정 (기본 30일)

## Technical Considerations

### SQLite 호환성
- SQLite 3.x 버전 지원
- FTS5 및 sqlite-vss 확장 기능 활용
- 트랜잭션을 통한 데이터 무결성 보장

### 마이그레이션 전략
- **점진적 마이그레이션**: 기존 `memory_item` 데이터는 그대로 유지하고 필드만 추가
- **의존성 보존**: 기존 `memory_embedding`, FTS5, VEC 트리거 및 인덱스는 그대로 유지
- **트랜잭션 기반**: 모든 마이그레이션 작업을 트랜잭션으로 처리
- **검증 단계**: 마이그레이션 후 데이터 무결성 검증 및 의존성 동작 확인
- **하위 호환성**: 기존 `memory_item` 기반 쿼리와 인덱스는 계속 작동

### Core Memory 캐싱
- 서버 시작 시 `always_load=true`인 Core Memory를 메모리에 로드
- 변경 시 캐시 무효화 및 재로드
- 메모리 사용량 모니터링

### origin_source JSON 파싱
- JSON 형식 검증
- 파싱 실패 시 기본값 사용
- 성능을 위한 JSON 인덱싱 고려 (SQLite JSON1 확장)

### 에러 처리
- 마이그레이션 실패 시 자동 롤백
- Reflexion 기록 실패 시 로그만 기록 (메인 프로세스 영향 없음)
- MCP Tool 호출 시 명확한 에러 메시지 제공
- **API 파라미터 검증**: `type`에 따라 필수 파라미터 검증
  - `type='core'` 또는 `type='vault'`: `key`, `value` 필수 검증, `content`는 선택적 (검증 생략)
  - `type='procedural'`: `content` 필수, `task_goal`, `steps`, `reflection_notes`는 선택적
  - `type='episodic'` 또는 `type='semantic'`: 기존과 동일 (`content` 필수)
- **응답 형식 통일**: 모든 타입에서 `memory_id` 필드 사용
  - Core: `memory_id` = `core_id`
  - Vault: `memory_id` = `vault_id`
  - Memory Item: `memory_id` = `id`

### 성능 고려사항
- 기능 구현 우선, 성능 최적화는 후속 작업
- 대량 데이터 마이그레이션 시 배치 처리 고려
- Core Memory 캐시로 인한 메모리 사용량 증가 모니터링

## Success Metrics

1. **스키마 마이그레이션 지표**
   - 마이그레이션 성공률 목표: 99% 이상 (I/O 오류, 디스크 공간 부족 등 예외 상황 제외)
   - 데이터 손실률 목표: 0.1% 이하 (99.9% 이상 보존)
   - 마이그레이션 완료 시간: 평균 5분 이내 (데이터 크기에 따라 변동)
   - 롤백 성공률 목표: 95% 이상 (롤백 실패 시 수동 복구 절차 제공)

2. **기능 완성도**
   - 5대 메모리 타입 모두 구현: 100%
   - MCP Tool `type` 파라미터 Phase 1 구현: 100% (경고 로그 + 기본값 fallback)
   - MCP Tool `type` 파라미터 Phase 2 구현: 후속 작업 (Deprecation 경고)
   - MCP Tool `type` 파라미터 Phase 3 구현: 후속 작업 (Hard Error, v3.0.0)
   - Core Memory 자동 로드: 100%

3. **Reflexion 기록 인프라 (Phase 1)**
   - `reflection_notes` 필드 구현 완료: 100%
   - 수동 Reflexion 기록 기능: 100%
   - **Phase 2 (후속 작업) 지표**:
     - 실패 감지 정확도: 90% 이상
     - Reflexion 기록 성공률: 95% 이상
     - 동일 task 재시도 시 개선률: 30% 이상 (향후 측정)

4. **데이터 추적**
   - `origin_source` 필드 채움률: 100%
   - JSON 형식 검증 통과율: 100%

5. **안정성 지표**
   - 마이그레이션 롤백 성공률 목표: 95% 이상
   - 서버 시작 시 Core Memory 로드 성공률: 100%
   - MCP Tool 호출 에러율: Phase 1-2에서는 1% 이하 (기본값 fallback으로 인한 에러 최소화), Phase 3에서는 5% 이하 (type 파라미터 필수화로 인한 초기 적응 기간 고려)

6. **성능 지표** (참고용, 후속 최적화 목표)
   - `recall` 지연시간: 기존 대비 20% 이상 단축 (향후 최적화)
   - Core Memory 캐시 히트율: 95% 이상

## Open Questions

1. **마이그레이션 백업 보존 기간**: 기본 30일로 설정했으나, 실제 운영 환경에서 적절한 보존 기간은? (데이터 크기, 디스크 공간 고려)
2. **Core Memory 캐시 크기 제한**: `always_load=true`인 Core Memory가 많을 경우 메모리 사용량 제한이 필요한가? 제한이 있다면 어떤 전략을 사용할 것인가?
3. **Reflexion 기록 빈도 (Phase 2)**: 동일한 실패가 반복될 경우 Reflexion 기록 빈도 제한이 필요한가? 중복 방지 전략은?
4. **origin_source 컨텍스트 정보**: 어떤 수준의 컨텍스트 정보를 `origin_source`에 포함해야 하는가? 성능과 상세도 간의 균형은?
5. **type 파라미터 단계별 롤아웃 일정**: Phase 1-3의 구체적인 릴리즈 일정은? 각 단계 간 간격은 얼마나 두는 것이 적절한가?
6. **성능 최적화 우선순위**: 기능 구현 후 어떤 성능 최적화를 우선적으로 진행할 것인가?
7. **다중 에이전트 지원**: 향후 다중 에이전트 환경을 고려할 때 스키마 설계에 추가 고려사항이 있는가? `agent_id` 필드의 기본값 전략은?
8. **Knowledge Vault 버전 관리**: 버전 관리 로직 구현 시 이전 버전 조회 API가 필요한가? 버전 히스토리 보존 기간은?
9. **마이그레이션 재시도 전략**: 사용자가 문제 해결 후 수동으로 재시도하는 것이 적절한가? 자동 재시도 옵션을 제공할 것인가?

