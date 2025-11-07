# Tasks: MIRIX 기반 인지 스키마 확장 및 데이터 모델 리팩토링

이 문서는 `0003-prd-mirix-cognitive-schema-expansion.md` PRD를 기반으로 생성된 구현 작업 목록입니다.

## Relevant Files

### 타입 시스템
- `src/types/index.ts` - 타입 정의 (MemoryType, MemoryTypeRequest, 타입 가드 함수) (수정됨)
- `src/types/index.spec.ts` - 타입 시스템 테스트 (신규 생성)
- `src/tools/types.ts` - MCP Tool 공통 스키마 (CommonSchemas.MemoryType 확장)
- `src/npm-client/types.ts` - 클라이언트 타입 확장
- `src/npm-client/utils.ts` - 클라이언트 유틸리티 함수 확장 (수정됨)
- `src/npm-client/utils.spec.ts` - 클라이언트 유틸리티 테스트 (신규 생성)
- `src/npm-client/memory-manager.ts` - 클라이언트 메모리 매니저 수정

### 데이터베이스 스키마 및 마이그레이션
- `src/database/schema.sql` - 데이터베이스 스키마 정의 (업데이트)
- `src/database/migration/` - 마이그레이션 스크립트 디렉토리 (신규 생성)
- `src/database/migration/002-mirix-schema-expansion.ts` - MIRIX 스키마 확장 마이그레이션 스크립트 (신규 생성)
- `src/database/migration-detector.ts` - 마이그레이션 자동 감지 로직 (신규 생성 또는 기존 파일 확장)
- `src/database/init.ts` - 데이터베이스 초기화 로직 (마이그레이션 통합)

### Repository 레이어
- `src/repositories/core-memory-repository.ts` - Core Memory DAO (신규 생성)
- `src/repositories/core-memory-repository.spec.ts` - Core Memory Repository 테스트 (신규 생성)
- `src/repositories/knowledge-vault-repository.ts` - Knowledge Vault DAO (신규 생성)
- `src/repositories/knowledge-vault-repository.spec.ts` - Knowledge Vault Repository 테스트 (신규 생성)

### Service 레이어
- `src/services/core-memory-service.ts` - Core Memory 서비스 (신규 생성)
- `src/services/core-memory-service.spec.ts` - Core Memory 서비스 테스트 (신규 생성)
- `src/services/knowledge-vault-service.ts` - Knowledge Vault 서비스 (신규 생성)
- `src/services/knowledge-vault-service.spec.ts` - Knowledge Vault 서비스 테스트 (신규 생성)
- `src/services/core-memory-cache-service.ts` - Core Memory 캐시 서비스 (신규 생성 또는 기존 cache-service 확장)

### MCP Tools
- `src/tools/remember-tool.ts` - remember Tool 확장 (JSON Schema, Zod Schema, handle 메서드)
- `src/tools/remember-tool.spec.ts` - remember Tool 테스트 (신규 생성 또는 수정)
- `src/tools/recall-tool.ts` - recall Tool 확장 (JSON Schema, Zod Schema, handle 메서드)
- `src/tools/recall-tool.spec.ts` - recall Tool 테스트 (신규 생성 또는 수정)
- `src/tools/memory-injection-prompt.ts` - memory_injection Tool 수정 (memory_types enum 확장)

### 서버 초기화 및 설정
- `src/server/index.ts` - 서버 시작 시 마이그레이션 자동 실행 및 Core Memory 자동 로드 로직
- `src/utils/type-param-validator.ts` - type 파라미터 단계별 검증 유틸리티 (신규 생성 또는 기존 파일 확장)
- `src/config/index.ts` - 환경 변수 파싱 (MEMENTO_TYPE_PARAM_MODE 포함)

### Notes

- 단위 테스트는 각 파일과 동일한 디렉토리에 `.spec.ts` 확장자로 배치합니다.
- `npm test` 명령으로 전체 테스트를 실행할 수 있습니다.
- 마이그레이션 스크립트는 `src/database/migration/` 디렉토리에 버전별로 관리합니다.

## Tasks

- [ ] 1.0 타입 시스템 확장 및 분리 전략 구현
  - [x] 1.1 `src/types/index.ts`에 `MemoryTypeRequest` 타입 추가 및 `isMemoryItemType()` 타입 가드 함수 구현
  - [x] 1.2 `src/tools/types.ts`에서 `CommonSchemas.MemoryType` enum을 6개 값으로 확장 ('core', 'vault' 추가)
  - [x] 1.3 `src/npm-client/types.ts`에서 `MemoryType`을 `MemoryTypeRequest`로 확장
  - [x] 1.4 `src/npm-client/utils.ts`에서 `isValidMemoryType()` 함수를 6개 값으로 확장
  - [x] 1.5 타입 시스템 변경사항에 대한 단위 테스트 작성 (`src/types/index.spec.ts`, `src/npm-client/utils.spec.ts`)

- [ ] 2.0 데이터베이스 스키마 마이그레이션 구현
  - [ ] 2.1 `src/database/migration/` 디렉토리 생성 및 마이그레이션 스크립트 구조 설계
  - [ ] 2.2 `core_memory` 테이블 생성 SQL 작성 (필드: core_id, agent_id, key, value, always_load, origin_source, created_at, updated_at)
  - [ ] 2.3 `knowledge_vault` 테이블 생성 SQL 작성 (필드: vault_id, agent_id, key, value, immutable, version, previous_version_id, admin_override, deleted_at, origin_source, created_at, updated_at)
  - [ ] 2.4 `memory_item` 테이블에 필드 추가 SQL 작성 (origin_source, task_goal, steps, reflection_notes)
  - [ ] 2.5 `core_memory` 및 `knowledge_vault` 테이블 인덱스 생성 SQL 작성
  - [ ] 2.6 `memento_schema_version` 메타데이터 테이블 생성 SQL 작성 (스키마 버전 관리용)
  - [ ] 2.7 마이그레이션 스크립트 작성 (`src/database/migration/002-mirix-schema-expansion.ts` 또는 `.sql`)
  - [ ] 2.8 기존 의존성 검증 로직 구현 (memory_embedding FK, FTS5 트리거, VEC 트리거 확인)
  - [ ] 2.9 마이그레이션 스크립트 단위 테스트 작성

- [ ] 3.0 Core Memory 및 Knowledge Vault 서비스 레이어 구현
  - [ ] 3.1 `src/repositories/core-memory-repository.ts` 구현 (CRUD 작업, agent_id/key 기반 조회)
  - [ ] 3.2 `src/repositories/knowledge-vault-repository.ts` 구현 (CRUD 작업, agent_id/key 기반 조회, 활성 버전만 조회)
  - [ ] 3.3 `src/services/core-memory-service.ts` 구현 (비즈니스 로직, 캐시 연동, always_load 처리)
  - [ ] 3.4 `src/services/knowledge-vault-service.ts` 구현 (비즈니스 로직, immutable 검증)
  - [ ] 3.5 Core Memory 캐시 서비스 구현 (`src/services/core-memory-cache-service.ts` 또는 기존 cache-service 확장)
  - [ ] 3.6 Repository 레이어 단위 테스트 작성 (`src/repositories/core-memory-repository.spec.ts`, `src/repositories/knowledge-vault-repository.spec.ts`)
  - [ ] 3.7 Service 레이어 단위 테스트 작성 (`src/services/core-memory-service.spec.ts`, `src/services/knowledge-vault-service.spec.ts`)

- [ ] 4.0 MCP Tool 확장 (remember/recall) 구현
  - [ ] 4.1 `src/tools/remember-tool.ts`에서 `RememberSchema` (Zod) 확장 (새 필드 추가, 조건부 필수 검증)
  - [ ] 4.2 `src/tools/remember-tool.ts`에서 BaseTool `inputSchema` 확장 (type enum 확장, 새 필드 추가)
  - [ ] 4.3 `src/tools/remember-tool.ts`의 `handle` 메서드에서 type 분기 로직 구현 (core/vault는 별도 서비스, 나머지는 기존 로직)
  - [ ] 4.4 `src/tools/recall-tool.ts`에서 `RecallSchema` (Zod) 확장 (query optional, type/key/agent_id 추가, memory_types 확장)
  - [ ] 4.5 `src/tools/recall-tool.ts`에서 BaseTool `inputSchema` 확장 (type/key/agent_id 추가, memory_types enum 확장)
  - [ ] 4.6 `src/tools/recall-tool.ts`의 `handle` 메서드에서 type 분기 로직 구현 (core/vault는 별도 서비스, memory_types 필터링)
  - [ ] 4.7 `src/tools/memory-injection-prompt.ts`에서 `memory_types` enum을 `CommonSchemas.MemoryType`으로 변경 및 런타임 필터링 구현
  - [ ] 4.8 `origin_source` 필드 자동 생성 로직 구현 (remember Tool 호출 시)
  - [ ] 4.9 recall Tool 응답에 `origin_source` 필드 포함 로직 구현 (모든 메모리 타입에 대해)
  - [ ] 4.10 remember Tool 단위 테스트 작성 (모든 타입별 시나리오)
  - [ ] 4.11 recall Tool 단위 테스트 작성 (모든 타입별 시나리오, memory_types 필터링, origin_source 반환 검증)

- [ ] 5.0 type 파라미터 단계별 롤아웃 구현
  - [ ] 5.1 환경 변수 파싱 로직 구현 (`MEMENTO_TYPE_PARAM_MODE` 파싱, 기본값: 'warn')
  - [ ] 5.2 type 파라미터 검증 유틸리티 함수 구현 (`src/utils/type-param-validator.ts` 또는 기존 파일 확장)
  - [ ] 5.3 Phase 1 (warn 모드) 구현: type 파라미터 없을 시 경고 로그 출력 및 기본값 적용
  - [ ] 5.4 Phase 2 (deprecate 모드) 구현: type 파라미터 없을 시 Deprecation 경고 반환 및 기본값 적용
  - [ ] 5.5 Phase 3 (error 모드) 구현: type 파라미터 없을 시 Hard Error 반환
  - [ ] 5.6 remember Tool에 단계별 검증 로직 통합 (환경 변수 모드에 따라 분기)
  - [ ] 5.7 recall Tool에 단계별 검증 로직 통합 (환경 변수 모드에 따라 분기, 필요 시)
  - [ ] 5.8 단계별 롤아웃 기능 단위 테스트 작성 (각 모드별 시나리오)

- [ ] 6.0 마이그레이션 자동화 및 Core Memory 자동 로드 구현
  - [ ] 6.1 마이그레이션 자동 감지 로직 구현 (`src/database/migration-detector.ts` 또는 기존 파일 확장)
  - [ ] 6.2 마이그레이션 실행 로직 구현 (백업 생성, 트랜잭션 처리, 단계별 검증)
  - [ ] 6.3 마이그레이션 롤백 로직 구현 (실패 시 자동 롤백, 백업 복원)
  - [ ] 6.4 마이그레이션 로깅 시스템 구현 (`data/logs/migration_*.log`)
  - [ ] 6.5 서버 시작 시 마이그레이션 자동 실행 로직 구현 (`src/server/index.ts` 또는 `src/database/init.ts`)
  - [ ] 6.6 서버 시작 시 Core Memory 자동 로드 로직 구현 (`always_load=true`인 항목만)
  - [ ] 6.7 Core Memory 캐시 무효화 및 재로드 로직 구현 (변경 시 자동 업데이트)
  - [ ] 6.8 마이그레이션 통합 테스트 작성 (실제 DB 사용, 롤백 테스트 포함)
  - [ ] 6.9 Core Memory 자동 로드 통합 테스트 작성

