# Developer Continuity Assistant Phase 1 Hardening 설계

**일자**: 2026-02-28  
**상태**: 구현 완료  
**목적**: [코드 리뷰 문서](../../code_review/ko/2026-02-28-developer-continuity-assistant-phase1-code-review.md)에서 지적된 배포·패키징·품질 게이트 문제를 정리하고, Phase 1 구현을 실제 설치/실행 가능한 상태로 hardening 한다.

---

## 1. 목표와 배포 원칙

이번 후속 작업의 목표는 새 기능 추가가 아니라, Phase 1 구현을 `저장소 내부 프로토타입` 상태에서 `문서대로 설치하고 실행 가능한 상태`로 끌어올리는 것이다. 따라서 설계의 중심축은 제품 비전 확장이 아니라 아래 계약을 닫는 데 있다.

- 배포 산출물에 continuity CLI가 실제 포함되는가
- `memento-assistant` package root가 public API를 제공하는가
- assistant 패키지가 runtime dependency를 스스로 선언하는가
- CLI 문서와 옵션 파서가 같은 계약을 쓰는가
- 루트 품질 게이트가 workspace 전체를 실제로 보호하는가

배포 전략은 `과도기 하이브리드형`으로 둔다.

- 단기적으로는 루트 `memento` 패키지가 `memento-continuity` CLI를 실제 배포한다.
- 동시에 `packages/memento-assistant`는 독립 패키지 경계를 유지하고, public API와 runtime dependency를 스스로 닫는다.
- 즉, `지금 당장 사용자 경험 복구`와 `장기 독립 배포 가능성 유지`를 함께 달성한다.

우선순위는 아래 순서로 둔다.

1. 배포 산출물 포함
2. assistant root export
3. runtime dependency 정리
4. workspace-aware 품질 게이트
5. CLI 문서/옵션 계약 정렬

---

## 2. 변경 범위와 책임 분리

이번 hardening은 continuity 기능 내부 로직을 크게 바꾸는 작업이 아니다. 이미 구현된 `continuity tools`, `AssistantClient`, `assistant HTTP server`, `resume snapshot` 흐름은 유지하고, 그 위의 배포/패키징/검증 경계를 정렬한다.

책임은 네 층으로 나눈다.

### 2.1 루트 배포 경계

루트 `package.json`과 루트 빌드 체계는 사용자-facing distribution boundary를 맡는다.

- `memento-continuity` CLI를 루트 `bin`에 포함한다.
- 루트 `build`는 assistant 산출물까지 생성하도록 확장한다.
- 루트 `files`는 `packages/memento-assistant/dist` 디렉터리를 포함하고, `npm pack` 시 그 하위 continuity 실행 파일이 tarball에 함께 포함되게 한다.
- 루트 publish 전 검증은 continuity bin 존재 여부까지 확인한다.

### 2.2 assistant 제품 경계

`packages/memento-assistant`는 continuity 기능의 product boundary를 맡는다.

- package root에서 `AssistantClient`, 관련 타입, CLI 진입점인 `runCli`를 재export한다.
- 런타임 의존성은 hoisting에 기대지 않고 자기 `package.json`에 직접 선언한다.
- 장기적으로는 별도 publishable package가 될 수 있어야 하지만, 이번 단계에서는 루트 배포에 의해 사용자 경험이 닫혀도 괜찮다.

### 2.3 문서와 CLI 계약

외부 사용자 계약과 내부 파라미터 명명은 분리해 다룬다.

- 외부 표준 옵션은 `--process`를 사용한다.
- 내부 필드는 기존 `process_id`를 유지할 수 있다.
- 구현은 `--process`와 `--process_id`를 모두 허용하는 alias 방식으로 둔다.
- 문서는 하나의 표준 표기만 사용한다.

### 2.4 품질 게이트

루트 `type-check`와 build 게이트는 workspace 전체를 기본 검사 단위로 삼아야 한다.

- 루트 `validate:workspace`는 workspace 구조 존재 여부를 검사한다.
- 루트 `type-check`는 루트와 각 workspace package를 모두 검사한다.
- 루트 `build`는 publish 경계에서 필요한 assistant 산출물 생성 여부를 포함해 검증한다.

---

## 3. 접근 방식 대안과 권장안

### 3.1 루트 우선 복구안

루트 `package.json`만 중심으로 손봐서 continuity CLI를 tarball에 포함시키는 방법이다.

- 장점: 가장 빠르게 설치/실행 실패를 막는다.
- 단점: `memento-assistant`의 root export와 runtime dependency 문제를 충분히 해결하지 못한다.

### 3.2 assistant 독립 완성안

`packages/memento-assistant`를 사실상 독립 배포 가능한 수준까지 완성하는 방법이다.

- 장점: 구조적으로 가장 깨끗하다.
- 단점: README, 배포 문서, npm publish 전략까지 함께 재설계해야 해서 범위가 커진다.

### 3.3 하이브리드 hardening 안

루트에서 continuity CLI를 실제 배포하면서, 동시에 assistant package 자체의 경계도 정리하는 방법이다.

- 장점: 리뷰에서 지적된 배포 실패를 가장 실용적으로 닫는다.
- 장점: 장기적으로 assistant 독립 배포 전환도 방해하지 않는다.
- 단점: 루트 배포 경계와 assistant 제품 경계가 잠시 공존하는 과도기 구조를 문서화해야 한다.

### 권장안

권장안은 `하이브리드 hardening 안`이다.

- 리뷰의 가장 치명적인 문제는 `문서대로 설치해도 안 된다`는 점이다.
- 이 문제는 루트 배포 경계에서 먼저 닫아야 한다.
- 그러나 assistant package를 계속 빈 entry 상태로 두면 같은 문제가 반복된다.
- 따라서 `루트에서 사용자 경험 복구`, `assistant에서 패키지 독립성 강화`를 동시에 수행하는 편이 가장 현실적이다.

---

## 4. 세부 설계

### 4.1 배포 경계

루트 패키지는 Phase 1 continuity 기능의 공식 배포 경계로 유지한다.

필수 조건:

- 루트 `bin`에 `memento-continuity`를 추가한다.
- 루트 `build`는 assistant build를 포함한다.
- 루트 `files`는 `packages/memento-assistant/dist`를 포함하고, `npm pack` 시 `packages/memento-assistant/dist/client/continuity-cli.js` 같은 하위 실행 경로가 tarball에 함께 들어가게 한다.
- 루트 publish 검증은 continuity bin과 그 대상 파일이 실제 존재하는지 확인한다.

여기서 핵심은 루트가 assistant 코드를 흡수하는 것이 아니라, distribution boundary 역할만 맡는다는 점이다.

### 4.2 assistant 공개 엔트리포인트

`packages/memento-assistant/src/index.ts`는 빈 entry가 아니라 최소 public surface를 제공해야 한다.

재export 대상:

- `AssistantClient`
- continuity 관련 public 타입
- `runCli`

목표는 `import { AssistantClient } from 'memento-assistant'` 같은 일반적인 소비 패턴을 정상화하는 것이다.

### 4.3 런타임 의존성

assistant 패키지는 자기 소스가 직접 import하는 런타임 의존성을 자기 `package.json`에 선언해야 한다.

- 최소 `zod`
- assistant runtime에서 직접 쓰는 `express` 유지
- 필요 시 이후 `imports -> dependency` 기준으로 추가 점검

원칙은 단순하다.

`assistant source가 직접 import하고, 빌드 산출물 실행에 필요한 것은 assistant package가 직접 선언한다.`

### 4.4 CLI 계약

CLI는 사용자 편의와 내부 정합성을 동시에 만족시키는 alias 전략을 사용한다.

- 외부 표준 옵션: `--process`
- 내부 필드: `process_id`
- 구현: `--process`, `--process_id` 모두 허용
- 문서 표준: `--process`

이 방식은 기존 문서 예시를 살리면서도, 서버·도메인 내부 snake_case 계약을 무리하게 바꾸지 않는다.

### 4.5 품질 게이트

루트 품질 게이트는 workspace-aware 하게 재정렬한다.

- 루트 `validate:workspace`는 구조 검증에 집중한다.
- 루트 `type-check`는 루트와 각 workspace package의 `type-check`를 모두 실행한다.
- 필요하면 루트 `build`도 assistant build를 포함해 publish 전 실제 산출물 생성을 보장한다.

목표는 `루트 명령 하나가 실제 사용자 배포 범위를 보호하는 상태`를 만드는 것이다.

---

## 5. 오류 처리, 검증 전략, 비목표

### 5.1 오류 처리 원칙

이번 hardening의 실패 전략은 런타임 복구보다 `계약 위반 조기 검출`에 둔다.

- continuity CLI가 tarball에 빠지면 publish 전 검증에서 실패해야 한다.
- assistant root export가 비어 있거나 dependency가 누락되면 workspace type-check/build 단계에서 드러나야 한다.
- CLI 문서와 구현이 어긋나면 스펙 테스트로 고정해 조용한 동작 차이를 막아야 한다.

### 5.2 검증 전략

최소 검증 항목은 아래 다섯 가지다.

1. 루트 build 후 continuity CLI 엔트리가 실제 생성되는가
2. `npm pack --dry-run` 결과에 continuity 관련 산출물이 포함되는가
3. `memento-assistant` package root import가 정상 동작하는가
4. CLI가 `--process`와 `--process_id`를 모두 허용하는가
5. 루트 `type-check`가 workspace 전체를 실제로 검사하는가

이 검증들은 모두 코드 리뷰에서 이미 한 번 깨진 지점을 회귀 방지 대상으로 삼는다.

| 검증 항목 | 대응 코드 리뷰 finding |
|-----------|------------------------|
| 루트 build 후 continuity CLI 엔트리 생성 확인 | 2.1 높음: continuity 기능이 실제 배포 산출물에 포함되지 않음 |
| `npm pack --dry-run`에 continuity 산출물 포함 확인 | 2.1 높음: continuity 기능이 실제 배포 산출물에 포함되지 않음 |
| `memento-assistant` package root import 확인 | 2.2 높음: `memento-assistant` 패키지 루트 엔트리포인트가 비어 있음 |
| CLI alias(`--process`, `--process_id`) 확인 | 2.4 중간: CLI 문서와 실제 옵션 파서가 불일치함 |
| 루트 `type-check`의 workspace 검사 확인 | 2.5 중간: 기본 `type-check` 게이트가 새 workspace 코드를 실제로 검사하지 않음 |

런타임 dependency 누락(finding 2.3)은 package-level type-check, assistant build, assistant 회귀 스위트 통과 조건으로 함께 검증한다.

### 5.3 비목표

이번 작업은 아래 범위를 포함하지 않는다.

- `memento-assistant`의 완전 독립 npm 배포 체계 마무리
- continuity UX 자체의 재설계
- IDE 패널, snapshot ranking, memory orchestration 로직 확장
- 새로운 assistant 기능 추가

목표는 오직 현재 Phase 1 구현이 문서, 패키지, 빌드, 게이트 기준으로 일관되게 동작하도록 hardening 하는 것이다.

---

## 6. 구현 결과 (2026-03)

코드 리뷰 finding 대비 닫힌 항목:

| Finding | 대응 변경 |
|---------|-----------|
| 2.1 높음: continuity가 배포 산출물에 포함되지 않음 | 루트 `bin`에 `memento-continuity`, `build`에 assistant workspace 빌드, `files`에 `packages/memento-assistant/dist`. `verify-bin`으로 continuity bin 검증. |
| 2.2 높음: assistant 루트 엔트리포인트 비어 있음 | `packages/memento-assistant/src/index.ts`에서 `AssistantClient`, `runCli` 및 관련 타입 재export. |
| 2.3 높음: assistant 런타임 의존성 불완전 | `packages/memento-assistant/package.json`에 `zod` 의존성 추가. |
| 2.4 중간: CLI 문서와 옵션 파서 불일치 | `process_id = options.process_id ?? options.process` 정규화, 문서에 `--process` 표준 및 `--process_id` 별칭 명시. |
| 2.5 중간: type-check가 workspace 미검사 | 루트 `type-check`에 `npm run --workspace packages/memento-core type-check && npm run --workspace packages/memento-assistant type-check` 추가. |

검증 명령: `npm run build`, `npm run type-check`, `node scripts/verify-bin.js`, `npm pack --dry-run`, assistant Vitest 회귀 스위트 11파일 14테스트 통과.

---

## 7. 참고 문서

- [Phase 1 코드 리뷰](../../code_review/ko/2026-02-28-developer-continuity-assistant-phase1-code-review.md)
- [기존 Phase 1 설계](./2026-02-28-memento-developer-continuity-assistant-design.md)
- [기존 Phase 1 구현 계획](./2026-02-28-memento-developer-continuity-assistant-implementation-plan.md)
