# 0015-prd-reflexion-procedural-verification-test.md

## Introduction/Overview

이 PRD는 **Reflexion(실패에 대한 성찰) 결과가 Procedural Memory(절차적 기억)에 실제로 반영되어, 동일하거나 유사한 실패 상황에서 프로시저가 수정·보강되는지**를 검증하는 테스트를 추가하는 것을 목표로 합니다.

현재 Memento는 Reflexion → Procedural Memory 자동 변환 기능이 구현되어 있으나, **"변환이 일어나는지"**만 검증하고 있습니다. 이 테스트는 **"변경된 프로시저가 실제로 저장되고, 다음 실행에서 개선된 절차가 적용되는지"**를 검증하여, Memento가 "실패로부터 학습하는 시스템"임을 보장하는 안전장치를 제공합니다.

이 기능이 도입되면 다음과 같은 문제가 해결됩니다:

* Reflexion이 단순 로그/메타데이터로 남는 것을 방지
* Procedural Memory가 고정된 규칙 저장소로 퇴화하는 것을 방지
* "실행 → 실패 → Reflexion → 절차 수정 → 다음 실행에서 개선" 순환 구조의 실제 작동 여부 검증
* 향후 자동 학습, self-improvement, meta-memory(M2) 기능의 신뢰성 기반 마련

## Goals

1. **1단계 (Phase 1)**: 기본 검증 테스트 구현
   - 이슈에서 제안한 3가지 시나리오 검증
   - 기존 `reflexion-worker.spec.ts` 테스트 확장
   - 통합 테스트 구조 구축 (ReflexionWorker + DB + ProceduralMemory)
   - 판정 기준 구현 (version/hash/annotation 변경 감지)
   - 실행 결과 스냅샷 비교 기능
   - 경량 성능 가드 (변환 시간, DB 쿼리 횟수)
   - CI/CD 통합 (PR 자동 검증)

2. **2단계 (Phase 2)**: 고급 검증 테스트 (향후 확장)
   - 성능 테스트 (대규모 실패 이벤트 처리)
   - 동시성 테스트 (병렬 실패 이벤트 처리)
   - 롤백 시나리오 테스트 (변경 취소 및 복구)

3. **E2E 테스트**: 전체 흐름 검증 (여력이 되면 1개 추가)
   - "실패 → Reflexion → 프로시저 갱신 → 재실행" 전체 흐름 검증

## User Stories

### US1: 개발자로서
**As a** 개발자  
**I want to** Reflexion → Procedural 연결이 실제로 작동하는지 테스트로 검증하고 싶다  
**So that** 시스템이 의도대로 실패로부터 학습하는지 확인할 수 있다

### US2: 시스템 관점에서
**As a** Memento 시스템  
**I want to** 실패 이벤트 발생 시 Reflexion 결과가 Procedural Memory에 반영되어야 한다  
**So that** 동일한 실패 상황에서 개선된 절차를 자동으로 적용할 수 있다

### US3: 품질 보장 관점에서
**As a** 품질 보장 담당자  
**I want to** PR마다 자동으로 Reflexion → Procedural 연결 검증 테스트가 실행되기를 원한다  
**So that** 회귀(regression) 없이 핵심 기능이 유지되는지 보장할 수 있다

## Functional Requirements

### FR1: 시나리오 1 - 절차 수정 검증 테스트

**Given**: step A → B → C로 구성된 프로시저가 Procedural Memory에 등록되어 있음  
**When**: step B에서 실패 이벤트 발생 + Reflexion 생성  
**Then**: 
- Procedural Memory에 step B 관련 수정 기록이 존재해야 함
- 다음 실행 시 수정된 step B가 사용되어야 함
- 변경 감지 기준에 따라 변경 여부 확인

**스키마 매핑 및 판정 기준**:

**업데이트 모드별 동작** (ReflexionWorker의 `determineMergeStrategy` 결과에 따라 결정):

**ReflexionWorker의 실제 동작**:
- `convertToProceduralMemory()` 메서드가 `determineMergeStrategy()`를 호출하여 모드 결정
- `shouldMerge === true`이고 `existingMemoryId`가 있으면: `updateProceduralMemory()` 호출 (기존 메모리 업데이트)
- `shouldMerge === false`이면: `createProceduralMemory()` 호출 (새 메모리 생성)

**모드별 상세 동작**:
- **replace 모드** (유사도 >= 0.9, `shouldMerge === true`): 
  - `updateProceduralMemory()` 호출 → 기존 메모리 in-place UPDATE
  - 판정: 동일 `memory_item.id`의 필드 변경 감지
- **incremental 모드** (유사도 >= 0.7, `shouldMerge === true`): 
  - `updateProceduralMemory()` 호출 → 기존 메모리 in-place UPDATE (steps 병합)
  - 판정: 동일 `memory_item.id`의 필드 변경 감지, `steps` 배열 병합 확인
- **versioned 모드** (유사도 < 0.7, `shouldMerge === false` 또는 `updateMode === 'versioned'`): 
  - `shouldMerge === false`인 경우: `createProceduralMemory()` 호출 → 새 메모리 생성
  - `shouldMerge === true`이지만 `updateMode === 'versioned'`인 경우: `updateProceduralMemory()` 내부에서 새 메모리 생성 + `version_of` 관계 생성
  - 판정: 새 `memory_item` 생성 + `memory_link(source_id=새메모리ID, target_id=기존메모리ID, relation_type='version_of')` 생성 확인

**변경 감지 기준**:
- **version 추적**: 
  - `versioned` 모드: `memory_link` 테이블의 `version_of` 관계 생성 여부
  - `replace`/`incremental` 모드: 동일 ID의 필드 변경 감지
- **steps 변경 감지**: `memory_item.steps` 필드 (JSON 배열 문자열)의 hash 변경
  - 판정: `steps` JSON 문자열의 SHA-256 hash 비교
- **기본 메타데이터 변경**: `content`, `importance`, `privacy_scope` 등도 변경 가능
  - 판정: `content` 필드 변경 감지 포함 (워커가 본문을 수정하는 경우 대비)
- **annotation/constraints**: `memory_item` 테이블에 별도 필드 없음. `reflection_notes` JSON 내부에 포함될 수 있음
  - 판정: `reflection_notes` JSON 내부의 `suggested_improvements`, `lessons_learned` 등 필드 변경 감지 (선택적)
- **기타 변경 가능 필드**: `workflow_name`, `skill_name`, `trigger_conditions`, `task_goal` 변경 감지

**테스트 커버리지 요구사항**:
- 3가지 업데이트 모드 모두 테스트 커버 (replace, incremental, versioned)
- 각 모드별 변경 감지 로직 검증
- `shouldMerge` true/false 케이스 모두 검증

**구현 요구사항**:
- 기존 procedural memory를 DB에 생성 (`memory_item` 테이블)
- 실패 이벤트를 ReflexionWorker에 큐잉
- Reflexion 처리 완료 대기 (비동기 처리 완료 대기)
- DB에서 업데이트된 procedural memory 조회
- `hasProceduralMemoryChanged()` 유틸리티로 변경 여부 판정
- 변경 감지 시 상세 변경 내역 로깅

**실제 프로시저 소비 경로 검증 (핵심 목표 충족)**:
- **검색 경로 재실행**: 변경된 procedural memory를 실제 검색 경로로 조회
  - `HybridSearchEngine` 또는 `RecallTool`을 사용하여 `workflow_name`, `skill_name`, `trigger_conditions`로 검색
  - 검색 결과에 개선된 procedural memory가 포함되는지 확인
  - 검색 결과의 `steps` 필드에 개선된 절차가 반영되었는지 확인
- **Trigger 조건 매칭 검증**: `trigger_conditions`가 실제로 매칭되는지 확인
  - 실패 이벤트와 동일한 조건으로 검색 시 개선된 procedural memory가 우선순위로 반환되는지 확인
  - `fetchProceduralMemoryMatches()` 로직이 개선된 메모리를 올바르게 매칭하는지 확인
- **실행 결과 비교**: 변경 전후의 검색 결과를 비교하여 개선이 실제로 적용되었는지 확인
  - 변경 전: 기존 procedural memory 검색 결과
  - 변경 후: 개선된 procedural memory 검색 결과
  - 개선된 절차가 검색 결과에 포함되고 우선순위가 높아졌는지 확인

### FR2: 시나리오 2 - 실패 누적에 따른 보강 검증 테스트

**Given**: 동일한 실패가 N회 발생  
**When**: Reflexion이 누적됨  
**Then**: 
- Procedural Memory에 보강 정보가 반영되어야 함
- `trigger_conditions`에 실패 패턴이 반영되어야 함
- `reflection_notes` 배열에 누적된 실패 정보가 추가되어야 함

**스키마 매핑 및 판정 기준**:
- **failure_count/confidence/priority**: `memory_item` 테이블에 해당 필드 없음
  - 대안: `reflection_notes` JSON 배열의 길이로 실패 누적 추적
  - 판정: `reflection_notes` 배열 길이 증가 확인
- **trigger_conditions 변경**: `memory_item.trigger_conditions` 필드 (JSON 객체 문자열)
  - 판정: `trigger_conditions` JSON 내부의 `error_type`, `tool_name`, `error_message_hash` 등 필드 변경 감지
  - 예시: `{"tool_name": "remember-tool", "error_type": "ValidationError"}` → 실패 누적 시 조건 추가
- **edit_count**: `memory_item.edit_count` 필드 존재 (INTEGER, 기본값 0)
  - 판정: `edit_count` 증가 확인 (업데이트 모드에 따라 증가할 수 있음)

**구현 요구사항**:
- 동일한 실패 이벤트를 N회 생성 (예: 3회)
- 각 실패마다 Reflexion 처리
- DB에서 procedural memory의 메타데이터 변화 추적
- `reflection_notes` 배열 길이 증가 검증
- `trigger_conditions` JSON에 실패 패턴 추가 여부 검증
- `edit_count` 증가 검증 (있는 경우)

**reflection_notes 누적 처리 방침** (실제 구현 동작 기준):
- **빈 문자열 처리**: 
  - `reflection_notes`가 빈 문자열(`''`)인 경우: `parseReflectionNotes()`가 `type: 'null', value: null` 반환하고 경고 로그만 남김
  - 실제 동작: `mergeReflectionNotes()`를 호출하여 새 note를 병합하고, DB에 업데이트/생성 후 `convertToProceduralMemory()`를 호출함
  - `convertToProceduralMemory()` 내부에서 `extractProceduralMemory()`가 실패하거나 `workflow_name`/`skill_name`이 없으면 변환을 스킵함
  - 테스트 동작: 경고 로그 확인, reflection_notes는 DB에 저장되지만 Procedural Memory 변환은 스킵됨 (정상 동작)
  - 테스트 실패 조건: 빈 문자열로 인해 예외가 발생하거나 시스템이 중단되는 경우
- **잘못된 JSON 처리**:
  - `reflection_notes`가 잘못된 JSON인 경우: `parseReflectionNotes()`가 파싱 실패 시 `type: 'null', value: null` 반환하고 경고 로그만 남김
  - 실제 동작: `mergeReflectionNotes()`를 호출하여 새 note를 병합하고, DB에 업데이트/생성 후 `convertToProceduralMemory()`를 호출함
  - `convertToProceduralMemory()` 내부에서 `extractProceduralMemory()`가 실패하거나 `workflow_name`/`skill_name`이 없으면 변환을 스킵함
  - 테스트 동작: 경고 로그 확인, reflection_notes는 DB에 저장되지만 Procedural Memory 변환은 스킵됨 (정상 동작)
  - 테스트 실패 조건: 잘못된 JSON으로 인해 예외가 발생하거나 시스템이 중단되는 경우
- **빈 배열 처리**:
  - `reflection_notes`가 빈 배열(`[]`)인 경우: `parseReflectionNotes()`가 `type: 'array', value: []` 반환
  - 실제 동작: `mergeReflectionNotes()`를 호출하여 새 note를 배열에 추가하고, DB에 업데이트/생성 후 `convertToProceduralMemory()`를 호출함
  - `convertToProceduralMemory()` 내부에서 `extractProceduralMemory()`가 실패하거나 `workflow_name`/`skill_name`이 없으면 변환을 스킵함
  - 테스트 동작: reflection_notes 배열에 새 note가 추가되고 DB에 저장되지만, Procedural Memory 변환은 스킵될 수 있음
- **재현성 확보**:
  - 테스트에서 빈 문자열/잘못된 JSON 케이스를 명시적으로 포함
  - 각 케이스별 예상 동작(경고 로그, reflection_notes 저장, Procedural Memory 변환 스킵 가능성) 검증
  - 예외 발생 시 테스트 실패로 처리
  - **주의**: `validateReflectionNotes()`는 `remember-tool`에서만 사용되며, `reflexion-worker`에서는 사용되지 않음

### FR3: 시나리오 3 - Reflexion 미연결 방지 검증 테스트

**Given**: 실패 기록은 있으나 Reflexion 결과 없음  
**Then**: 
- Procedural Memory는 변경되지 않아야 함
- "Reflexion → Procedural" 연결이 명시적임을 보장해야 함

**구현 요구사항**:
- 실패 이벤트를 생성하되 Reflexion 처리를 스킵하는 시나리오
- DB에서 procedural memory 변경 여부 확인
- 변경이 없음을 검증 (version, steps, annotation 모두 동일)

### FR4: 판정 기준 구현

**요구사항**:
- "프로시저가 변경되었다"는 판정 기준:
  - `memory_link` 테이블의 `version_of` 관계 생성 여부 (versioned 모드)
  - `memory_item.steps` JSON 문자열의 hash 변경 감지 (SHA-256)
  - `memory_item.workflow_name`, `skill_name`, `trigger_conditions`, `task_goal` 필드 변경
  - `memory_item.reflection_notes` JSON 내부 필드 변경 (선택적)
- 가능하면 실행 결과 스냅샷 비교:
  - 성공/실패 패턴을 스냅샷으로 저장
  - 변경 전후 스냅샷 비교하여 거짓 양성(false positive) 최소화

**유틸리티 함수 정의**:

**위치**: `src/shared/utils/procedural-memory-change-detector.ts` (신규 생성)

**인터페이스**:
```typescript
interface ProceduralMemorySnapshot {
  id: string;
  // 기본 메타데이터 (워커가 수정할 수 있음)
  content: string; // 본문 변경 감지용
  importance: number | null;
  privacy_scope: string | null;
  // Procedural Memory 전용 필드
  workflow_name: string | null;
  skill_name: string | null;
  steps_hash: string; // SHA-256 hash of steps JSON
  trigger_conditions_hash: string | null; // SHA-256 hash of trigger_conditions JSON
  task_goal: string | null;
  reflection_notes_count: number; // reflection_notes 배열 길이
  edit_count: number;
  // 버전 추적 (versioned 모드)
  version_of_target_id: string | null; // memory_link에서 version_of 관계의 target_id
  // 타임스탬프
  created_at: string;
  last_accessed: string | null; // memory_item.last_accessed 필드 (스키마에 updated_at 없음)
}

interface ChangeDetectionResult {
  hasChanged: boolean;
  changeType: 'version_created' | 'steps_modified' | 'metadata_modified' | 'content_modified' | 'reflection_added' | 'none';
  changes: {
    content?: { before: string; after: string };
    steps?: { before: string | null; after: string | null };
    workflow_name?: { before: string | null; after: string | null };
    skill_name?: { before: string | null; after: string | null };
    trigger_conditions?: { before: string | null; after: string | null };
    reflection_notes_count?: { before: number; after: number };
    version_of?: { created: boolean; target_id: string | null };
  };
}

/**
 * Procedural Memory 스냅샷 생성
 */
function createProceduralMemorySnapshot(
  db: Database.Database,
  memoryId: string
): ProceduralMemorySnapshot | null;

/**
 * 두 스냅샷 비교하여 변경 여부 판정
 */
function hasProceduralMemoryChanged(
  before: ProceduralMemorySnapshot | null,
  after: ProceduralMemorySnapshot | null
): ChangeDetectionResult;

/**
 * JSON 문자열의 SHA-256 hash 계산 (정규화 후)
 * 
 * 정규화 실패 시 원문 문자열 해시 사용 (fallback)
 */
function computeJsonHash(jsonString: string | null): string;
```

**JSON 정규화 규칙**:
- 키 정렬: JSON 객체의 키를 알파벳 순으로 정렬
- 숫자 직렬화: 정수는 그대로, 실수는 소수점 6자리까지
- 문자열 직렬화: 이스케이프 문자 일관성 유지
- 배열 순서: 배열은 순서 유지 (정렬하지 않음)
- null 처리: null 값은 "null" 문자열로 변환

**Fallback 전략** (실전 데이터 견고성):
- JSON 파싱 실패 시: 원문 문자열을 그대로 해시 (정규화 없이)
- 배열/객체 파싱 실패: 원문 문자열 해시 사용
- 숫자 포맷 차이: 정규화 시도 후 실패하면 원문 해시 사용
- 이미 정렬/직렬화된 데이터: 정규화 후 해시 계산 (일관성 유지)

**구현 요구사항**:
- `src/shared/utils/procedural-memory-change-detector.ts` 파일 생성
- `createProceduralMemorySnapshot()` 함수 구현
  - `memory_item` 테이블의 모든 관련 필드 조회 (content, importance, privacy_scope, last_accessed 포함)
  - `memory_link` 테이블에서 `version_of` 관계 조회
  - 주의: `updated_at` 필드는 스키마에 없으므로 `last_accessed` 필드 사용
- `hasProceduralMemoryChanged()` 함수 구현
  - 3가지 업데이트 모드 모두 지원 (replace, incremental, versioned)
  - 변경 타입 구분: `version_created`, `steps_modified`, `metadata_modified`, `content_modified`, `reflection_added`, `none`
- `computeJsonHash()` 함수 구현
  - crypto 모듈의 `createHash('sha256')` 사용
  - JSON 정규화 시도 후 해시 계산
  - 파싱 실패 시 원문 문자열 해시 사용 (fallback)
- JSON 정규화 유틸리티 함수 구현
  - 파싱 실패 처리 포함
  - 숫자 포맷 차이 처리
- 단위 테스트 작성 (`procedural-memory-change-detector.spec.ts`)
  - 정규화 성공/실패 케이스 모두 테스트
  - Fallback 동작 검증

### FR5: 실행 결과 스냅샷 비교 (선택적 강화)

**요구사항**:
- 프로시저 실행 전후의 성공/실패 패턴을 스냅샷으로 저장
- 변경 감지 시 스냅샷 비교하여 실제 개선 여부 확인

**구현 요구사항**:
- 스냅샷 형식 정의 (JSON)
- 스냅샷 저장 위치 (메모리 또는 임시 파일)
- 스냅샷 비교 함수

### FR6: 통합 테스트 구조

**요구사항**:
- ReflexionWorker + DB + ProceduralMemory를 통합하여 테스트
- 실제 DB 사용 (in-memory SQLite 가능)
- Given/When/Then 패턴 준수

**구현 요구사항**:
- `src/services/reflexion-worker.spec.ts` 파일 확장
- 기존 "Procedural Memory 자동 변환" 섹션에 새 테스트 추가
- DB 초기화/정리 로직 (beforeEach/afterEach)
- 테스트 데이터 생성 헬퍼 함수

### FR7: E2E 테스트 (여력이 되면 1개 추가)

**요구사항**:
- "실패 → Reflexion → 프로시저 갱신 → 재실행" 전체 흐름 검증

**구현 요구사항**:
- E2E 테스트 파일 생성 (예: `src/test/test-reflexion-procedural-e2e.spec.ts`)
- 실제 MCP 서버와의 통신 (선택적)
- 전체 워크플로우 검증

### FR8: 경량 성능 가드

**요구사항**:
- 변환 시간 측정 (3초 이내, CI 환경 여유 버퍼 포함)
- 주요 DB 쿼리 횟수 측정 (SELECT/UPDATE/INSERT 합계 20회 이내)

**실제 워커 경로 분석**:
- `autoReflect()` 메서드:
  - 기존 reflection_notes 조회: SELECT 1회
  - 기존 메모리 업데이트 또는 새 메모리 생성: UPDATE 1회 또는 INSERT 1회
- `convertToProceduralMemory()` 메서드:
  - `determineMergeStrategy()` 호출: SELECT 1-3회 (완전 일치 검색 1회, 필요 시 LIKE 검색 1-2회)
  - `updateProceduralMemory()` 또는 `createProceduralMemory()` 호출:
    - `updateProceduralMemory()`: 기존 메모리 조회 SELECT 1회, 업데이트 UPDATE 1회
    - versioned 모드 시: 새 메모리 생성 INSERT 1회 + 관계 생성 INSERT 1회
    - `createProceduralMemory()`: 새 메모리 생성 INSERT 1회
- **예상 쿼리 횟수**:
  - 최소: SELECT 2회 + UPDATE/INSERT 1회 = 총 3회
  - 일반: SELECT 3-4회 + UPDATE 1회 = 총 4-5회
  - 최대 (versioned 모드): SELECT 5회 + UPDATE 1회 + INSERT 2회 = 총 8회
  - **안전 마진 포함**: 20회 이내 (기타 쿼리 및 예외 상황 대비)

**측정 방법**:

**1. 변환 시간 측정**:
- **도구**: `performance.now()` 사용 (Vitest fake timers 사용하지 않음, 실제 시간 측정)
- **측정 시점**: 
  - **시작**: `ReflexionWorker.queueFailureEvent()` 호출 직전 (큐에 이벤트 추가 전)
  - **종료**: `ReflexionWorker`의 이벤트 처리 완료 후 (비동기 완료 대기)
  - **주의**: 큐에 여러 이벤트가 있을 때 대기 시간이 섞이지 않도록, 테스트에서는 단일 이벤트만 큐에 넣어 측정
  - **계측 범위**: 전체 이벤트 처리 시간 (큐 추가 + 처리 + 변환 완료)
- **임계값**: 3000ms (3초, CI 환경 여유 버퍼 포함)
  - 실제 변환 시간은 보통 100-500ms이지만, 큐 처리 대기 시간 및 DB I/O를 고려하여 여유 있게 설정
- **조건부 스킵**: 
  - 저사양 러너 감지 시 테스트 스킵 (예: `process.env.CI === 'true' && process.env.RUNNER_CPU_COUNT < 2`)
  - 또는 CI 환경에서 임계값을 5초로 완화
- **구현 위치**: 테스트 코드 내에서 직접 측정

**2. DB 쿼리 횟수 측정**:
- **방법**: SQLite의 `trace()` 함수를 사용한 테스트 전용 쿼리 카운터 (프로덕션 코드와 분리)
- **구현 방식**: 
  - 테스트 헬퍼 함수 `createQueryCounter(db)` 생성
  - SQLite `db.trace()` 콜백을 사용하여 쿼리 로깅
  - SELECT, UPDATE, INSERT 쿼리만 카운트 (PRAGMA, CREATE, DROP 등 제외)
  - 테스트 종료 시 trace 콜백 제거
- **프로덕션 코드 분리**:
  - `DatabaseUtils` 수정 없음 (프로덕션 코드 변경 없음)
  - 테스트 헬퍼에서만 `db.trace()` 사용
  - 테스트 환경에서만 활성화
- **측정 대상**: SELECT, UPDATE, INSERT 쿼리만 카운트 (PRAGMA, CREATE, DROP 등 제외)
- **계측 범위**: 전체 이벤트 처리 과정의 모든 쿼리 (큐 추가 + 처리 + 변환 완료)
- **임계값**: SELECT + UPDATE + INSERT 합계 20회 이내
  - 실제 예상 쿼리 횟수는 3-8회이지만, 안전 마진 및 예외 상황 대비하여 20회로 설정
- **구현 위치**: `src/test/helpers/query-counter.ts` (신규 생성)
- **사용 예시**:
  ```typescript
  const queryCounter = createQueryCounter(db);
  // ... 테스트 실행 ...
  expect(queryCounter.getCount()).toBeLessThanOrEqual(20);
  queryCounter.dispose(); // trace 콜백 제거
  ```

**구현 요구사항**:
- `src/test/helpers/query-counter.ts` 파일 생성
- `createQueryCounter(db)` 함수 구현
- 테스트에서 쿼리 카운터 사용 예시:
  ```typescript
  const queryCounter = createQueryCounter(db);
  // ... 테스트 실행 ...
  expect(queryCounter.getCount()).toBeLessThanOrEqual(20);
  ```
- 성능 측정 로깅 (테스트 실패 시 상세 로그 출력)

### FR9: CI/CD 통합

**요구사항**:
- PR마다 자동으로 테스트 실행
- 테스트 실패 시 PR 머지 차단

**구현 요구사항**:

**1. package.json 확인**:
- `npm test` 스크립트는 `vitest --run`으로 설정되어 있음
- 새 테스트 파일(`src/services/reflexion-worker.spec.ts`)은 자동으로 포함됨
- 별도 스크립트 추가 불필요

**2. CI 설정 파일 확장/수정**:
- **기존 CI 워크플로우 파일**: `.github/workflows/ci.yml` (이미 존재)
- **파일 경로**: `.github/workflows/ci.yml` 수정
- **현재 상태 확인**: 
  - 기존 워크플로우에 `npm run test:ci` 단계가 이미 포함되어 있음 (55-62번 라인)
  - 새 테스트는 자동으로 포함됨 (별도 수정 불필요)
- **확인 사항**: 
  - `npm run test:ci` 명령이 `vitest --run`을 실행하는지 확인 (package.json 확인 완료)
  - 새 테스트 파일(`src/services/reflexion-worker.spec.ts`)이 자동으로 포함되는지 확인
- **수정 필요 여부**: 
  - 기본적으로 수정 불필요 (기존 `npm run test:ci` 단계가 모든 테스트를 실행)
  - 특정 테스트만 실행하려면 별도 job 추가 고려 (선택적)

**3. 테스트 실행 명령**:
- 기본: `npm test` (모든 테스트 실행)
- 특정 테스트만 실행: `npm test -- src/services/reflexion-worker.spec.ts`
- CI 모드: `npm run test:ci` (기존 스크립트 사용)

**4. 테스트 실행 시간 모니터링**:
- Vitest의 기본 리포트에 실행 시간 포함
- CI 로그에서 각 테스트 케이스 실행 시간 확인
- 타임아웃 설정: Vitest 기본 타임아웃 사용 (5초)

### FR10: 테스트 데이터 및 시나리오

**요구사항**:
- 이슈 예시 시나리오를 기본으로 사용
- 실제 사용 사례 1~2개 포함
- Edge case 소량 포함:
  - 부분적 변경 (일부 필드만 변경)
  - 동일 hash지만 메타데이터 변경
  - 롤백 시나리오 (향후 확장)

**구현 요구사항**:
- 테스트 데이터 픽스처 생성
- 실제 사용 사례 시나리오 정의
- Edge case 테스트 케이스 작성

## Non-Goals (Out of Scope)

### Phase 1에서 제외할 항목

1. **대규모 부하 테스트**: 100개 이상의 동시 실패 이벤트 처리 테스트는 Phase 2로 연기
2. **동시성 테스트**: 병렬 실패 이벤트 처리 검증은 Phase 2로 연기
3. **롤백 시나리오**: 변경 취소 및 복구 테스트는 Phase 2로 연기
4. **성능 벤치마크**: 상세한 성능 분석 및 최적화는 Phase 2로 연기
5. **다중 E2E 테스트**: Phase 1에서는 E2E 테스트 1개만 구현 (여력이 되면)

### 명시적으로 포함하지 않을 항목

1. **UI 테스트**: 이 기능은 백엔드 검증에 집중
2. **외부 API 통합 테스트**: MCP 서버 외부 의존성 테스트 제외
3. **보안 테스트**: 별도 보안 테스트 범위에 속함

## Design Considerations

### 테스트 구조

```
src/services/reflexion-worker.spec.ts
├── 기존 테스트 (변환 여부 검증)
└── 새 테스트 섹션: "Reflexion → Procedural 연결 검증"
    ├── 시나리오 1: 절차 수정 검증
    ├── 시나리오 2: 실패 누적 보강
    ├── 시나리오 3: Reflexion 미연결 방지
    └── 성능 가드
```

### 테스트 패턴

- **Given/When/Then** 패턴 준수 (사용자 규칙)
- **AAA 패턴** (Arrange-Act-Assert) 사용
- **메서드명 또는 JSDoc**에 Given/When/Then 표시

### 테스트 데이터 관리

- 테스트 픽스처를 `beforeEach`에서 생성
- `afterEach`에서 DB 정리 (`cleanupTestDatabase(db)` 호출)
- 재사용 가능한 헬퍼 함수 생성

**테스트 격리 상세 전략**:

**beforeEach**:
```typescript
beforeEach(async () => {
  // 1. 새 in-memory DB 생성
  db = await setupTestDatabase();
  
  // 2. 테스트 의존성 초기화
  detector = new FailureDetector();
  eventQueue = new AsyncTaskQueue(5, 100);
  worker = new ReflexionWorker(detector, db, eventQueue);
  
  // 3. 테스트 데이터 생성 (필요한 경우)
  // ...
});
```

**afterEach**:
```typescript
afterEach(async () => {
  // 1. Worker 중지
  await worker.stop();
  await detector.stopQueue();
  
  // 2. DB 연결 종료 (메모리 해제)
  cleanupTestDatabase(db);
  
  // 3. Mock 정리
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
```

**병렬 실행 안전성**:
- 각 테스트는 독립적인 DB 인스턴스 사용
- 전역 변수나 싱글톤 사용 금지
- 테스트 간 데이터 공유 없음

## Technical Considerations

### 테스트 프레임워크

- **Vitest** 사용 (프로젝트 표준)
- 기존 `src/services/reflexion-worker.spec.ts` 파일 확장

### 데이터베이스

- **SQLite in-memory** 사용 (테스트 격리)
- **초기화 방법**: `src/test/helpers/test-database.ts`의 `setupTestDatabase()` 함수 사용
  - 함수 시그니처: `setupTestDatabase(): Promise<Database.Database>`
  - 내부 구현: `new Database(':memory:')` 사용
  - 스키마 초기화: `DatabaseUtils.initializeDatabase(db)` 호출
  - FTS5 트리거 및 벡터 테이블 초기화 포함
- **정리 방법**: `cleanupTestDatabase(db)` 함수 사용
  - 함수 시그니처: `cleanupTestDatabase(db: Database.Database): void`
  - 내부 구현: `db.close()` 호출
- **테스트 격리 전략**:
  - `beforeEach`: `setupTestDatabase()` 호출하여 새 DB 인스턴스 생성
  - `afterEach`: `cleanupTestDatabase(db)` 호출하여 DB 연결 종료
  - 각 테스트는 독립적인 in-memory DB 사용 (데이터 오염 방지)
  - `data/` 디렉토리 사용하지 않음 (파일 시스템 오염 방지)
- **DatabaseUtils 초기화 파라미터**: 
  - 파일 경로 대신 `:memory:` 사용 (항상 메모리 DB)
  - `DatabaseUtils.initializeDatabase(db)`는 이미 초기화된 DB 인스턴스를 받음

### 의존성

- `src/infrastructure/reflexion-worker.ts`: ReflexionWorker 클래스
- `src/shared/utils/procedural-memory-extractor.ts`: 추출 유틸리티
- `src/shared/utils/database.ts`: DatabaseUtils
- `crypto` 모듈: hash 계산 (판정 기준)

### 기존 코드와의 통합

- 기존 테스트 섹션 "Procedural Memory 자동 변환" 확장
- 기존 테스트 케이스와의 충돌 방지
- 테스트 실행 시간 최소화 (병렬 실행 가능하도록)

### 성능 고려사항

- 테스트 실행 시간: 각 테스트 케이스 5초 이내
- DB 쿼리 최적화: 필요한 필드만 조회
- 메모리 사용: in-memory DB 사용으로 메모리 제한

## Success Metrics

### Phase 1 완료 기준

1. **테스트 커버리지**: 
   - 시나리오 1, 2, 3 모두 통과
   - 판정 기준 함수 100% 커버리지
   - 통합 테스트 실행 성공률 100%

2. **검증 통과율**:
   - 모든 테스트 케이스 통과
   - CI/CD에서 자동 실행 성공

3. **성능 가드**:
   - 변환 시간 3초 이내 (CI 환경 여유 버퍼 포함, 조건부 스킵 또는 완화 가능)
   - DB 쿼리 횟수 합리적 범위 내 (SELECT/UPDATE/INSERT 합계 20회 이내)
   - 저사양 러너 감지 시 조건부 스킵 또는 임계값 완화
   - **참고**: 실제 워커 경로 분석 결과, 일반적인 쿼리 횟수는 4-5회, 변환 시간은 100-500ms이지만 큐 처리 대기 시간 및 DB I/O를 고려하여 여유 있게 설정 (FR8 참조)

4. **코드 품질**:
   - Given/When/Then 패턴 준수
   - 테스트 코드 가독성
   - 주석 및 문서화

### 측정 방법

- Vitest 커버리지 리포트 확인
- CI/CD 로그에서 테스트 실행 결과 확인
- 성능 측정 로그 분석

## Open Questions

1. **스냅샷 비교 구현 범위**: 실행 결과 스냅샷 비교를 Phase 1에 포함할지, Phase 2로 연기할지 결정 필요
   - **권장**: Phase 1에서는 기본 판정 기준(version_of, steps hash, 메타데이터 변경)만 구현하고, 스냅샷 비교는 Phase 2로 연기
2. **E2E 테스트 범위**: E2E 테스트에서 실제 MCP 서버 통신이 필요한지, 아니면 모의(mock) 서버로 충분한지
   - **권장**: Phase 1에서는 통합 테스트로 충분, E2E는 Phase 2 또는 별도 이슈로 처리
3. **실제 사용 사례**: 어떤 실제 사용 사례를 테스트 데이터로 사용할지 구체화 필요
   - **제안**: "데이터 마이그레이션" 워크플로우, "API 배포" 워크플로우 등 실제 사용 중인 시나리오
4. **Edge case 우선순위**: 여러 edge case 중 Phase 1에서 우선 구현할 항목 결정
   - **권장**: 
     - 우선: 부분적 변경 (일부 필드만 변경)
     - 다음: 동일 hash지만 메타데이터 변경
     - 나중: 롤백 시나리오 (Phase 2)
5. **성능 임계값**: 변환 시간 및 DB 쿼리 횟수의 구체적 임계값 설정 필요
   - **설정 완료**: 변환 시간 3초 (CI 환경 여유 버퍼 포함), DB 쿼리 SELECT/UPDATE/INSERT 합계 20회 (FR8에 명시)
   - **근거**: 실제 워커 경로 분석 결과, 일반적인 쿼리 횟수는 4-5회, 변환 시간은 100-500ms이지만 큐 처리 대기 시간 및 DB I/O를 고려하여 여유 있게 설정

## 참고 자료

- [GitHub Issue #67](https://github.com/jee1/memento/issues/67)
- `src/infrastructure/reflexion-worker.ts`: ReflexionWorker 구현
- `src/services/reflexion-worker.spec.ts`: 기존 테스트
- `src/shared/utils/procedural-memory-extractor.ts`: 추출 유틸리티
- `tasks/0011-prd-procedural-memory-enhancement.md`: Procedural Memory 강화 PRD

