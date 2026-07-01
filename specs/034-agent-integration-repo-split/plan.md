# Implementation Plan: 034-agent-integration-repo-split

## Architecture

`SqliteAgentIntegrationRepository` god node(952줄)를 **composition**으로 분해한다. Public import 경로(`sqlite-agent-integration-repository.js`)와 `SqliteAgentIntegrationRepository` class export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
sqlite-agent-integration-repository.ts   # 오케스트레이션, AgentIntegrationRepository 위임
agent-integration-row-utils.ts           # Row types, domain 매핑
agent-integration-cursor-utils.ts        # cursor encode/decode, aggregate helper
agent-integration-session-store.ts       # session CRUD, list, dashboard, lifecycle
agent-integration-observation-store.ts   # observation CRUD, listing, payload cleanup
agent-integration-promotion-store.ts     # promotion candidate, approve/reject, summary
agent-integration-provenance-store.ts    # provenance CRUD, source deletion
```

## Changes

| 파일 | 변경 |
|------|------|
| `agent-integration-row-utils.ts` | 신규 — row 매핑 |
| `agent-integration-cursor-utils.ts` | 신규 — cursor 유틸 |
| `agent-integration-session-store.ts` | 신규 — session 저장소 |
| `agent-integration-observation-store.ts` | 신규 — observation 저장소 |
| `agent-integration-promotion-store.ts` | 신규 — promotion 저장소 |
| `agent-integration-provenance-store.ts` | 신규 — provenance 저장소 |
| `sqlite-agent-integration-repository.ts` | 축소 — delegate only |

## Test Strategy

- 선행: `sqlite-agent-integration-repository.spec.ts` + agent-integration domain spec green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run build && npm test && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception (Constitution I): CI green = regression signal
- Backward compatibility (Constitution II): import path·public API 유지
- Quality gates (Constitution IV) 필수
