# 해시 체인 감사 로그

`audit_log`는 MCP stdio, MCP HTTP, HTTP 관리 경계에서 사용하는 append-only SQLite 테이블입니다. 각 record는 이전 SHA-256 hash와 자신의 canonical metadata hash를 보관합니다. SQLite trigger가 update와 delete를 거절하며, `AuditHashChainService.verify()`와 `GET /api/v1/audit/export`가 처음 끊어진 link를 찾습니다.

## 증거 경계

테이블에는 actor/owner/agent 식별자, transport, tool 또는 endpoint, action, target URI, 결과 상태, evidence 상태, coverage verdict만 저장합니다. raw tool argument, tool output, credential, memory content는 저장하지 않습니다.

`evidence_mode`는 `full`, `redacted`, `metadata_only`, `unavailable` 중 하나입니다. dispatch 통합은 `metadata_only`, `tool_args_state=omitted`, `output_state=omitted`를 사용합니다. 인증된 actor 부재, payload redaction, output truncation, audit write 실패, retention 충돌은 `coverage_gap`으로 남고 보통 `audit_verdict=incomplete`가 됩니다.

## 모드

- 기본값 `MEMENTO_AUDIT_MODE=best-effort`: 가능한 경우 불완전 coverage를 남기고 audit write가 실패해도 요청은 계속 처리합니다.
- `MEMENTO_AUDIT_MODE=strict`: 민감한 `delete`, `admin` 실행 전에 audit table 접근 가능 여부와 검증된 actor를 확인합니다. 허용할 수 없는 coverage gap이면 작업 전에 실패합니다. `auth_denied`는 이미 401/403으로 거절되므로, 가능한 경우 불완전 denied record로 보존합니다.

MCP stdio에는 내장된 인증 actor가 없습니다. 따라서 `actor_unverified`가 기록되며, strict 모드에서 stdio delete는 인증 dispatch layer가 actor를 공급하지 않는 한 거절됩니다.

## 조회와 export

`GET /api/v1/audit/entries`, `GET /api/v1/audit/export`는 `admin:destructive` programmatic scope가 필요합니다. 두 endpoint는 선택적으로 `action`, `transport`, `actorId`, `limit`(1-1000)을 받습니다. export는 전체 chain 검증 결과도 반환합니다.

## 보존과 archive

감사 보존은 메모리 삭제·망각 정책과 독립적입니다. 이후 link를 무효화하므로 append-only 테이블에는 자동 purge가 없습니다. SQLite DB를 일반 백업에 포함하고, 운영자가 DB rotation을 하기 전 verified export를 archive하세요. retention 정책이 append-only 제약과 충돌하면 chain row를 조용히 지우지 말고 `retention_conflict`를 기록합니다.
