# 0011-prd-procedural-memory-enhancement.md

## Introduction/Overview

이 PRD는 Memento MCP 서버의 **Procedural Memory(절차적 기억)** 기능을 강화하여, 반복적인 작업 방식·스킬·워크플로우를 구조화해 저장하고, Reflexion 결과를 기반으로 절차적 지식을 자동 업데이트할 수 있도록 하는 것을 목표로 합니다.

현재 Memento는 사실·사건 중심의 기억(Core/Episodic/Semantic)은 잘 다루고 있으나, **"특정 상황에서 무엇을 어떻게 처리하는가"**에 대한 절차적 지식이 충분히 구조화되어 저장되지 않습니다. 기존 `memory_item` 테이블에는 `task_goal`, `steps`, `reflection_notes` 필드가 있으나, **workflow(프로세스)**와 **skill(능력)**을 구분하고, **trigger_conditions(트리거 조건)**를 명시적으로 저장하는 기능이 부족합니다.

이 기능이 도입되면 다음과 같은 문제가 해결됩니다:

* 자동화된 자기개선(Self-Refinement) 루프 강화
* 반복되는 문제 해결 패턴을 구조적으로 재사용
* Reflexion 결과가 단순 텍스트가 아니라, 실제 액션 가능한 '방법론'으로 축적됨
* 특정 상황(trigger_conditions)에서 자동으로 관련 절차를 조회하여 활용 가능

## Goals

1. **스키마 확장**: `memory_item` 테이블에 `workflow_name`, `skill_name`, `trigger_conditions` 필드 추가
2. **MCP Tool 인터페이스 확장**: 
   - 기존 `remember` Tool 확장 (새 필드 지원, `type='procedural'` 패턴 권장)
   - `recall` Tool 확장 (Procedural Memory 특화 검색 옵션)
   - 참고: `remember_procedure` Tool은 Phase 2에서 필요성 판단 후 추가 검토
3. **Reflexion 자동 연동**: Reflexion 결과를 AI 기반으로 분석하여 Procedural Memory로 자동 변환 (수동 오버라이드 가능)
4. **검색 기능 강화**: 하이브리드 랭킹(relevance + recency + consolidation_score) 우선 기반 Procedural Memory 검색
5. **업데이트 방식 유연화**: 교체/증분/버전 관리 중 사용자 선택 가능
6. **기존 시스템 호환성**: 기존 필드(`task_goal`, `steps`, `reflection_notes`)와 새 필드 병행 사용

## User Stories

### AI 에이전트 관점

- **US-001**: AI 에이전트로서 특정 프로세스(workflow)나 기술(skill)에 대한 절차를 구조화하여 저장하고 싶다
- **US-002**: AI 에이전트로서 특정 조건(trigger_conditions)이 만족될 때 관련 절차를 자동으로 조회하고 싶다
- **US-003**: AI 에이전트로서 Reflexion 결과를 자동으로 분석하여 Procedural Memory로 변환하고 싶다 (수동 오버라이드 가능)
- **US-004**: AI 에이전트로서 기존 절차를 업데이트할 때 교체/증분/버전 관리 중 선택하고 싶다
- **US-005**: AI 에이전트로서 Procedural Memory를 검색할 때 전체 정보 또는 steps만 선택적으로 조회하고 싶다
- **US-006**: AI 에이전트로서 "데이터 마이그레이션 시 어떤 순서로 작업해야 하지?"와 같은 질문에 관련 절차를 빠르게 찾고 싶다

### 시스템 관점

- **US-007**: 시스템 관리자로서 Procedural Memory가 안정적으로 저장되고 검색 가능한지 확인하고 싶다
- **US-008**: 시스템 관리자로서 Reflexion 자동 연동의 정확도를 모니터링하고 임계값을 조정하고 싶다
- **US-009**: 시스템 관리자로서 기존 Procedural Memory 데이터와의 호환성을 보장하고 싶다

## Functional Requirements

### 1. 데이터 스키마 확장

#### 1.1. `memory_item` 테이블 필드 추가

1.1.1. **`workflow_name` 필드 추가**:
   - 필드 타입: TEXT
   - NULL 허용: 예 (기존 데이터 호환성)
   - 설명: 프로세스 이름 (예: "데이터 마이그레이션", "API 배포", "테스트 실행")
   - 인덱스: `idx_memory_item_workflow_name` 생성 (검색 성능 향상)

1.1.2. **`skill_name` 필드 추가**:
   - 필드 타입: TEXT
   - NULL 허용: 예 (기존 데이터 호환성)
   - 설명: 기술/능력 이름 (예: "스키마 백업", "데이터 검증", "에러 핸들링")
   - 인덱스: `idx_memory_item_skill_name` 생성 (검색 성능 향상)
   - 참고: `workflow_name`과 `skill_name`은 독립적 개념 (workflow는 프로세스, skill은 능력)

1.1.3. **`trigger_conditions` 필드 추가**:
   - 필드 타입: TEXT (JSON 객체 문자열)
   - NULL 허용: 예
   - 설명: 이 절차가 트리거되는 조건 (JSON 객체 형식)
   - JSON 스키마 예시:
     ```json
     {
       "tool_name": "remember",
       "error_type": "ValidationError",
       "context": {
         "task_type": "database_migration",
         "environment": "production"
       }
     }
     ```
   - 인덱스: FTS5 가상 테이블 또는 JSON 인덱스 고려 (검색 성능)

1.1.4. **기존 필드와의 관계**:
   - 기존 필드(`task_goal`, `steps`, `reflection_notes`)는 그대로 유지
   - 새 필드(`workflow_name`, `skill_name`, `trigger_conditions`)와 병행 사용
   - `type='procedural'`일 때만 새 필드 사용 권장 (다른 타입에서도 NULL 허용)

#### 1.2. 마이그레이션 전략

1.2.1. **기존 데이터 호환성**:
   - 기존 `type='procedural'` 데이터는 새 필드 없이도 정상 동작
   - 새 필드는 NULL 허용으로 설계하여 하위 호환성 보장

1.2.2. **마이그레이션 스크립트**:
   - `workflow_name`, `skill_name`, `trigger_conditions` 필드 추가 (ALTER TABLE)
   - 인덱스 생성
   - 기존 데이터는 NULL로 유지 (선택적 마이그레이션 로직 제공)

1.2.3. **마이그레이션 파일**:
   - 파일명: `007-procedural-memory-enhancement.sql`
   - 위치: `src/infrastructure/database/sqlite/migration/migrations/`
   - 참고: 006번은 이미 `006-fts5-reflection-notes.*` 파일들이 사용 중이므로 007번으로 할당

### 2. MCP Tool 인터페이스 확장

#### 2.1. 기존 `remember` Tool 확장

2.1.1. **새 파라미터 추가**:
   - `workflow_name` (string, optional): 프로세스 이름
   - `skill_name` (string, optional): 기술/능력 이름
   - `trigger_conditions` (string, optional): 트리거 조건 (JSON 객체 문자열)

2.1.2. **조건부 필수 검증**:
   - `type='procedural'`일 때 새 필드 사용 가능 (모두 선택적)
   - 기존 `task_goal`, `steps`, `reflection_notes`와 함께 사용 가능

2.1.3. **파라미터 검증 로직**:
   - `trigger_conditions`는 유효한 JSON 객체 문자열인지 검증
   - `workflow_name`과 `skill_name`은 빈 문자열 허용하지 않음 (NULL 또는 유효한 문자열)

2.1.4. **저장 로직**:
   - `type='procedural'`이고 새 필드가 제공되면 저장
   - 기존 필드(`task_goal`, `steps`, `reflection_notes`)와 병행 저장

#### 2.2. `recall` Tool 확장

2.2.1. **새 검색 옵션 추가**:
   - `workflow_name` (string, optional): workflow_name으로 필터링
   - `skill_name` (string, optional): skill_name으로 필터링
   - `match_trigger_conditions` (boolean, optional, default: false): trigger_conditions 매칭 여부
   - `return_format` (string, optional, enum: ['full', 'steps_only'], default: 'full'): 반환 형식 선택

2.2.2. **검색 로직**:
   - `workflow_name` 또는 `skill_name` 필터가 제공되면 해당 필드로 필터링
   - `match_trigger_conditions=true`일 때 현재 컨텍스트와 trigger_conditions 매칭 시도
   - `return_format='steps_only'`일 때 steps만 반환 (간결한 응답)

2.2.3. **하이브리드 랭킹 적용**:
   - 기존 하이브리드 랭킹(relevance + recency + consolidation_score) 유지
   - `workflow_name`/`skill_name` 매칭 시 추가 가중치 부여
   - `trigger_conditions` 매칭 시 추가 가중치 부여

### 3. Reflexion 자동 연동

#### 3.1. 자동 감지 로직

3.1.1. **Reflexion 결과 분석**:
   - Reflexion Worker가 `reflection_notes`를 생성할 때 자동으로 Procedural Memory 변환 시도
   - AI 기반 요약/추출을 통해 `workflow_name`, `skill_name`, `steps` 추출
   - `trigger_conditions`는 실패 이벤트 정보를 기반으로 자동 생성

3.1.2. **AI 요약/추출 프로세스**:
   - `reflection_notes`의 다음 섹션들을 종합적으로 분석 (0010 PRD 및 실제 스키마 기준):
     - `original_task` (optional): 작업 목표 추출 → `task_goal` 또는 `workflow_name` 매핑
     - `lessons_learned` (optional): 학습한 교훈 분석 → `steps` 개선 사항 추출
     - `suggested_improvements` (optional): 개선 방안 분석 → `steps` 구조화 및 `skill_name` 추출
   - **현재 스키마에 없는 필드**: `improved_approach` 필드는 현재 reflection_notes 스키마에 존재하지 않음
     - 확인 근거: 0010 PRD (1.3 섹션) 및 실제 구현 스키마 (`src/shared/utils/reflection-notes-schema.ts`) 모두 `improved_approach` 필드 미포함
     - 현재 스키마 필드 (실제 구현 기준, `src/shared/utils/reflection-notes-schema.ts`):
       - 필수: `failure_type` (enum: 'tool_error' | 'user_feedback' | 'metric_failure'), `failure_description` (1-5000자), `timestamp` (ISO 8601)
       - 선택: `original_task` (최대 2000자), `lessons_learned` (최대 5000자), `suggested_improvements` (최대 5000자), `phase` (enum: 'manual' | 'auto', 기본값: 'manual')
     - 향후 확장: `improved_approach` 필드가 추가되면 추출 대상에 포함하도록 유연하게 설계
   - 자연어 처리 또는 LLM을 통한 구조화된 정보 추출
   - 추출 실패 시 기본값 사용 (workflow_name: "Unknown", skill_name: "Unknown")

3.1.3. **유사도 기반 병합**:
   - 기존 Procedural Memory와 유사도 계산 (임베딩 기반 또는 키워드 매칭)
   - 사용자 설정 임계값(기본값: 0.7) 이상이면 기존 항목 업데이트
   - 임계값 미만이면 신규 항목 생성
   - 임계값은 설정 가능 (환경 변수 또는 설정 파일)

3.1.4. **수동 오버라이드**:
   - 자동 변환 전에 사용자에게 제안 표시 (선택적)
   - 사용자가 수동으로 `remember` Tool 호출하여 오버라이드 가능
   - 자동 변환 결과를 로그에 기록하여 추적 가능

#### 3.2. 업데이트 방식 선택

3.2.1. **교체 모드 (replace)**:
   - 기존 `steps`를 새로운 `steps`로 완전 교체
   - `reflection_notes`는 배열로 변환하여 추가 (버전 관리)

3.2.2. **증분 모드 (incremental)**:
   - 기존 `steps`에 새로운 단계 추가 또는 수정
   - `reflection_notes`는 배열로 변환하여 추가

3.2.3. **버전 관리 모드 (versioned)**:
   - 기존 Procedural Memory는 유지
   - 새 버전의 Procedural Memory 생성 (버전 번호 또는 타임스탬프 포함)
   - 버전 간 관계를 `memory_link` 테이블에 저장

3.2.4. **기본 동작**:
   - 자동 연동 시 기본값: 증분 모드
     - reflexion-worker에서 자동으로 procedural memory를 생성할 때 기본적으로 `incremental` 모드 사용
     - 유사도 기반으로 자동 결정되며, 임계값 이상이면 기존 메모리 업데이트
   - 수동 저장 시 사용자가 선택 가능 (파라미터: `update_mode`)
     - `update_mode`가 지정된 경우: 해당 모드에 따라 기존 메모리 업데이트 또는 새 버전 생성
     - `update_mode`가 없는 경우: 기존 메모리를 찾지 않고 항상 새로 저장 (덮어쓰지 않음)
       - 동일한 `workflow_name`/`skill_name`이 있어도 별도의 메모리로 저장
       - 명시적으로 `update_mode`를 지정하지 않으면 기존 메모리를 보존하는 정책

### 4. 검색 기능 강화

#### 4.1. 하이브리드 랭킹

4.1.1. **랭킹 공식**:
   - 기존 하이브리드 랭킹 공식 유지:
     ```
     S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
     ```
   - Procedural Memory 특화 가중치:
     - `workflow_name` 매칭: +0.1
     - `skill_name` 매칭: +0.1
     - `trigger_conditions` 매칭: +0.15

4.1.2. **검색 우선순위**:
   - **하이브리드 랭킹 우선**: relevance + recency + consolidation_score 기반 랭킹이 주요 정렬 기준
   - Anchor 기반 국소 검색은 보조적 역할 (Anchor가 설정된 경우 해당 영역의 메모리에 추가 가중치 부여)
   - `workflow_name`/`skill_name` 키워드 매칭 시 추가 부스트 (+0.1 각각)
   - `trigger_conditions` 매칭 시 추가 부스트 (+0.15)
   - 최종 정렬: 하이브리드 랭킹 점수 내림차순

#### 4.2. 반환 형식 선택

4.2.1. **전체 형식 (full)**:
   - 모든 필드 반환: `id`, `workflow_name`, `skill_name`, `task_goal`, `steps`, `trigger_conditions`, `reflection_notes`, `tags`, `importance`, `created_at`, `updated_at` 등

4.2.2. **Steps만 (steps_only)**:
   - `steps` 필드만 반환 (간결한 응답)
   - 필요 시 전체 정보는 별도 조회

4.2.3. **사용자 선택**:
   - `recall` Tool의 `return_format` 파라미터로 선택
   - 기본값: `full`

### 5. 기존 Reflexion 기능 통합

#### 5.1. 기존 Reflexion 기능 확장

5.1.1. **기존 Reflexion 기능 유지**:
   - 기존 `reflection_notes` 필드와 스키마 유지
   - 기존 Reflexion Worker 동작 유지

5.1.2. **Procedural Memory 통합**:
   - Reflexion 결과를 Procedural Memory로 자동 변환하는 로직 추가
   - 기존 Reflexion 기능을 확장하여 Procedural Memory로 통합
   - 단계적 마이그레이션: 기존 기능 유지 + 새 기능 추가

5.1.3. **데이터 일관성**:
   - `reflection_notes`는 그대로 유지
   - Procedural Memory는 `reflection_notes`를 참조하여 생성
   - `source_reflection_id` 필드로 원본 Reflexion 추적 (선택적)

## Non-Goals (Out of Scope)

1. **별도 `procedural_memory` 테이블 생성**: 기존 `memory_item` 테이블 확장으로 구현
2. **완전 자동화**: 수동 오버라이드 기능 제공 (완전 자동화는 Phase 2에서 고려)
3. **복잡한 버전 관리 시스템**: 기본적인 버전 관리만 제공 (고급 버전 관리는 Phase 2)
4. **UI/대시보드**: MCP Tool 인터페이스만 제공 (UI는 별도 프로젝트)
5. **다중 에이전트 지원**: 단일 에이전트 환경 가정 (다중 에이전트는 M2/M3에서 고려)
6. **Phase 1에서 `remember_procedure` Tool 구현**: 
   - 트레이드오프 고려: 툴 추가 시 컨텍스트 비용 증가 vs 사용성 향상
   - Phase 1에서는 `remember` Tool 확장으로 충분하며, `type='procedural'` 패턴을 문서/예제에서 권장
   - Phase 2에서 호출 패턴 분석 후 필요성 판단하여 추가 검토

## Design Considerations

### 스키마 설계

- **기존 필드와의 호환성**: 기존 `task_goal`, `steps`, `reflection_notes` 필드와 병행 사용
- **NULL 허용**: 새 필드는 NULL 허용하여 하위 호환성 보장
- **인덱스 최적화**: `workflow_name`, `skill_name`에 인덱스 생성하여 검색 성능 향상

### API 설계

- **점진적 확장**: 기존 `remember` Tool 확장으로 시작, 필요 시 신규 Tool 추가
- **선택적 파라미터**: 모든 새 필드는 선택적(optional)으로 설계
- **유연한 반환 형식**: 사용자가 전체 또는 steps만 선택 가능

### Reflexion 연동 설계

- **자동 + 수동 하이브리드**: 자동 감지 + 수동 오버라이드 가능
- **AI 기반 추출**: LLM 또는 자연어 처리로 구조화된 정보 추출
- **유사도 기반 병합**: 임베딩 기반 유사도 계산으로 중복 방지

## Technical Considerations

### 데이터베이스

- **마이그레이션**: SQLite ALTER TABLE로 필드 추가 (기존 데이터 호환성 보장)
- **인덱스**: `workflow_name`, `skill_name`에 인덱스 생성
- **JSON 필드**: `trigger_conditions`는 TEXT로 저장하되 JSON 검증 수행

### AI/LLM 통합

- **요약/추출**: Reflexion 결과에서 `workflow_name`, `skill_name`, `steps` 추출
- **유사도 계산**: 임베딩 기반 유사도 계산 (기존 임베딩 서비스 활용)
- **선택적 의존성**: LLM이 없어도 기본 동작 가능 (기본값 사용)

### 성능

- **검색 최적화**: 인덱스 활용 및 하이브리드 랭킹 최적화
- **비동기 처리**: Reflexion 자동 연동은 비동기로 처리하여 메인 프로세스에 영향 최소화
- **캐싱**: 자주 조회되는 Procedural Memory는 캐싱 고려 (선택적)

### 호환성

- **기존 데이터**: 기존 `type='procedural'` 데이터는 새 필드 없이도 정상 동작
- **기존 API**: 기존 `remember`/`recall` Tool 호출은 그대로 동작 (하위 호환성)
- **단계적 마이그레이션**: 기존 기능 유지 + 새 기능 추가

## Success Metrics

1. **기능 완성도**:
   - 스키마 확장 완료 (마이그레이션 성공률 100%)
   - MCP Tool 인터페이스 확장 완료
   - Reflexion 자동 연동 동작 확인

2. **사용성**:
   - Procedural Memory 저장 성공률 95% 이상
   - 검색 응답 시간 500ms 이하 (일반 쿼리)
   - Reflexion 자동 변환 정확도 70% 이상 (사용자 검증 기준)

3. **안정성**:
   - 기존 기능 회귀 테스트 통과율 100%
   - 마이그레이션 시 데이터 손실 0%
   - 에러 발생률 1% 미만

4. **성능**:
   - 검색 쿼리 성능 기존 대비 20% 이상 향상 (인덱스 활용)
   - Reflexion 자동 연동 오버헤드 100ms 이하

## Open Questions

1. **AI 요약/추출 구현 방식**: 
   - LLM API 사용 (OpenAI, Gemini 등) vs 로컬 모델 vs 규칙 기반 추출
   - 초기 구현은 규칙 기반으로 시작, Phase 2에서 LLM 통합 고려

2. **버전 관리 상세 설계**:
   - 버전 번호 체계 (semantic versioning vs 단순 증가)
   - 버전 간 diff 표시 방법

3. **trigger_conditions 매칭 알고리즘**:
   - JSON 객체 매칭 규칙 (완전 일치 vs 부분 일치)
   - 컨텍스트 기반 동적 매칭 방법

4. **성능 최적화 전략**:
   - 캐싱 전략 (어떤 데이터를 캐싱할지)
   - 인덱스 추가 최적화 (FTS5 가상 테이블 고려)

5. **테스트 전략**:
   - E2E 테스트 시나리오
   - Reflexion 자동 연동 테스트 방법

6. **호출 패턴 추적 계측**:
   - 현재 상태: MCP 툴 호출 횟수나 패턴을 집계하는 전용 텔레메트리/카운터가 정의되어 있지 않음
   - 필요성: `remember_procedure` Tool 추가 여부를 판단하기 위해 `type='procedural'` 호출 패턴 분석 필요
   - 구현 옵션:
     - 로그 소스 확인: 서버 로거에 툴 호출 로그가 찍히는지 확인 (현재 `mcpLogger.logMCPProtocol`로 로깅됨)
     - DB 기반 근사: `memory_item`에 `type='procedural'` 신규 행/업데이트 수를 보는 식으로 간접 추정 (호출 실패/취소는 반영되지 않음)
     - 계측 추가: 툴 핸들러에서 호출 카운터/latency를 메트릭으로 기록하거나, 구조화 로그(툴명·성공/실패·duration)를 남기는 방식
   - Phase 1에서 선택적으로 구현 (필요시)

## Implementation Phases

### Phase 1 (현재 PRD 범위)

1. 스키마 확장 (마이그레이션)
2. `remember` Tool 확장 (새 필드 지원, `type='procedural'` 패턴 권장)
3. `recall` Tool 확장
4. 기본 Reflexion 자동 연동 (규칙 기반)
5. 검색 기능 강화 (하이브리드 랭킹 우선)
6. 호출 패턴 추적 계측 (선택적, 필요시)

### Phase 2 (향후)

1. LLM 기반 AI 요약/추출
2. 고급 버전 관리 시스템
3. `remember_procedure` Tool 추가 검토 및 구현 (필요성 판단 후)
   - 추가 조건: 절차 전용 호출이 빈번하고, 파라미터 세트가 remember 일반 호출과 확연히 다를 때
   - 또는: 권한/로깅/검증을 절차용으로 분리해야 할 때
   - 또는: 클라이언트/UX에서 "절차 저장"을 명시적으로 노출해야 할 때
4. 성능 최적화 (캐싱, 인덱스 추가)
5. 다중 에이전트 지원

## Related Documents

- [0010-prd-reflexion-feature.md](./0010-prd-reflexion-feature.md): Reflexion 기능 PRD
- [0003-prd-mirix-cognitive-schema-expansion.md](./0003-prd-mirix-cognitive-schema-expansion.md): MIRIX 스키마 확장 PRD
- [GitHub Issue #39](https://github.com/jee1/memento/issues/39): 원본 이슈

