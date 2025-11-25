# 0010-prd-reflexion-feature.md

## Introduction/Overview

이 PRD는 Memento MCP 서버에 **Reflexion (교정형 성찰)** 기능을 구현하는 것을 목표로 합니다. Reflexion은 AI 에이전트가 작업 실패 경험을 성찰하고 학습하여 향후 유사한 작업에서 개선된 방법을 사용할 수 있도록 하는 핵심 기능입니다.

기존 Memento는 단순한 기억 저장소였지만, Reflexion 기능을 통해 **자기 성찰, 학습, 자동 교정이 가능한 능동적 인지 메모리 시스템**으로 진화합니다. 에이전트가 실패를 단순히 기록하는 것을 넘어, 실패 원인을 분석하고 개선 방안을 도출하여 장기적으로 성능을 향상시킬 수 있습니다.

이 기능은 **Phase 1 (수동 Reflexion 기록)**과 **Phase 2 (자동 Reflexion 실행)** 두 단계로 구현됩니다.

## Goals

1. **Phase 1: 수동 Reflexion 기록 인프라 구축**
   - Procedural Memory에 `reflection_notes` 필드를 통한 Reflexion 데이터 저장
   - 기존 `remember` Tool의 `reflection_notes` 파라미터를 통한 수동 기록 지원
   - Reflexion 데이터의 검색 및 조회 기능 제공

2. **Phase 2: 자동 Reflexion 실행 시스템 구축**
   - MCP Tool 호출 실패, 사용자 피드백, 성능 지표 미달 등 다양한 실패 유형 자동 감지
   - 백그라운드 Reflexion Worker를 통한 자동 Reflexion 기록
   - 동일 작업 재시도 시 성공률 개선 및 에러 발생률 감소

3. **데이터 구조 및 스키마**
   - 기존 0003 PRD의 Reflexion JSON 스키마 그대로 사용
   - Procedural Memory 전용 필드로 구현

4. **안정성 및 정확도**
   - 수동 기록 기능의 안정성 보장
   - 자동 감지의 정확도 향상
   - Reflexion 데이터의 검색/조회 용이성 확보

## User Stories

### AI 에이전트 관점

- **US-001**: AI 에이전트로서 작업 실패 시 수동으로 Reflexion을 기록하여 다음 시도에서 개선된 방법을 사용하고 싶다 (Phase 1)
- **US-002**: AI 에이전트로서 작업 실패 시 자동으로 Reflexion이 기록되어 다음 시도에서 개선된 방법을 사용하고 싶다 (Phase 2)
- **US-003**: AI 에이전트로서 과거 실패 경험과 개선 방안을 검색하여 유사한 작업을 수행할 때 참고하고 싶다
- **US-004**: AI 에이전트로서 동일한 작업을 반복 수행할 때 이전 실패 경험을 바탕으로 성공률을 높이고 싶다

### 시스템 관점

- **US-005**: 시스템 관리자로서 Reflexion 데이터가 안정적으로 저장되고 검색 가능한지 확인하고 싶다
- **US-006**: 시스템 관리자로서 자동 Reflexion 감지의 정확도를 모니터링하고 개선하고 싶다

## Functional Requirements

### Phase 1: 수동 Reflexion 기록 인프라

#### 1. 데이터 스키마

1.1. `memory_item` 테이블의 `reflection_notes` 필드 활용 (Procedural Memory 전용)
   - 필드 타입: TEXT (JSON 형식)
   - NULL 허용: 예
   - Procedural Memory (`type='procedural'`)에만 사용

1.2. **Reflexion 저장 포맷 결정**:
   - **Phase 1 (초기 구현)**: 단일 JSON 객체 문자열로 저장
   - **Phase 2 (반복 실패 처리)**: JSON 배열 형식으로 확장 가능하도록 설계
   - **API 계약**: 
     - Phase 1: `reflection_notes`는 단일 JSON 객체 문자열
     - Phase 2: 동일 `task_goal`에 대한 반복 실패 시 JSON 배열로 변환
     - 배열 형식: `[{...}, {...}]` (각 요소는 Phase 1 스키마와 동일)

1.3. Reflexion JSON 스키마 (기존 0003 PRD 스키마 그대로 사용):
   ```json
   {
     "failure_type": "tool_error|user_feedback|metric_failure",
     "failure_description": "실패에 대한 상세 설명",
     "original_task": "원래 수행하려던 작업",
     "lessons_learned": "학습한 교훈",
     "suggested_improvements": "제안하는 개선 방안",
     "timestamp": "2025-01-01T00:00:00Z",
     "phase": "manual"
   }
   ```

1.4. 필드 설명:
   - `failure_type`: 실패 유형 (tool_error: 도구 호출 실패, user_feedback: 사용자 피드백, metric_failure: 성능 지표 미달)
   - `failure_description`: 실패에 대한 상세 설명
   - `original_task`: 원래 수행하려던 작업의 목표
   - `lessons_learned`: 실패를 통해 학습한 교훈
   - `suggested_improvements`: 다음 시도를 위한 개선 방안
   - `timestamp`: Reflexion 기록 시각 (ISO 8601 형식)
   - `phase`: 기록 방식 ("manual" 또는 "auto")

#### 2. MCP Tool 통합

2.1. 기존 `remember` Tool의 `reflection_notes` 파라미터 사용
   - `remember(type='procedural')` 호출 시 `reflection_notes` 파라미터로 Reflexion 데이터 전달
   - 별도의 MCP Tool 추가 없이 기존 Tool 확장으로 구현

2.2. `reflection_notes` 파라미터 검증:
   - 타입: 문자열 (JSON 형식)
   - 형식: 유효한 JSON 객체 문자열 또는 JSON 배열 문자열 (둘 다 허용)
   - 객체 형식: 단일 Reflexion 객체 `{...}`
   - 배열 형식: Reflexion 객체 배열 `[{...}, {...}]`
   - 필수 여부: 선택적 (Procedural Memory에서만 사용 가능)

2.3. `remember` Tool 처리 흐름:
   - `type='procedural'`이고 `reflection_notes`가 제공된 경우:
     - JSON 형식 검증 (단일 객체 또는 배열 모두 허용)
     - 기존 `reflection_notes`가 NULL이면 새로 저장
     - 기존 `reflection_notes`가 단일 객체면 배열로 변환 후 추가
     - 기존 `reflection_notes`가 배열이면 배열에 추가
     - `memory_item.reflection_notes` 필드에 저장
     - 저장 성공 시 메모리 ID 반환

2.4. **API 계약 명확화**:
   - 입력: 단일 JSON 객체 문자열 또는 JSON 배열 문자열 모두 허용
   - 저장: Phase 1에서는 단일 객체, Phase 2에서는 배열로 자동 변환
   - 조회: 항상 JSON 형식으로 반환 (단일 객체 또는 배열)

#### 3. 데이터 조회 및 검색

3.1. `recall` Tool을 통한 Reflexion 데이터 조회:
   - `recall` 결과에 `reflection_notes` 필드 포함
   - Procedural Memory 조회 시 `reflection_notes` 자동 포함

3.2. Reflexion 데이터 검색 및 FTS5 인덱싱:

3.2.1. **FTS5 가상 컬럼 추가 및 배열 인덱싱 설계**:
   - `memory_item_fts` 가상 테이블에 `reflection_notes` 컬럼 추가
   - **rowid당 1문서 구조 준수**: `memory_item_fts`는 rowid당 1문서이므로 배열 요소를 개별 문서로 처리 불가
   - **병합 토큰화 방식 채택**: 배열의 모든 요소를 하나의 텍스트로 병합하여 단일 row에 인덱싱
   - 배열 처리 로직:
     - JSON 배열인 경우: 각 요소의 모든 값 필드를 추출하여 공백으로 구분된 단일 문자열로 병합
     - 단일 객체인 경우: 모든 값 필드를 추출하여 공백으로 구분된 단일 문자열로 병합
     - 예시: `[{"failure_description": "API timeout"}, {"lessons_learned": "retry needed"}]` → "API timeout retry needed" (단일 토큰 스트림)

3.2.2. **정규화 정책**:
   - **키 토큰 선택적 포함**: 타입별 검색/필터링을 위해 중요한 키는 토큰으로 포함
     - 포함할 키: `failure_type` (tool_error, user_feedback, metric_failure), `phase` (manual, auto)
     - 제외할 키: `timestamp` (검색 불필요)
   - **값 필드 토큰화**: 모든 값 필드를 추출하여 토큰화
     - `failure_description`, `lessons_learned`, `suggested_improvements`, `original_task` 등의 값
   - **키-값 구분자**: 키와 값을 구분하기 위해 키 앞에 접두사 추가 (예: "type:tool_error", "phase:manual")
   - 예시: `{"failure_type": "tool_error", "failure_description": "API timeout"}` → "type:tool_error API timeout" 토큰으로 인덱싱
   - **검색 쿼리 예시**: 
     - `"type:tool_error"` → tool_error 타입만 검색
     - `"API timeout"` → failure_description에서 검색
     - `"type:tool_error API"` → tool_error 타입이면서 "API" 포함

3.2.3. **FTS5 트리거 업데이트**:
   - `memory_item_fts_insert` 트리거에 `reflection_notes` 추가
   - `memory_item_fts_update` 트리거에 `reflection_notes` 추가
   - `memory_item_fts_delete` 트리거에 `reflection_notes` 추가
   - JSON 파싱 및 정규화는 트리거 내에서 수행

3.2.4. **검색 쿼리 처리**:
   - `recall` Tool의 `query` 파라미터로 Reflexion 내용 검색 가능
   - FTS5 MATCH 쿼리를 통해 `reflection_notes` 필드 검색
   - 검색 결과에 `reflection_notes` 매칭 점수 포함

3.3. 필터링 지원:
   - `type='procedural'` 필터로 Procedural Memory만 조회
   - `reflection_notes IS NOT NULL` 조건으로 Reflexion이 있는 메모리만 조회 가능

### Phase 2: 자동 Reflexion 실행 시스템

#### 4. 실패 감지 시스템

4.1. MCP Tool 호출 실패 감지:
   - MCP Tool 호출 시 에러 반환 감지
   - 에러 타입: `ToolError`, `ValidationError`, `DatabaseError` 등
   - 실패 감지 시 자동으로 Reflexion 트리거

4.2. 사용자 피드백 기반 실패 감지:
   - 사용자가 명시적으로 실패를 지적한 경우 감지
   - 피드백 형식: 텍스트 메시지, 명시적 실패 표시 등
   - 실패 피드백 감지 시 자동으로 Reflexion 트리거

4.3. 성능 지표 미달 감지:
   - 응답 시간 임계값 초과
   - 정확도 지표 미달
   - 기타 성능 메트릭 임계값 미달
   - 성능 지표 미달 시 자동으로 Reflexion 트리거

#### 5. Reflexion Worker 구현

5.1. 백그라운드 Worker 프로세스:
   - 실패 감지 시 비동기로 Reflexion Worker 실행
   - 메인 프로세스에 영향 없이 백그라운드에서 실행
   - Worker 실패 시에도 메인 프로세스는 계속 동작

5.2. **Worker 운영 정책**:

5.2.1. **중복 감지 방지**:
   - **이벤트 키 설계**: timestamp를 제외한 해시 기반 키 사용
     - 이벤트 키: `SHA256({tool_name}_{error_type}_{error_message_hash})`
     - `error_message_hash`: 에러 메시지의 첫 50자 해시 (너무 긴 메시지 정규화)
   - **슬라이딩 윈도우 기반 중복 방지**:
     - 5분 윈도우 내 동일 이벤트 키는 중복 기록 방지
     - 윈도우 크기: 5분 (300초)
     - 윈도우 내 이벤트 추적: 메모리 기반 해시맵 사용 (TTL: 5분)
   - **중복 감지 로직**:
     - 이벤트 키로 윈도우 내 존재 여부 확인
     - 존재하면 로그만 기록하고 Reflexion 기록은 스킵
     - 존재하지 않으면 윈도우에 추가하고 Reflexion 기록 진행
   - **예시**: 
     - `remember` Tool에서 `ValidationError` 발생 → 키: `SHA256("remember_ValidationError_<hash>")`
     - 5분 내 동일 에러 재발생 → 중복으로 판단하여 스킵

5.2.2. **재시도 및 백오프**:
   - Reflexion 기록 실패 시 최대 3회 재시도
   - 지수 백오프: 1초, 2초, 4초 간격
   - 재시도 실패 시 에러 로그 기록 및 알림

5.2.3. **동시성 제한**:
   - 최대 동시 실행 Worker 수: 5개
   - 큐 적체 시 우선순위 기반 처리 (최근 실패 우선)
   - 큐 크기 제한: 100개 (초과 시 가장 오래된 항목 제거)

5.2.4. **장애 처리**:
   - Worker 프로세스 크래시 시 자동 재시작 (최대 3회)
   - 큐 적체 임계값: 50개 (초과 시 경고 알림)
   - 데이터베이스 연결 실패 시 큐에 보관 후 재시도

5.3. `auto_reflect` 내부 함수:
   - MCP Tool로 노출되지 않는 내부 함수
   - Reflexion Worker가 호출
   - 실패 정보를 바탕으로 Reflexion 데이터 생성
   - 중복 감지 로직 포함

5.4. Reflexion 데이터 자동 생성:
   - 실패 유형에 따라 적절한 `failure_type` 설정
   - 실패 설명 자동 추출
   - 원래 작업 목표 추출 (가능한 경우)
   - 개선 방안 제안 (템플릿 기반, Phase 2에서는 LLM 활용 고려)

#### 6. 동일 작업 반복 실패 처리

6.1. 동일 `task_goal`에 대한 반복 실패 감지:
   - Procedural Memory의 `task_goal` 필드를 기준으로 동일 작업 판단
   - 동일 `task_goal`에 대한 이전 Reflexion 기록 조회

6.2. 기존 Reflexion 기록 업데이트:
   - 동일 `task_goal`에 대한 반복 실패 시 기존 `reflection_notes`에 추가 기록
   - **저장 형식 변환 로직**:
     - 기존 `reflection_notes`가 NULL이면: 단일 객체로 저장
     - 기존 `reflection_notes`가 단일 객체면: 배열로 변환 `[{기존}, {새로운}]`
     - 기존 `reflection_notes`가 배열이면: 배열에 추가 `[{...}, {...}, {새로운}]`
   - 최대 배열 크기 제한: 100개 (초과 시 가장 오래된 항목 제거)
   - 별도 Reflexion 이력 테이블은 생성하지 않음 (기존 필드 활용)

6.3. 반복 실패 패턴 분석:
   - 동일 작업의 반복 실패 횟수 추적
   - 실패 패턴 분석 및 우선순위 결정

## Non-Goals (Out of Scope)

1. **별도 MCP Tool 추가**: `update_reflection` 같은 별도 Tool은 이번 구현 범위에 포함하지 않음 (기존 `remember` Tool만 사용)

2. **LLM 기반 자동 개선 방안 생성**: Phase 2에서 개선 방안 제안은 템플릿 기반으로 구현하며, LLM을 활용한 고급 분석은 후속 작업으로 진행

3. **Reflexion 이력 테이블**: 동일 작업의 반복 실패 시 별도 이력 테이블 생성은 하지 않으며, 기존 `reflection_notes` 필드에 JSON 배열로 저장

4. **실패 예측**: 실패를 예측하는 기능은 포함하지 않으며, 실제 실패 발생 후에만 Reflexion 기록

5. **다중 에이전트 지원**: 이번 구현에서는 단일 에이전트 환경만 고려하며, 다중 에이전트 지원은 후속 작업

## Design Considerations

### 데이터 구조

- **JSON 스키마**: 기존 0003 PRD의 스키마를 그대로 사용하여 일관성 유지
- **확장성**: 향후 추가 필드가 필요한 경우를 고려하여 JSON 구조 설계

### 성능 고려사항

- **비동기 처리**: Phase 2의 자동 Reflexion 기록은 백그라운드에서 비동기로 처리하여 메인 프로세스 성능에 영향 없음
- **인덱싱**: `reflection_notes` 필드의 검색 성능을 위해 FTS5 인덱스 활용
- **배치 처리**: 여러 실패가 동시에 발생할 경우 배치로 처리하여 성능 최적화

### 에러 처리

- **안정성 우선**: Reflexion 기록 실패가 메인 프로세스에 영향을 주지 않도록 격리
- **로깅**: 모든 Reflexion 기록 시도는 로그로 기록하여 디버깅 및 모니터링 가능
- **재시도**: 네트워크 오류 등 일시적 오류에 대한 재시도 로직 구현

## Technical Considerations

### 의존성

- **기존 인프라**: `memory_item` 테이블의 `reflection_notes` 필드는 이미 스키마에 존재 (0003 PRD 구현 시 추가됨)
- **MCP Tool**: 기존 `remember` Tool 확장
- **Worker 시스템**: 기존 `BatchScheduler` 또는 `AsyncTaskQueue` 활용 가능

### 데이터베이스

- **스키마**: 기존 스키마 활용, `reflection_notes` 필드는 이미 존재
- **FTS5 인덱스 마이그레이션**: 
  - `memory_item_fts` 가상 테이블에 `reflection_notes` 컬럼 추가 필요
  - **마이그레이션 전략**: 
    - 기존 `memory_item_fts` 테이블 삭제 후 재생성 (데이터 손실 없음, content 테이블 참조)
    - 또는 별도 마이그레이션 스크립트로 컬럼 추가 (FTS5는 ALTER TABLE 미지원)
  - **JSON 정규화 로직**: 트리거 내에서 JSON 파싱 및 토큰화 수행
  - **배열 병합 로직**: 배열 요소를 공백으로 구분된 단일 문자열로 병합
  - **다운타임 최소화 계획**:
    - **Zero-Downtime 마이그레이션 전략**:
      1. 새 FTS5 테이블 생성: `memory_item_fts_new` (reflection_notes 포함)
      2. 기존 데이터 재인덱싱: `memory_item` 테이블의 모든 row를 새 테이블에 인덱싱
      3. 트리거 일시 중지: 기존 트리거를 비활성화하여 중복 인덱싱 방지
      4. 원자적 교체: 트랜잭션 내에서 `memory_item_fts` 삭제, `memory_item_fts_new`를 `memory_item_fts`로 이름 변경
      5. 새 트리거 활성화: reflection_notes를 포함한 새 트리거 생성
    - **Fallback 전략**: 마이그레이션 실패 시 기존 테이블 유지, reflection_notes 검색은 LIKE 쿼리로 대체
    - **검색 공백 최소화**:
      - 마이그레이션 중에는 기존 FTS5 테이블로 검색 계속 제공
      - reflection_notes 검색만 일시적으로 LIKE 쿼리로 대체
      - 마이그레이션 완료 후 즉시 FTS5 검색으로 전환
    - **예상 다운타임**: 0초 (Zero-Downtime 전략) 또는 최대 10초 (대용량 데이터 재인덱싱 시간)
- **트랜잭션**: Reflexion 기록 시 트랜잭션으로 데이터 무결성 보장
- **마이그레이션 스크립트**: FTS5 스키마 변경을 위한 마이그레이션 스크립트 작성 필요

### 통합 포인트

- **MCP Tool 레이어**: `remember` Tool에서 `reflection_notes` 파라미터 처리
- **서비스 레이어**: Reflexion Worker 서비스 구현
- **에러 핸들링 레이어**: Tool 호출 실패 감지 및 Reflexion 트리거

## Success Metrics

### Phase 1 지표

1. **기능 완성도**:
   - 수동 Reflexion 기록 기능 구현 완료: 100%
   - `remember` Tool의 `reflection_notes` 파라미터 정상 동작: 100%
   - Reflexion 데이터 조회 및 검색 기능: 100%

2. **안정성**:
   - Reflexion 기록 성공률: 99% 이상
   - 데이터 무결성 검증 통과율: 100%
   - 에러 발생률: 1% 이하

### Phase 2 지표

1. **자동 감지 정확도** (측정 방법 명시):

1.1. **실패 감지 재현율 (Recall): 90% 이상**
   - **정의**: 실제 실패 이벤트 중 자동으로 감지된 비율
   - **측정 방법**:
     - **모집단**: 실패 이벤트 서브셋 (성공 호출 제외)
     - 모든 실패 이벤트에 수동 라벨링 (ground truth)
     - 자동 감지 결과와 ground truth 비교
     - 재현율 = TP / (TP + FN)
     - **의미**: 실제 실패 중 90% 이상을 감지해야 함
   - **측정 구간**: 주간 단위로 집계, 최소 50개 실패 샘플 필요
   - **로그 스키마**: `{event_id, tool_name, timestamp, error_type, detected, manual_label, is_failure}`
   - **샘플 확보 방안** (주간 50건 미만 시):
     - **기간 확장**: 주간 → 월간 단위로 집계하여 샘플 수 확보
     - **누적 샘플링**: 50개 샘플이 확보될 때까지 누적하여 측정
     - **테스트 환경 활용**: 개발/테스트 환경에서 의도적 실패 이벤트 생성하여 샘플 확보
     - **과거 데이터 활용**: 과거 로그 데이터를 재분석하여 초기 기준선 확보
     - **임계값 조정**: 초기 단계에서는 샘플 수가 적을 수 있으므로, 30개 이상부터 측정 시작 (신뢰도는 낮지만 추세 파악 가능)

1.2. **실패 감지 정밀도 (Precision): 85% 이상**
   - **정의**: 감지된 실패 중 실제 실패인 비율
   - **측정 방법**:
     - **모집단**: 자동 감지된 모든 이벤트
     - 정밀도 = TP / (TP + FP)
     - **의미**: 감지된 이벤트 중 85% 이상이 실제 실패여야 함
   - **라벨링 프로세스**:
     - 주간 샘플링: 자동 감지된 이벤트의 20% 랜덤 샘플링
     - 수동 검증: 개발자가 샘플을 검토하여 실제 실패 여부 라벨링
     - 자동 검증: 성공 응답 코드 기반 자동 라벨링 (보조)

1.3. **전체 시스템 정확도 (참고 지표)**:
   - **정의**: 전체 MCP 호출(성공+실패)에 대한 정확도
   - **측정 방법**: (TP + TN) / (TP + TN + FP + FN)
   - **주의**: TN(정상 호출)이 압도적으로 많아 지표가 무의미할 수 있음
   - **용도**: 참고용 지표로만 사용, 주요 지표는 재현율/정밀도

1.4. **Reflexion 기록 성공률: 95% 이상**
   - **정의**: 감지된 실패 이벤트 중 Reflexion 기록이 성공한 비율
   - **측정 방법**: 성공 기록 수 / 전체 감지 이벤트 수

2. **성능 개선**:
   - 동일 작업 재시도 시 성공률 개선: 30% 이상 향상
   - 에러 발생률 감소: 20% 이상 감소
   - 평균 작업 완료 시간 단축: 10% 이상 개선

3. **시스템 안정성**:
   - Reflexion Worker 실패가 메인 프로세스에 미치는 영향: 0%
   - 백그라운드 처리 지연 시간: 평균 1초 이하

### 검색 및 조회 용이성

1. **검색 성능**:
   - Reflexion 데이터 검색 응답 시간: 500ms 이하
   - 검색 결과 정확도: 85% 이상

2. **사용성**:
   - Reflexion 데이터 조회 API 응답 시간: 200ms 이하
   - 데이터 포맷 일관성: 100%

## 데이터 수명 및 용량 관리 정책

### 보존 기간

1. **기본 보존 기간**: 365일 (1년)
   - Reflexion 데이터는 1년간 보존
   - 1년 경과 후 자동 정리 대상

2. **중요도 기반 보존**:
   - `importance >= 0.8`인 Procedural Memory의 Reflexion: 무기한 보존
   - `pinned=true`인 메모리의 Reflexion: 무기한 보존
   - 일반 Reflexion: 365일 후 정리

3. **정리 정책**:
   - 주간 배치 작업으로 만료된 Reflexion 정리
   - 정리 전 백업: `data/backups/reflection_cleanup_YYYYMMDD.json`
   - 정리된 데이터는 JSON 파일로 백업 후 DB에서 삭제

### 용량 관리

1. **배열 크기 제한**:
   - `reflection_notes` 배열 최대 크기: 100개
   - 초과 시 가장 오래된 항목 제거 (FIFO)
   - 제거 전 경고 로그 기록

2. **필드 크기 제한**:
   - 단일 Reflexion 객체 최대 크기: 10KB
   - 전체 `reflection_notes` 필드 최대 크기: 1MB
   - 초과 시 경고 및 자동 정리

3. **성능 모니터링**:
   - `reflection_notes` 필드 평균 크기 추적
   - 큰 필드가 있는 메모리 식별 및 최적화
   - 주간 리포트 생성

## Risk & Mitigation

### 측정 지표 샘플 부족 리스크

**리스크**: 실패 이벤트가 주간 50건 미만일 경우 재현율/정밀도 측정이 지연될 수 있음

**완화 방안**:
1. **기간 확장**: 주간 → 월간 단위로 집계하여 샘플 수 확보
2. **누적 샘플링**: 50개 샘플이 확보될 때까지 누적하여 측정
3. **테스트 환경 활용**: 개발/테스트 환경에서 의도적 실패 이벤트 생성
4. **과거 데이터 활용**: 과거 로그 데이터를 재분석하여 초기 기준선 확보
5. **임계값 조정**: 초기 단계에서는 30개 이상부터 측정 시작 (신뢰도는 낮지만 추세 파악 가능)

### FTS5 마이그레이션 다운타임 리스크

**리스크**: `memory_item_fts` 재생성에 따른 다운타임 또는 일시적 검색 공백 발생

**완화 방안**:
1. **Zero-Downtime 마이그레이션 전략** (상세 내용은 Technical Considerations 참조)
2. **Fallback 전략**: 마이그레이션 실패 시 기존 테이블 유지, reflection_notes 검색은 LIKE 쿼리로 대체
3. **검색 공백 최소화**: 마이그레이션 중에도 기존 FTS5 테이블로 검색 계속 제공
4. **예상 다운타임**: 0초 (Zero-Downtime 전략) 또는 최대 10초 (대용량 데이터 재인덱싱)

## Open Questions

1. **LLM 활용 범위**: Phase 2에서 개선 방안 제안을 위해 LLM을 활용할지, 아니면 템플릿 기반으로만 구현할지 결정 필요

2. **반복 실패 임계값**: 동일 작업이 몇 번 실패해야 Reflexion을 자동으로 기록할지 임계값 설정 필요
   - **제안**: 첫 실패 시 즉시 기록, 이후 동일 작업 실패는 3회마다 기록

3. **성능 지표 임계값**: Phase 2의 성능 지표 미달 감지를 위한 구체적인 임계값 설정 필요
   - **제안**: 
     - 응답 시간: 평균 대비 200% 초과
     - 정확도: 70% 미달
     - 에러율: 10% 초과

4. **사용자 피드백 감지 방법**: 사용자 피드백 기반 실패 감지의 구체적인 구현 방법
   - **제안**: 키워드 기반 감지 (Phase 2), 향후 감정 분석 추가 고려

5. **테스트 전략**: 자동 Reflexion 기능의 테스트 방법 및 시나리오 정의 필요
   - **제안**: 
     - 단위 테스트: Worker 로직, 중복 감지, 재시도
     - 통합 테스트: 전체 실패 감지 플로우
     - 성능 테스트: 동시성, 큐 적체 시나리오

---

**관련 문서**:
- Issue #36: [FEATURE] Reflexion (교정형 성찰) 기능 구현
- PRD 0003: MIRIX 기반 인지 스키마 확장 및 데이터 모델 리팩토링

