# 이슈 #277 스파이크: Review 후보 산출/전달 구조 확장 옵션

- 이슈: https://github.com/jee1/memento/issues/277
- 기준 구현: #241, #243
- 작성일: 2026-05-05
- 목적: 현재 SQLite + BatchScheduler 기반 구조를 기준으로 외부 큐/분산 스케줄러 확장 옵션, 필요 시점, 공존/이행 전략을 정리한다.

## 1) 현재 구조 요약

### 1.1 배치 산출 경로
- `BatchScheduler`가 `memory_review_candidates` 잡을 주기 실행한다.
- 잡 실행 본문은 `selectMemoryReviewCandidates` -> `upsertPendingMemoryReviewCandidates` 순서로 `memory_review_candidate`(pending)를 갱신한다.
- 수동 경로로 `POST /admin/batch/run`에서도 동일 잡을 실행한다.

### 1.2 조회/액션 경로
- `GET /admin/memory/review-candidates`로 후보 목록을 조회한다.
- `POST /admin/memory/review-candidates/:id/review|dismiss`로 상태를 전환한다.
- 대시보드는 `static/js/review-candidates-panel.js`에서 목록 조회 + 액션 + SSE/폴링을 조합한다.

### 1.3 알림/전파 경로
- 서버 내부 `review-candidates-sse-hub`가 in-process SSE fan-out을 담당한다.
- SSE 연결 실패/미지원 시 poll fallback으로 보정한다.

## 2) 병목/한계 조건

### 2.1 단일 노드 유효 조건
아래를 모두 만족하면 현행 유지가 유효하다.
- 배치 적시성: 실행 지연이 목표 주기 대비 장기 누적되지 않는다.
- 큐 안정성: pending이 단조 증가하지 않고 정상 진동 범위에 있다.
- 운영 가시성: 단일 인스턴스 로그/상태만으로 원인 추적이 빠르다.
- 배포 형태: 멀티 인스턴스 상시 운영 요구가 없다.

### 2.2 멀티 인스턴스 취약점
- 스케줄 중복 실행: 인스턴스별 `BatchScheduler`가 동일 잡을 중복 수행할 수 있다.
- 이벤트 분리: in-process SSE hub 특성상 인스턴스 간 changed 이벤트 전파가 없다.
- 수동 실행 관찰 불일치: `/admin/batch/run` 실행 인스턴스와 UI 연결 인스턴스가 다르면 즉시성 체감이 어긋날 수 있다.
- 운영 지표 분산: 성공/실패/지연 신호가 인스턴스별로 분리되어 추적 난이도가 증가한다.

## 3) 옵션 비교

### A. 현행 유지 (SQLite + BatchScheduler + in-process SSE)
- 장점: 운영 단순성 최고, 현행 코드와 정합, 도입 비용 최소.
- 단점: 멀티 인스턴스 정합성 한계(중복 스케줄/SSE 분리) 내재.
- 권장 맥락: 단일 인스턴스 중심, 배치 지연/누적이 통제 가능한 경우.

### B. Redis Queue 도입 (스케줄러는 앱 내부 또는 단일 리더)
- 장점: 버퍼링, 재시도, DLQ 패턴, worker 수평 확장.
- 단점: Redis 운영비와 장애면 추가, idempotency/중복 처리 규약 필요.
- 공존 전략: 산출/처리 경로만 큐로 분리하고 조회 API/대시보드는 DB 중심으로 유지 가능.

### C. 외부 Scheduler + 독립 Worker
- 장점: 스케줄 책임 완전 분리, 멀티 인스턴스 정합성/통제력 최고.
- 단점: 운영 복잡도/비용 최대(스케줄러+큐+워커+관측).
- 권장 맥락: 강한 SLO/감사 요구, 다중 서비스/리전 확장이 필수인 단계.

## 4) 추천안과 전환 시점 기준

### 4.1 현재 추천
- 기본안은 A(현행 유지)로 둔다.
- 이유: 현 시점 목표는 구현 확장이 아니라 스파이크/설계이며, YAGNI 원칙에 따라 복잡도 선도입을 피한다.

### 4.2 A -> B 전환 트리거
아래 중 2개 이상이 일정 기간(예: 2주) 지속되면 B 검토를 시작한다.
- 멀티 인스턴스 상시 운영이 필요해짐.
- 배치 지연/누적이 튜닝으로 해소되지 않음.
- pending 증가 추세가 해소되지 않음.
- 운영자가 인스턴스별 실행 경로를 반복 추적해야 함.

### 4.3 B -> C 전환 트리거
- 큐 도입 후에도 스케줄 책임 분리 요구가 강함.
- 배포/운영 조직이 scheduler/worker 분리 운영을 수용 가능.
- 중앙 스케줄 기반 감사/재실행/정책 통제가 필수.

## 5) 단일 노드 -> 큐 기반 마이그레이션 단계

### Phase 0: 준비 (현행 유지)
- 잡 지연, pending 추이, 수동 실행 빈도, 장애 복구 시간을 측정하는 운영 지표를 정리한다.
- `memory_review_candidates` 잡의 실행 결과/지연/오류를 대시보드 또는 로그 집계로 가시화한다.

### Phase 1: 큐 경계 도입 (dual path, 읽기 경로 유지)
- 후보 산출 후 즉시 처리해야 하는 작업(예: 알림 트리거)을 큐 토픽으로 분리한다.
- 기존 DB upsert 경로는 유지하고, 큐 소비자는 부가 작업만 수행한다.
- 목적: 큐 운영 리스크를 기능 핵심 경로와 분리해 학습.

### Phase 2: 후보 갱신 실행 주체 전환
- `BatchScheduler` 직접 실행 대신 큐 소비 worker가 후보 갱신 책임을 갖도록 전환한다.
- idempotency 키(예: memory_id + status + due_bucket)와 중복 소비 안전성 규칙을 명시한다.
- 실패/재시도/DLQ 정책을 운영 문서로 고정한다.

### Phase 3: 멀티 인스턴스 정합성 정리
- 스케줄 단일 리더 또는 외부 scheduler로 중복 실행을 차단한다.
- SSE changed 이벤트는 인스턴스 로컬이 아닌 shared bus 기반 fan-out으로 대체하거나, 폴링 중심 정책으로 단순화한다.

### Phase 4: 선택적 외부 scheduler 분리
- 운영 요구가 충분히 커지면 scheduler를 별도 컴포넌트로 독립시킨다.
- 이 시점에만 C 옵션을 채택하고, B 단계에서 축적된 운영 지표를 근거로 승인한다.

## 6) 후속 구현 이슈 분해 초안

1. 배치 지연/누적 지표 정의 및 운영 대시보드 추가
2. 후보 갱신 잡 실행 메타(지연/결과) 표준 이벤트 스키마 정의
3. 큐 도입 PoC: review-candidates changed 이벤트 버스화
4. 큐 소비 idempotency 정책/키 설계 및 테스트
5. DLQ/재시도 정책 문서화 및 장애 대응 런북
6. 멀티 인스턴스 스케줄 단일 실행(leader election or external trigger) 설계
7. SSE fan-out 공용화 또는 폴링-only 전환 ADR

## 7) 결론

- 단기: 현행(A) 유지 + 관측 강화가 최선.
- 중기: 트리거 충족 시 Redis queue(B)로 점진 전환.
- 장기: 운영 성숙도/요구 수준이 올라갈 때 외부 scheduler/worker(C)를 선택.

이 문서는 구현 지시서가 아니라 아키텍처 스파이크 문서이며, 실제 채택 결정은 ADR로 고정한다.
