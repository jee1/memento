# Developer Continuity Assistant Phase 1 개선 체크리스트

**일자**: 2026-03-01  
**목적**: 요구사항 적합성 리뷰에서 확인된 미충족 항목을, 바로 실행 가능한 체크리스트로 정리한다.  
**기준 문서**:
- `docs/code_review/ko/2026-02-28-developer-continuity-assistant-phase1-code-review.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-design.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md`

---

## 1. 사용 방법

- 이 문서는 구현 계획서의 대체물이 아니라, 리뷰 finding을 닫기 위한 작업 추적 문서다.
- 각 항목은 `미완료`, `진행 중`, `완료` 중 하나로 상태를 갱신한다.
- 항목을 완료 처리하기 전에 반드시 해당 섹션의 검증 명령을 실행한다.
- 구현이 문서와 달라졌다면, 코드만 수정하지 말고 관련 설계/가이드 문서도 함께 정리한다.

권장 상태 표기 예시:

```md
- 상태: 미완료
```

---

## 2. 우선순위 요약

| 우선순위 | 항목 | 이유 |
|---------|------|------|
| P0 | 루트 배포 경계 복구 | 설치/배포 가능한 continuity CLI가 아직 없음 |
| P0 | workspace-aware 품질 게이트 복구 | 현재 루트 `type-check`가 packages 오류를 놓침 |
| P1 | assistant/core package root public API 복구 | 문서가 전제한 package 소비 경계가 비어 있음 |
| P1 | assistant runtime dependency 정리 | 독립 package 경계가 선언적으로 닫히지 않음 |
| P1 | CLI 옵션 계약 정렬 | 문서와 구현이 서로 다른 파라미터 이름을 사용 |
| P2 | assistant runtime 실행 엔트리포인트 추가 | E2E 가이드 재현성과 실행 경계 명확화 필요 |

---

## 3. 상세 체크리스트

### 3.1 루트 배포 경계 복구

- 상태: 완료
- 대응 finding: `2.1 높음: 루트 배포 경계가 continuity CLI를 실제로 배포하지 않음`

해야 할 일:
- 루트 `package.json`의 `bin`에 `memento-continuity`를 추가한다.
- 루트 `build`가 assistant workspace 산출물까지 생성하도록 조정한다.
- 루트 `files`에 assistant dist 경로를 포함시킨다.
- `scripts/verify-bin.js`가 continuity CLI 대상 파일도 검증하도록 보강한다.

완료 조건:
- `npm run build` 후 continuity CLI 대상 파일이 실제로 생성된다.
- `npm pack --dry-run` 결과에 continuity CLI 산출물 경로가 포함된다.
- 루트 publish 경계만으로 continuity CLI가 배포 가능하다.

검증 명령:

```bash
npm run build
node scripts/verify-bin.js
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

영향 파일:
- `package.json`
- `scripts/verify-bin.js`
- 필요 시 assistant build/output 관련 파일

메모:
- hardening 설계의 핵심은 “루트가 distribution boundary를 맡는다”는 점이다.
- assistant package를 루트에 흡수하는 방향으로 가면 안 된다.

### 3.2 workspace-aware 품질 게이트 복구

- 상태: 완료
- 대응 finding: `2.3 높음: workspace 품질 게이트가 여전히 packages 코드를 보호하지 못함`

해야 할 일:
- 루트 `type-check`에 workspace package type-check를 포함시킨다.
- assistant package type-check가 실패하는 원인을 먼저 제거한다.
- 필요하면 root `build`도 workspace-aware 하게 맞춘다.

완료 조건:
- 루트 `npm run type-check` 한 번으로 root와 각 workspace package가 모두 검사된다.
- `packages/memento-assistant` 단독 type-check가 통과한다.
- 루트 게이트와 package-level 게이트가 서로 다른 결과를 내지 않는다.

검증 명령:

```bash
npm run type-check
npm run --workspace packages/memento-core type-check
npm run --workspace packages/memento-assistant type-check
```

영향 파일:
- `package.json`
- `tsconfig.json`
- `packages/memento-core/package.json`
- `packages/memento-assistant/package.json`
- `packages/memento-assistant/tsconfig.json`
- `packages/memento-assistant/src/server/assistant-http-server.ts`

메모:
- 현재 확인된 assistant type-check 오류는 Express import 방식과 handler parameter typing이다.

### 3.3 assistant package root public API 복구

- 상태: 완료
- 대응 finding: `2.2 높음: package root public API 요구사항이 충족되지 않음`

해야 할 일:
- `packages/memento-assistant/src/index.ts`에서 `AssistantClient`, 관련 타입, `runCli`를 재export한다.
- 필요하면 assistant package `exports`/`types` metadata도 정리한다.

완료 조건:
- package root import가 실제로 의미 있는 public surface를 제공한다.
- 문서에서 설명한 package 소비 방식과 코드 구조가 일치한다.

검증 명령:

```bash
npm run --workspace packages/memento-assistant type-check
npx vitest --run packages/memento-assistant/src/client/assistant-client.spec.ts
```

영향 파일:
- `packages/memento-assistant/src/index.ts`
- `packages/memento-assistant/src/client/index.ts`
- `packages/memento-assistant/package.json`

메모:
- 현재 `client/index.ts`에만 API가 있고 package root는 비어 있다.

### 3.4 core facade 공개 엔트리 정리

- 상태: 완료
- 대응 finding: `2.2 높음: package root public API 요구사항이 충족되지 않음`

해야 할 일:
- `packages/memento-core/src/index.ts`가 Phase 1 facade 수준의 최소 공개 계약을 제공하도록 정리한다.
- assistant가 실제로 사용할 타입/계약만 노출하고, root `src/` 내부 구현 세부사항을 직접 참조하는 구조는 피한다.

완료 조건:
- core package root가 빈 entry가 아니다.
- hardening 문서의 “assistant는 core public API만 사용” 원칙과 문서 구조가 맞아떨어진다.

검증 명령:

```bash
npm run --workspace packages/memento-core type-check
npm run type-check
```

영향 파일:
- `packages/memento-core/src/index.ts`
- 필요 시 관련 타입 export 정리 파일

메모:
- 이번 단계는 full migration이 아니라 facade 정리 단계다.
- 재리뷰 결과 현재 `packages/memento-core/src/index.ts`는 `MemoryId`만 export하고 있어, original implementation plan이 요구한 최소 facade 계약 수준에는 아직 미달한다.

### 3.5 assistant runtime dependency 정리

- 상태: 완료
- 대응 finding: `2.4 높음: memento-assistant의 runtime dependency 선언이 불완전함`

해야 할 일:
- assistant source가 직접 import하는 runtime dependency를 전수 점검한다.
- 최소 `zod`를 `packages/memento-assistant/package.json`에 추가한다.
- hoisting에 우연히 기대는 dependency가 없는지 확인한다.

완료 조건:
- assistant package가 자기 runtime dependency를 명시적으로 선언한다.
- assistant package type-check/build가 root hoisting 가정 없이 통과한다.

검증 명령:

```bash
npm run --workspace packages/memento-assistant type-check
npm run build
```

영향 파일:
- `packages/memento-assistant/package.json`
- `packages/memento-assistant/src/continuity/tools/base-tool.ts`
- `packages/memento-assistant/src/continuity/tools/start-session-tool.ts`
- `packages/memento-assistant/src/continuity/tools/save-context-tool.ts`
- `packages/memento-assistant/src/continuity/tools/end-session-tool.ts`
- `packages/memento-assistant/src/continuity/tools/resume-session-tool.ts`

메모:
- 현재 확인된 직접 import 누락은 `zod`다.

### 3.6 CLI 옵션 계약 정렬

- 상태: 완료
- 대응 finding: `2.5 중간: CLI 문서와 실제 옵션 파서 계약이 아직 어긋남`

해야 할 일:
- CLI에서 `--process`와 `--process_id`를 모두 허용하도록 alias 정규화를 추가한다.
- 문서 표준을 `--process`로 유지하고, 필요하면 하위 호환 별칭을 설명한다.
- 관련 스펙을 추가해 회귀를 막는다.

완료 조건:
- 문서 예시 그대로 실행해도 `process_id`가 정상 전달된다.
- `--process`와 `--process_id` 모두 동일한 payload로 정규화된다.

검증 명령:

```bash
npx vitest --run packages/memento-assistant/src/client/continuity-cli.spec.ts
```

영향 파일:
- `packages/memento-assistant/src/client/continuity-cli.ts`
- `packages/memento-assistant/src/client/continuity-cli.spec.ts`
- `docs/guides/ko/developer-continuity-assistant-phase1.md`

메모:
- 권장 정규화 규칙: `process_id = options.process_id ?? options.process`

### 3.7 assistant runtime 실행 엔트리포인트 추가

- 상태: 완료
- 대응 finding: `2.6 중간: assistant runtime 실행 경계가 문서만 있고 실제 엔트리포인트가 없음`

해야 할 일:
- `createAssistantApp()`를 실제 포트로 expose하는 runtime entry 파일을 추가한다.
- assistant runtime 실행용 npm script를 정의한다.
- 가이드 문서의 실행 예시를 실제 엔트리포인트 기준으로 맞춘다.

완료 조건:
- “assistant 런타임을 어떻게 띄우는가”에 대한 단일 표준 실행 경로가 존재한다.
- E2E 가이드가 현재 저장소 상태만으로 재현 가능하다.

검증 명령:

```bash
npm run type-check
npx vitest --run packages/memento-assistant/src/server/assistant-http-server.spec.ts
```

추가 수동 검증:
- assistant runtime을 실제로 기동한다.
- `POST /assistant/tools/resume_session` 호출이 동작하는지 확인한다.

영향 파일:
- `packages/memento-assistant/src/server/assistant-http-server.ts`
- assistant runtime entry 파일
- `package.json`
- `docs/guides/ko/developer-continuity-assistant-phase1.md`

메모:
- 샌드박스에서는 소켓 listen 제약이 있을 수 있으므로, 로컬 환경 검증이 별도로 필요하다.
- 재리뷰 결과 runtime entry는 추가됐지만 `createAssistantApp({})`로 기동되어 core `remember` / `queryContinuityMemories` 주입이 빠져 있다. 현재 상태는 “기동 가능”이지 “문서대로 동작 가능”은 아니다.

---

### 3.8 strict branch-safe resume 계약

- 상태: 완료
- 목적: `resume_session --branch`가 branch metadata 없는 continuity 기록을 포함하지 않도록 계약을 닫고, 저장·조회 경로가 동일한 branch-safe 규칙을 따르게 한다.

완료 조건:
- `end_session`도 `origin_source.branch`를 저장한다.
- `branch` 지정 resume는 branchless item을 포함하지 않는다 (strict filtering).
- E2E는 다른 branch continuity가 현재 snapshot에 섞이지 않음을 검증한다.

검증 명령:

```bash
npx vitest --run packages/memento-assistant/src/continuity/tools/__tests__/end-session-tool.spec.ts packages/memento-assistant/src/client/continuity-cli.spec.ts packages/memento-assistant/src/server/runtime-core-bridge.spec.ts
MEMENTO_CORE_URL=http://localhost:3000 MEMENTO_ASSISTANT_URL=http://localhost:8090 tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

영향 파일:
- `packages/memento-assistant/src/client/assistant-client.ts`
- `packages/memento-assistant/src/client/continuity-cli.ts`
- `packages/memento-assistant/src/continuity/tools/end-session-tool.ts`
- `packages/memento-assistant/src/server/runtime-core-bridge.ts`
- `packages/memento-assistant/src/test/test-developer-continuity-flow.ts`
- `docs/guides/ko/developer-continuity-assistant-phase1.md`

---

## 4. 마감 기준

아래 항목이 모두 만족되면 이번 hardening 체크리스트를 닫을 수 있다.

- 루트 `npm run build`가 assistant continuity 산출물을 포함해 성공한다.
- 루트 `npm run type-check`가 workspace 전체를 실제로 검사한다.
- `npm pack --dry-run` 결과에 continuity CLI 산출물이 포함된다.
- assistant package root와 core package root가 비어 있지 않다.
- assistant package runtime dependency가 자기 선언으로 닫혀 있다.
- CLI가 `--process`와 `--process_id`를 모두 허용한다.
- assistant runtime의 표준 실행 경로가 문서와 코드에 함께 존재한다.
- strict branch-safe: `end_session`이 `origin_source.branch`를 저장하고, `branch` 지정 resume는 branchless item을 포함하지 않으며, E2E가 다른 branch continuity가 현재 snapshot에 섞이지 않음을 검증한다.

---

## 5. 권장 작업 순서

1. `3.1 루트 배포 경계 복구`
2. `3.2 workspace-aware 품질 게이트 복구`
3. `3.3 assistant package root public API 복구`
4. `3.4 core facade 공개 엔트리 정리`
5. `3.5 assistant runtime dependency 정리`
6. `3.6 CLI 옵션 계약 정렬`
7. `3.7 assistant runtime 실행 엔트리포인트 추가`
8. `3.8 strict branch-safe resume 계약`

---

## 6. 진행 기록

- 2026-03-01: 초안 작성
- 2026-03-01: 3.1~3.7 구현 완료. 검증: build, verify-bin, pack --dry-run, type-check, continuity-cli.spec, assistant-http-server.spec 통과. 체크리스트 항목 모두 완료 처리.
- 2026-03-01: branch-aware resume 구현 완료. core facade에 recall metadata(include_metadata, origin_source) 노출, assistant runtime bridge에서 branch 기준 후처리 필터링, 가이드·E2E·체크리스트 정렬. 검증: `npm run type-check`, `npx vitest --run packages/memento-core/src/http-tool-client.spec.ts packages/memento-assistant/src/server/runtime-core-bridge.spec.ts packages/memento-assistant/src/continuity/services/__tests__/continuity-metadata.spec.ts packages/memento-assistant/src/continuity/tools/__tests__/resume-session-tool.spec.ts`, E2E `tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts`.
- 다음 업데이트 시 각 항목 상태와 검증 결과를 함께 기록할 것
