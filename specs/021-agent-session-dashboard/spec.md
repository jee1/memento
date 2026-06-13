# Feature Specification: Agent Session Dashboard and Transcript Import

**Feature Branch**: `feature/issue-460-agent-session-dashboard`
**Created**: 2026-06-07
**Status**: Draft
**Input**: GitHub issue #460, parent PRD FR-013 and FR-021~023

## Overview

운영자가 coding-agent session의 lifecycle, observation, 파생 기억, context injection 결정을 한 화면에서 탐색하고, 지원용 JSONL transcript를 저장 전에 안전하게 검증하고 가져올 수 있게 한다.

## User Scenarios and Testing

### User Story 1 - Session 목록과 상태 파악 (P1)

운영자는 최근 session을 cursor pagination으로 조회하고 상태, adapter, 시간, observation aggregate를 비교한다.

**Acceptance Scenarios**

1. session이 많을 때 목록은 안정적인 cursor와 최대 100건 page로 동작한다.
2. status, adapter, owner, project 필터가 적용되고 각 session에 observation total/redacted/dropped/degraded/late aggregate가 표시된다.
3. loading, empty, error 상태가 명시적으로 표시된다.

### User Story 2 - Observation timeline 탐색 (P1)

운영자는 session 상세에서 prompt/tool/result/error/response 계열 사건을 시간 순서로 구분하고 status와 event type으로 필터링한다.

**Acceptance Scenarios**

1. timeline은 `(sequence_no, occurred_at, received_at, id)` cursor 순서를 유지한다.
2. redacted observation은 원문 없이 redacted badge와 redaction count만 표시한다.
3. dropped/degraded/late observation은 reason과 상태를 표시하되 payload를 노출하지 않는다.
4. 다음 page를 로드해도 중복 또는 누락 없이 이어진다.

### User Story 3 - Provenance와 injection 근거 탐색 (P1)

운영자는 memory에서 source observation과 session으로, observation에서 파생 memory로 한 단계 안에 이동하고 injection 후보의 score/token/사용 여부를 확인한다.

**Acceptance Scenarios**

1. memory ID 또는 observation ID로 provenance detail을 조회하면 연결된 memory, observation, session의 안전한 summary가 반환된다.
2. session 상세에는 injection별 selected/excluded 후보, score, token estimate, token budget, token used, used 여부가 표시된다.
3. source가 삭제되거나 unavailable이면 broken link 대신 `source_deleted` 또는 unavailable 상태를 표시한다.

### User Story 4 - JSONL transcript 검증과 import (P1)

운영자는 JSONL transcript를 기본 dry-run으로 검사하고 모든 line이 통과한 경우에만 명시적으로 저장한다.

**Acceptance Scenarios**

1. 요청에서 `dry_run`을 생략하면 저장 없이 validation 결과만 반환한다.
2. syntax/schema/session ordering/sensitive/path/size/idempotency 검사를 모든 line에 수행한 뒤 write 여부를 결정한다.
3. validation error 또는 idempotency conflict가 하나라도 있으면 어떤 session/observation도 저장하지 않는다.
4. 동일 transcript 재import는 duplicate로 보고 새 row를 만들지 않는다.
5. import API 응답과 dashboard는 redaction 전 원문 또는 redacted 값을 반사하지 않는다.

## Requirements

### Functional Requirements

- **FR-001**: `GET /api/v1/agent/sessions`는 cursor pagination과 status/adapter/owner/project 필터를 제공해야 한다.
- **FR-002**: `GET /api/v1/agent/sessions/aggregate`는 session/observation 상태 aggregate를 제공해야 한다.
- **FR-003**: session 목록과 상세는 observation aggregate를 포함해야 한다.
- **FR-004**: 기존 observation cursor API는 event/status filter를 유지하고 redaction metadata의 count만 안전하게 제공해야 한다.
- **FR-005**: event type과 outcome을 prompt/tool/result/error/response/lifecycle 시각 category로 매핑할 수 있는 DTO를 제공해야 한다.
- **FR-006**: provenance detail은 memory, observation, session을 한 응답에서 탐색 가능하게 해야 한다.
- **FR-007**: injection detail은 selected/excluded 후보의 score, token estimate, reason과 usage를 제공해야 한다.
- **FR-008**: transcript import는 JSONL을 line 단위로 파싱하고 기존 agent normalization/redaction/size policy를 재사용해야 한다.
- **FR-009**: transcript import 기본값은 dry-run이어야 한다.
- **FR-010**: non-dry-run import는 validation 완료 후 단일 transaction에서만 write해야 한다.
- **FR-011**: import dedupe는 기존 `(adapter_name, event_id)` idempotency contract를 따라야 한다.
- **FR-012**: dashboard와 import API는 programmatic auth 경계를 재사용해야 한다.
- **FR-013**: API/UI는 redacted payload 원문, secret fragment, raw payload JSON을 노출하지 않아야 한다.
- **FR-014**: dashboard는 loading/empty/error/degraded/redacted/dropped 상태를 구분해야 한다.
- **FR-015**: 신규 UI CSS는 `static/css/tokens.css` 토큰을 사용해야 한다.
- **FR-016**: 신규 dependency를 추가하지 않아야 한다.

## Non-Goals

- CLI doctor/status/demo
- benchmark와 graph-RRF
- transcript format 자동 추론
- raw observation payload viewer
- 기존 browser session auth를 programmatic API에 허용하는 변경

## Success Criteria

- **SC-001**: 10,000 observation session을 page size 100 이하로 탐색할 수 있다.
- **SC-002**: redacted secret fixture 문자열의 API/UI 노출이 0건이다.
- **SC-003**: memory→observation→session 또는 observation→memory 이동이 한 detail request와 한 UI action 안에 가능하다.
- **SC-004**: invalid transcript import 후 관련 table row 증가가 0건이다.
- **SC-005**: duplicate transcript 재import 후 observation row 증가가 0건이다.
- **SC-006**: lint, type-check, targeted tests, SQL injection, PII masking, path traversal checks가 통과한다.

## Assumptions

- JSONL 한 line은 agent event envelope 한 건이다.
- 첫 non-duplicate event는 `SESSION_START`이며 이후 line은 동일 session identity를 유지한다.
- dashboard browser session은 `/api/v1/agent`에 직접 권한을 주지 않는다. 사용자가 입력한 API key를 메모리에만 유지해 programmatic header로 전송한다.
