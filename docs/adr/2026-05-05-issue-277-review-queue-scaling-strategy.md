# ADR: 리뷰 후보 산출/전달 확장 전략 (이슈 #277)

- 상태: Proposed
- 날짜: 2026-05-05
- 이슈: https://github.com/jee1/memento/issues/277
- 관련: #241, #243

## Context

현재 리뷰 후보 파이프라인은 SQLite + in-process `BatchScheduler` + in-process SSE 허브를 기반으로 한다.
이 구조는 단일 노드에서는 단순하고 안정적이나, 멀티 인스턴스 확장 시 스케줄 중복 실행과 이벤트 전파 분리 문제가 발생할 수 있다.

이번 의사결정의 목표는 다음이다.
- 외부 큐/분산 스케줄러 도입을 당장 강제하지 않는다.
- 필요 시점(언제 필요한가)과 이행 경로를 명시한다.
- 후속 구현 이슈로 분해 가능한 형태로 결론을 고정한다.

## Decision

기본 전략으로 **현행 유지(A)**를 채택한다.
- 현재 기본 아키텍처는 SQLite + BatchScheduler + Admin API + SSE/poll fallback을 유지한다.
- 단, 전환 판단을 위한 운영 지표를 명시적으로 수집한다.

확장 전략은 단계적으로 적용한다.
1. A 유지 + 관측 강화
2. 트리거 충족 시 Redis queue(B)로 점진 전환
3. 운영 요구가 충분히 커질 때 외부 scheduler/worker(C) 채택 검토

## Decision Drivers

- YAGNI: 현재 요구에 비해 Redis/외부 scheduler 선도입은 복잡도 과다
- 운영 단순성: 단일 노드에서 장애 분석·복구 경로가 가장 짧음
- 점진 이행 가능성: B/C는 공존 전략으로 단계적 이전 가능
- 멀티 인스턴스 리스크: 중복 스케줄과 in-process 이벤트 허브 한계는 명확히 존재

## Options Considered

### Option A: 현행 유지
- 장점: 단순성/비용/정합성(현 코드)
- 단점: 멀티 인스턴스 정합성 한계

### Option B: Redis queue
- 장점: 버퍼링/재시도/수평 확장
- 단점: 운영비/복잡도 증가, idempotency 규약 필요

### Option C: 외부 scheduler + worker
- 장점: 책임 분리와 통제력 최대
- 단점: 운영 복잡도와 비용 최대

## When to Revisit

아래 신호가 일정 기간 지속되면 A -> B 재평가를 시작한다.
- 멀티 인스턴스 상시 운영 필요
- `memory_review_candidates` 지연/누적 반복
- pending 증가 추세 고착
- 운영자가 인스턴스별 실행 경로를 반복 추적

B -> C는 아래 조건에서만 검토한다.
- 스케줄 책임 분리 요구가 강함
- scheduler/worker 독립 운영 역량 확보
- 중앙 감사/재실행 통제 요구 존재

## Consequences

### Positive
- 현재 시스템 안정성과 개발 속도를 유지한다.
- 전환 판단 기준을 명시해 논쟁 비용을 줄인다.
- 후속 구현을 작은 이슈 단위로 분해할 수 있다.

### Negative
- 멀티 인스턴스 고도화는 즉시 해결되지 않는다.
- 관측 지표가 부족하면 전환 시점 판단이 지연될 수 있다.

## Follow-up Work

1. 배치 지연/누적/처리량 지표 정의
2. 후보 잡 실행 메타 표준 이벤트 정의
3. 큐 도입 PoC(이벤트 fan-out 경로)
4. idempotency + retry + DLQ 정책 문서화
5. 스케줄 단일 실행 전략(leader/external trigger) 설계 — 기본 채택: 외부 트리거·단일 실행자 + `MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED`; 상세 [#299](https://github.com/jee1/memento/issues/299) / [불변 기준선 문서](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/docs/_work/solutions/2026-05-09-review-queue-schedule-single-runner-strategy.md)
6. **멀티 인스턴스 Admin SSE** — 채택안 확정: Tier 1은 **폴링을 정합성 기본 경로**, SSE는 **동일 인스턴스 저지연 힌트**, 배포는 **sticky 권장**; Tier 2는 기존 HTTP 릴레이 관측; Tier 3는 Gate A→B 후 공유 버스. 상세 [#300](https://github.com/jee1/memento/issues/300) / [불변 기준선 문서](https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/docs/_work/solutions/2026-05-09-review-queue-sse-multi-instance-strategy.md)

## Amendment: Multi-instance Admin SSE (2026-05-09, #300)

Admin Review Queue의 SSE는 **프로세스 로컬**이므로 멀티 인스턴스에서는 **교차 인스턴스 실시간 일치**를 보장하지 않는다. 제품 기준은 **폴링으로의 수렴**이며, 저지연 SSE는 sticky 또는 단일 노드에서 최적이다. HTTP 릴레이(#297)는 측정·실험 경로이며, 피어 ingest는 선택 후속이다. 전문은 위 불변 기준선 문서를 따른다.
