# Developer Continuity Assistant (Phase 1)

개발 세션 연속성을 위한 Phase 1 MVP: 세션 시작/종료, 컨텍스트 저장, resume 스냅샷 조회까지 CLI·HTTP로 제공합니다.

## 구현 범위 (Phase 1)

- **packages/memento-core**: 범용 메모리 플랫폼 공개 엔트리(facade). 실제 구현은 루트 `src/`에 유지.
- **packages/memento-assistant**: 연속성(continuity) 전용 계층. core의 remember/recall 계약만 사용.
- **continuity 도구 4종**: `start_session`, `save_context`, `end_session`, `resume_session`.
- **Assistant HTTP 서버**: `POST /assistant/tools/:name` 로 continuity 도구 노출.
- **AssistantClient + CLI**: `AssistantClient`(fetch 기반), `memento-continuity` CLI(tsx 또는 빌드 후 bin).

## Continuity 태그

저장 시 다음 태그가 사용됩니다.

| 태그 | 용도 |
|------|------|
| `continuity` | 모든 continuity 체크포인트 공통 |
| `task` | 세션 시작/작업 단위 |
| `decision` | 결정 사항 |
| `blocker` | 막힌 점/이슈 |
| `next-step` | 다음 액션/세션 종료 요약 |

`origin_source`에는 JSON으로 `project`, `branch`, `session_id` 등이 들어갑니다.

## CLI 사용 예시

```bash
# 세션 시작
memento-continuity start --project memento --process cursor --branch feature/resume

# 컨텍스트 저장 (decision)
memento-continuity save --kind decision --content "resume 엔진은 recall 기반으로 간다" --project memento --session_id sess-1

# 세션 종료
memento-continuity end --project memento --session_id sess-1 --summary "resume 초안 완료"

# resume 스냅샷 조회
memento-continuity resume --project memento
```

개발 시에는 루트에서 다음으로 실행할 수 있습니다.

```bash
npm run dev:continuity-cli -- resume --project memento
```

## Resume 스냅샷 4개 섹션

| 섹션 | 의미 |
|------|------|
| **Resume** | `task` 태그로 저장된 작업/진행 내용 |
| **Recent Decisions** | `decision` 태그로 저장된 결정 |
| **Open Threads** | `blocker` 태그로 저장된 막힌 점 |
| **Next Actions** | `next-step` 태그로 저장된 다음 액션/종료 요약 |

resume API는 `project`(및 선택적으로 `process_id`, `session_id`, `branch`)로 continuity 태그가 붙은 기억만 필터해 위 네 섹션으로 나눠 반환합니다.

## 저장·승인 경계

- **저장**: `save_context` / `start_session` / `end_session` 호출 시 assistant가 core의 remember 계약을 호출해 저장합니다. Phase 1에서는 별도 “승인 후 저장” 플로우는 없습니다.
- **억제 조건**: core의 remember 검증(필수 필드, 타입 등)을 그대로 따릅니다. assistant는 `SessionCheckpointService.buildCheckpointPayload()`로 continuity 태그·origin_source를 붙여 전달합니다.

## Assistant 런타임 기동

assistant는 core의 remember/recall API에 연결된 상태로 기동해야 한다. core HTTP 서버를 먼저 띄운 뒤, assistant를 `MEMENTO_CORE_URL`로 연결한다.

```bash
# 1) core HTTP 서버 (기본 포트 3000)
npm run dev:http

# 2) assistant 런타임 (core URL 지정, 기본 포트 8090)
MEMENTO_CORE_URL=http://localhost:3000 npm run dev:assistant
```

`dev:assistant`는 `run-assistant-server`를 통해 `createCoreToolHttpClient` + `createRuntimeCoreBridge`로 core에 연결한 뒤 `createAssistantApp(bridge)`를 띄운다.

## E2E 검증

core HTTP 서버와 assistant 런타임이 기동된 상태에서:

```bash
MEMENTO_CORE_URL=http://localhost:3000 \
MEMENTO_ASSISTANT_URL=http://localhost:8090 \
tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

위 스크립트는 start → save(decision) → save(next-step) → end → resume 순서로 호출한 뒤, snapshot의 `recentDecisions`와 `nextActions`가 비어 있지 않은지 검증합니다.

## 참고

- 설계·구현 계획: [docs/plans/ko/2026-02-28-memento-developer-continuity-assistant-design.md](../plans/ko/2026-02-28-memento-developer-continuity-assistant-design.md), [implementation-plan](../plans/ko/2026-02-28-memento-developer-continuity-assistant-implementation-plan.md).
- IDE 패널, Slack/Telegram 연동, 승인형 쓰기 등은 후속 계획에서 다룹니다.
