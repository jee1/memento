# Developer Continuity Assistant Phase 1 재리뷰

**일자**: 2026-03-01  
**대상 브랜치**: `feature/developer-continuity-assistant-phase1`  
**검토 기준 문서**:
- `docs/plans/ko/2026-02-28-memento-developer-continuity-assistant-implementation-plan.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-design.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md`
- `docs/code_review/ko/2026-02-28-developer-continuity-assistant-phase1-code-review.md`

---

## 1. 리뷰 요약

이번 수정으로 이전 리뷰의 주요 지적 중 상당수는 실제로 닫혔다. 루트 배포 경계, workspace-aware `type-check`, assistant package root export, `zod` runtime dependency, CLI `--process` alias, assistant runtime 실행 스크립트는 모두 코드와 검증 명령 기준으로 개선이 확인됐다.

다만 요구사항 기준으로 보면 아직 두 가지 핵심 공백이 남아 있다.

1. assistant runtime이 실제로 core remember/recall 경로와 연결되지 않아 문서대로 동작하지 않는다.
2. `memento-core` facade가 여전히 너무 얇아, 구현 계획이 요구한 “assistant가 사용할 최소 공개 계약” 수준까지는 도달하지 못했다.

즉, 이번 수정은 hardening의 절반 이상을 닫았지만, **실행 가능한 runtime wiring**과 **core public facade 완결성**은 아직 미완성이다.

---

## 2. 닫힌 항목

### 2.1 루트 배포 경계

아래 항목은 요구사항에 맞게 반영됐다.

- 루트 `bin`에 `memento-continuity` 추가
- 루트 `build`에 workspace build 포함
- 루트 `type-check`에 workspace package 검사 포함
- 루트 `files`에 `packages/memento-assistant/dist` 포함
- `verify-bin`이 continuity CLI도 검증

검증 결과:

- `npm run build`: 통과
- `node scripts/verify-bin.js`: 통과
- `npm_config_cache=/tmp/npm-cache npm pack --dry-run`: continuity assistant dist 포함 확인

### 2.2 assistant package 경계

아래 항목도 닫혔다.

- `packages/memento-assistant/src/index.ts`에서 `AssistantClient`, `runCli`, 관련 타입 re-export
- `packages/memento-assistant/package.json`에 `zod` dependency 추가
- `packages/memento-assistant` 단독 `type-check` 통과

### 2.3 CLI 계약

아래 항목도 닫혔다.

- `continuity-cli.ts`에서 `process_id = options.process_id ?? options.process` 정규화
- CLI 스펙에 `--process`, `--process_id` 둘 다 검증 추가
- 가이드 문서에 alias 계약 반영

검증 결과:

- `npx vitest --run packages/memento-assistant/src/client/continuity-cli.spec.ts`: 통과

---

## 3. 남은 Findings

### 3.1 높음: assistant runtime이 core와 실제로 연결되지 않음

새로 추가된 runtime entry는 존재하지만, 현재 `createAssistantApp({})`로 앱을 띄우고 있어 `remember`와 `queryContinuityMemories`가 전혀 주입되지 않는다.

확인 근거:

- `packages/memento-assistant/src/server/run-assistant-server.ts`에서 `createAssistantApp({})` 호출
- `packages/memento-assistant/src/server/assistant-http-server.ts`에서 `queryContinuityMemories` 미주입 시 빈 배열 fallback
- 같은 파일에서 `remember`도 옵션 주입이 없으면 undefined
- `start_session`, `save_context`, `end_session`은 `context.remember`가 없으면 예외 발생
- `resume_session`은 query fallback 때문에 항상 빈 snapshot 반환 가능

영향:

- 문서의 “assistant가 core의 remember 계약을 호출해 저장한다”는 설명이 현재 runtime 구현과 다르다.
- `npm run dev:assistant` 또는 `npm run start:assistant`로 띄운 서버는 실제 continuity runtime으로는 동작하지 않는다.
- start/save/end는 실패하고, resume은 비어 있는 결과를 돌려주는 “껍데기 서버”가 될 수 있다.

관련 파일:

- `packages/memento-assistant/src/server/run-assistant-server.ts`
- `packages/memento-assistant/src/server/assistant-http-server.ts`
- `packages/memento-assistant/src/continuity/tools/start-session-tool.ts`
- `packages/memento-assistant/src/continuity/tools/save-context-tool.ts`
- `packages/memento-assistant/src/continuity/tools/end-session-tool.ts`
- `docs/guides/ko/developer-continuity-assistant-phase1.md`

### 3.2 중간: `memento-core` facade 공개 계약이 아직 충분하지 않음

`packages/memento-core/src/index.ts`는 더 이상 빈 엔트리는 아니지만, 현재 export가 `MemoryId` 하나뿐이다. 원 구현 계획은 assistant가 사용할 최소 공개 계약으로 공통 memory 타입, remember/recall 파라미터 타입, client/tool contract 수준의 facade를 요구했다.

영향:

- “assistant는 core public API만 사용한다”는 구조적 목표가 아직 선언적으로 닫히지 않는다.
- assistant runtime이 core와 연결될 때도, 공식 package surface 대신 ad-hoc wiring으로 흐를 가능성이 높다.

관련 파일:

- `packages/memento-core/src/index.ts`
- `docs/plans/ko/2026-02-28-memento-developer-continuity-assistant-implementation-plan.md`

---

## 4. 요구사항별 재판정

| 요구사항 | 현재 상태 | 판정 |
|---------|-----------|------|
| 루트 continuity CLI 배포 경계 | build/bin/files/pack 반영 | 충족 |
| workspace-aware type-check | root + workspaces 검사 | 충족 |
| assistant package root public API | root export 추가 | 충족 |
| assistant runtime dependency 자가 선언 | `zod` 추가 | 충족 |
| CLI `--process` / `--process_id` alias | 스펙 포함 정규화 | 충족 |
| assistant runtime 실행 엔트리포인트 존재 | entry/script 추가 | 부분 충족 |
| assistant runtime이 core remember/recall과 실제 연결 | 미주입 | 미충족 |
| core facade 최소 공개 계약 | `MemoryId`만 export | 미충족 |

---

## 5. 검증 결과

이번 재리뷰에서 확인한 명령은 아래와 같다.

```bash
npm run type-check
```

- 통과
- root와 두 workspace package type-check 모두 수행됨

```bash
npm run --workspace packages/memento-assistant type-check
```

- 통과

```bash
npm run build
```

- 통과
- `packages/memento-assistant/dist` 생성 확인

```bash
node scripts/verify-bin.js
```

- 통과
- `memento-continuity` 포함 모든 bin 검증 성공

```bash
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

- 통과
- tarball에 `packages/memento-assistant/dist/client/continuity-cli.js` 포함 확인

```bash
npx vitest --run \
  packages/memento-assistant/src/client/assistant-client.spec.ts \
  packages/memento-assistant/src/client/continuity-cli.spec.ts \
  packages/memento-assistant/src/continuity/tool-registry.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/resume-snapshot-service.spec.ts \
  packages/memento-assistant/src/continuity/services/__tests__/session-checkpoint-service.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/start-session-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/save-context-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts \
  packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts
```

- 통과

제약:

- `assistant-http-server.spec.ts`는 이 샌드박스의 소켓 listen 제한 때문에 재실행하지 않았다.
- 대신 정적 코드 확인으로 runtime wiring 공백을 검토했다.

---

## 6. 권장 후속 조치

1. `run-assistant-server.ts`에서 core remember/query 경로를 실제로 주입한다.
2. assistant runtime이 core HTTP API를 통해 동작할지, 별도 core client를 직접 주입할지 실행 구조를 먼저 확정한다.
3. `packages/memento-core/src/index.ts`에 Phase 1 facade 최소 공개 계약을 추가한다.
4. runtime wiring이 완료되면 start/save/end/resume의 실제 E2E를 다시 검증한다.

---

## 7. 결론

이번 수정으로 이전 리뷰의 다수 finding은 해결됐다. 그러나 아직 **assistant runtime이 실제로 쓸 수 있는 상태는 아니며**, **core facade도 문서가 의도한 수준까지는 닫히지 않았다**.

현재 판정은 다음과 같다.

- 배포/패키징/타입체크/CLI 계약: 대체로 충족
- runtime wiring / core public contract: 아직 미충족
