# Developer Continuity Assistant Phase 1 요구사항 적합성 리뷰

**일자**: 2026-03-01  
**대상 브랜치**: `feature/developer-continuity-assistant-phase1`  
**검토 기준 문서**:
- `docs/plans/ko/2026-02-28-memento-developer-continuity-assistant-implementation-plan.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-design.md`
- `docs/plans/ko/2026-02-28-developer-continuity-assistant-phase1-hardening-implementation-plan.md`

---

## 1. 리뷰 요약

현재 브랜치에는 continuity metadata, resume snapshot service, continuity tools, assistant HTTP app, CLI, 가이드 문서까지 Phase 1의 기능 흐름이 대부분 구현되어 있다. assistant 전용 단위 스펙도 다수 통과하며, continuity 개념 자체는 코드로 연결되어 있다.

다만 요구사항 기준으로 보면 이번 구현은 아직 **문서대로 설치·배포·검증 가능한 상태**에 도달하지 못했다. 특히 hardening 설계가 닫으려 했던 배포 경계, package root public API, runtime dependency 선언, workspace-aware 품질 게이트, CLI 계약 정렬이 아직 완전히 반영되지 않았다.

결론적으로 현재 상태는 **저장소 내부 프로토타입 수준의 기능 연결은 되어 있으나, 요구사항 문서가 전제한 배포 가능 산출물과 품질 게이트는 미완성**이다.

---

## 2. 주요 Findings

### 2.1 높음: 루트 배포 경계가 continuity CLI를 실제로 배포하지 않음

hardening 설계는 루트 패키지가 사용자-facing distribution boundary가 되어 `memento-continuity` CLI와 assistant dist 산출물을 함께 배포해야 한다고 요구한다. 그러나 현재 루트 `package.json`은 continuity CLI를 `bin`에 등록하지 않았고, `build`도 assistant workspace 빌드를 포함하지 않으며, published `files`에도 assistant dist가 없다.

검증 근거:
- 루트 `bin`에 `memento-continuity` 항목 없음: `package.json`
- 루트 `build`가 `tsc && npm run copy:assets`만 수행: `package.json`
- 루트 `files`에 `packages/memento-assistant/dist` 미포함: `package.json`
- `npm_config_cache=/tmp/npm-cache npm pack --dry-run` 실행 결과 continuity assistant 관련 tarball 경로 미포함

영향:
- README/가이드가 설명하는 `memento-continuity` 설치·실행 경로가 실제 배포 산출물로 닫히지 않는다.
- continuity 기능이 루트 패키지의 공식 배포 표면에 올라오지 못한다.

관련 파일:
- `package.json`
- `README.md`
- `README.en.md`
- `packages/memento-assistant/package.json`

### 2.2 높음: package root public API 요구사항이 충족되지 않음

구현 계획과 hardening 설계는 `packages/memento-assistant/src/index.ts`가 `AssistantClient`, 관련 타입, `runCli`를 재export하고, `packages/memento-core/src/index.ts`도 최소 facade 공개 계약을 제공해야 한다고 명시한다. 하지만 현재 두 파일은 모두 `export {}`만 갖고 있어 package root가 사실상 비어 있다.

반면 실제 공개 API로 보이는 export는 `packages/memento-assistant/src/client/index.ts`에만 존재한다.

영향:
- `import { AssistantClient } from 'memento-assistant'` 같은 일반적인 소비 패턴이 성립하지 않는다.
- hardening 문서의 “assistant root export”와 “core facade entry” 요구사항이 미충족 상태다.

관련 파일:
- `packages/memento-assistant/src/index.ts`
- `packages/memento-assistant/src/client/index.ts`
- `packages/memento-core/src/index.ts`

### 2.3 높음: workspace 품질 게이트가 여전히 packages 코드를 보호하지 못함

hardening 설계는 루트 `type-check`가 root와 각 workspace package를 모두 검사하도록 바뀌어야 한다고 요구한다. 하지만 현재 루트 `type-check`는 `npm run validate:workspace && tsc --noEmit`만 수행하고, 루트 `tsconfig.json`의 `include`는 `src/**/*`로 제한되어 있어 `packages/memento-core`, `packages/memento-assistant`는 검사 범위 밖이다.

실제로 `npm run --workspace packages/memento-assistant type-check`를 별도로 실행하면 타입 오류가 발생한다.

확인된 오류:
- `src/server/assistant-http-server.ts(1,8)`: `express` default import requires `allowSyntheticDefaultImports`
- `src/server/assistant-http-server.ts(44,45)`: `req` implicit any
- `src/server/assistant-http-server.ts(44,50)`: `res` implicit any

영향:
- 루트 표준 게이트가 assistant workspace의 타입 문제를 놓친다.
- hardening 설계의 “root 명령 하나가 실제 배포 범위를 보호해야 한다”는 원칙을 충족하지 못한다.

관련 파일:
- `package.json`
- `tsconfig.json`
- `packages/memento-assistant/tsconfig.json`
- `packages/memento-assistant/src/server/assistant-http-server.ts`

### 2.4 높음: `memento-assistant`의 runtime dependency 선언이 불완전함

assistant package는 continuity tools에서 `zod`를 직접 import하지만, `packages/memento-assistant/package.json`에는 `zod` dependency가 없다. hardening 설계는 assistant package가 hoisting에 기대지 않고 자기 runtime dependency를 직접 선언해야 한다고 요구한다.

영향:
- assistant package를 독립 빌드하거나 별도 publish 대상으로 다룰 경우 런타임/모듈 해상도 오류가 날 수 있다.
- package boundary가 선언적으로 닫히지 않는다.

관련 파일:
- `packages/memento-assistant/package.json`
- `packages/memento-assistant/src/continuity/tools/base-tool.ts`
- `packages/memento-assistant/src/continuity/tools/start-session-tool.ts`
- `packages/memento-assistant/src/continuity/tools/save-context-tool.ts`
- `packages/memento-assistant/src/continuity/tools/end-session-tool.ts`
- `packages/memento-assistant/src/continuity/tools/resume-session-tool.ts`

### 2.5 중간: CLI 문서와 실제 옵션 파서 계약이 아직 어긋남

hardening 설계는 외부 표준 옵션을 `--process`로 두고, 구현에서는 `--process`와 `--process_id`를 모두 허용하는 alias 전략을 요구한다. 그러나 현재 CLI는 옵션을 단순 파싱한 뒤 모든 command payload에서 `options.process_id`만 사용한다.

문서 예시는 `--process`를 사용하고 있으므로, 현재 구현에서는 문서대로 입력해도 process 정보가 전달되지 않는다.

영향:
- process 기반 resume 필터링 및 checkpoint attribution이 조용히 빠질 수 있다.
- 문서와 CLI 사이의 계약 불일치가 그대로 남는다.

관련 파일:
- `docs/guides/ko/developer-continuity-assistant-phase1.md`
- `packages/memento-assistant/src/client/continuity-cli.ts`

### 2.6 중간: assistant runtime 실행 경계가 문서만 있고 실제 엔트리포인트가 없음

가이드는 “core HTTP 서버와 assistant 런타임이 기동된 상태”를 전제로 E2E를 안내한다. 하지만 현재 저장소에는 `createAssistantApp()` 팩토리만 있을 뿐, 이를 포트에 바인딩하는 assistant runtime entry 파일이나 실행 스크립트가 없다.

즉, 문서가 전제하는 “assistant 서버를 띄우는 표준 실행 경로”가 코드와 스크립트로 닫혀 있지 않다.

영향:
- E2E 가이드가 현재 저장소 상태만으로는 재현되지 않는다.
- assistant HTTP facade는 존재하지만 실제 제품 실행 경계는 미완성이다.

관련 파일:
- `docs/guides/ko/developer-continuity-assistant-phase1.md`
- `packages/memento-assistant/src/server/assistant-http-server.ts`
- `package.json`

---

## 3. 요구사항별 적합성 판단

| 요구사항 | 현재 상태 | 판단 |
|---------|-----------|------|
| continuity 서비스/도구 4종 구현 | `start_session`, `save_context`, `end_session`, `resume_session` 존재 | 부분 충족 |
| resume snapshot 4개 섹션 | `Resume`, `RecentDecisions`, `OpenThreads`, `NextActions` 반환 | 충족 |
| assistant package root public API | root entry가 `export {}` 상태 | 미충족 |
| core facade 공개 엔트리 | root entry가 `export {}` 상태 | 미충족 |
| assistant runtime dependency 자가 선언 | `zod` 누락 | 미충족 |
| CLI `--process` / `--process_id` alias | `process_id`만 사용 | 미충족 |
| 루트 build가 assistant 산출물 포함 | root build가 workspace build 미포함 | 미충족 |
| `npm pack --dry-run`에 continuity 산출물 포함 | 미포함 확인 | 미충족 |
| 루트 type-check가 workspace 전체 검사 | root `src/**/*`만 검사 | 미충족 |
| assistant runtime 실행 경계 제공 | app factory만 있고 서버 entry 없음 | 미충족 |

---

## 4. 검증 및 실행 결과

이번 리뷰에서 확인한 명령과 결과는 아래와 같다.

### 4.1 통과한 항목

```bash
npm run type-check
```

- 통과
- 단, 루트 `src/**/*`만 검사하므로 workspace 품질 게이트로는 불충분함

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
- continuity 기능 단위 수준의 기본 동작은 확인됨

### 4.2 실패하거나 한계가 확인된 항목

```bash
npm run --workspace packages/memento-assistant type-check
```

- 실패
- `assistant-http-server.ts`의 express import / handler parameter typing 문제 확인

```bash
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```

- 실행 성공
- 그러나 tarball에 continuity assistant 배포 산출물이 포함되지 않음

```bash
npx vitest --run packages/memento-assistant/src/server/assistant-http-server.spec.ts
```

- 이 샌드박스에서는 `listen EPERM`으로 완전 재현 불가
- 네트워크 listen 제한 때문에 테스트 자체가 환경 제약에 걸림
- 다만 이 환경 이슈와 별개로, 문서가 요구하는 assistant runtime entry 부재는 코드 레벨에서 별도로 확인됨

---

## 5. 권장 조치

1. 루트 배포 경계를 hardening 설계대로 복구한다.
   - root `bin`에 `memento-continuity` 추가
   - root `build`에 assistant workspace build 포함
   - root `files`에 assistant dist 포함

2. `packages/memento-assistant/src/index.ts`와 `packages/memento-core/src/index.ts`에 실제 public surface를 노출한다.
   - assistant: `AssistantClient`, 관련 타입, `runCli`
   - core: Phase 1 facade 범위의 최소 공개 계약

3. assistant package runtime dependency를 정리한다.
   - 최소 `zod`
   - 필요 시 `exports`, `types`, 실행 경로도 함께 정비

4. CLI 옵션 계약을 alias 방식으로 닫는다.
   - `process_id = options.process_id ?? options.process`
   - 문서 표준은 `--process`

5. 루트 품질 게이트를 workspace-aware 하게 바꾼다.
   - root `type-check`에서 각 workspace package `type-check` 포함
   - assistant package tsconfig와 Express typing도 함께 정리

6. assistant runtime 실행 엔트리포인트를 추가한다.
   - assistant app을 실제 포트로 expose하는 entry 파일 또는 npm script 필요

---

## 6. 결론

현재 구현은 Phase 1 기능 개념을 코드로 연결하는 데는 성공했지만, **요구사항 문서가 전제한 hardening 완료 상태에는 아직 도달하지 못했다**. 가장 큰 공백은 기능 로직 그 자체보다도, 배포 경계와 package 경계, 실행 경계, 품질 게이트의 정합성이다.

다음 단계의 우선순위는 새 기능 추가가 아니라 아래 네 가지를 닫는 것이다.

1. 루트 배포 경계 복구
2. assistant/core root public API 복구
3. workspace-aware type-check 및 dependency 정리
4. CLI 및 assistant runtime 실행 계약 정렬
