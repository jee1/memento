# 아키텍처

Memento는 **npm workspaces 모노레포**로 구성되어 있습니다. 도메인 로직·데이터베이스·MCP 도구는 `@memento/core`에 집중되고, `memento-server`가 stdio와 HTTP 두 경로로 외부에 노출합니다. 코드를 수정할 때는 "어느 패키지가 이 동작을 소유하는가"와 "의존성이 올바른 방향으로 흐르는가"를 먼저 확인하면 대부분의 혼선을 예방할 수 있습니다.

## 패키지 구성

이 절이 **패키지·워크스페이스 의존·MCP 도구 등록**의 문서 정본이다. 다른 아키텍처 문서(`docs/architecture/{ko,en}/`, arc42, c4)는 여기로 링크한다. 도구 이름·개수는 문서에 고정하지 않는다. 등록 목록은 `packages/memento-core/src/tools/index.ts`의 `coreTools`, 계약 스냅샷은 `toolset-surface.spec.ts`다.

루트 `package.json` workspaces는 `packages/` 다섯 개와 `apps/*`다.

| 경로 | npm name | 역할 |
|------|----------|------|
| `packages/memento-core` | `@memento/core` | 도메인·DB·MCP 도구 등록 |
| `packages/memento-server` | `memento-server` | MCP stdio + HTTP 관리 |
| `packages/memento-client` | `@jee1/memento-client` | 원격 클라이언트 |
| `packages/memento-assistant` | `@jee1/memento-assistant` | 어시스턴트 유틸 |
| `packages/memento-agent-integration` | `@memento/agent-integration` | 에이전트 훅·계약(private) |

`apps/experimental-example`은 `@memento/core`를 in-process로 쓴다. `apps/experimental-assistant-example`은 `@jee1/memento-assistant`를 쓴다. `apps/multi-agent-orchestration/`은 `package.json`이 없어 워크스페이스 멤버가 아니다. `plugins/memento/`(Claude Code 플러그인)·`services/agent/`(README·env 예시)는 workspaces 밖이다.

### 워크스페이스 의존 (package.json 기준)

```
@memento/core                    (memento-* 내부 의존 없음)
@memento/agent-integration       (memento-* 의존 없음)
@jee1/memento-client             (memento-* 의존 없음)
@jee1/memento-assistant        → @jee1/memento-client
memento-server                 → @memento/core, @memento/agent-integration
experimental-example           → @memento/core
experimental-assistant-example → @jee1/memento-assistant
```

`client`·`assistant`·`agent-integration`이 `core`에 의존한다고 쓰지 않는다.

### MCP 도구 등록

- 등록: `packages/memento-core/src/tools/index.ts`의 `coreTools` → `ToolRegistry`
- 기본 `tools/list`: `MEMENTO_TOOLSET=core`일 때 `CORE_TOOLSET` 4개만
- 계약 고정: `toolset-surface.spec.ts` 스냅샷 + `toolset.spec.ts` 등록 이름 목록
- 문서에 "N개 도구"를 적지 않는다. `performance_alerts` 모듈은 등록되지 않는다.

## 도메인 구조

`packages/memento-core/src/domains/` 아래 최상위는 `memory/`, `search/`, `embedding/`, `forgetting/`, `anchor/`, `relation/`, `monitoring/`, `consolidation/`, `telemetry/`, `personal-agent/`, `agent-integration/`이다. 절차 메모리 도구·서비스는 형제 도메인이 아니라 `memory/procedural/`에 있다. `embedding/`에는 TF-IDF·lightweight·MiniLM·OpenAI·Gemini가 있다. `monitoring/`의 `PerformanceMonitor`(`performance-monitor.ts`)는 types·CPU·알림·검색통계·DB·analytics 서브모듈(#594)로 나뉜다.

## Workspace 의존성 pin 정책

루트 `package.json`은 `@memento/core`·`@memento/agent-integration`을 의존성으로 **선언하지 않습니다**. 두 패키지는 registry 에 없는 비공개 워크스페이스라 이름이 발행 매니페스트에 남으면 소비자의 `npm audit signatures`가 404 로 실패합니다(#1038). 대신 `prepack`이 `dist/node_modules/@memento/*`로 복사해 tarball 에 싣고, 설치 후 `dist/server/*.js` 기준 상위 탐색으로 해석됩니다. `packages/memento-server`와 `apps/experimental-example`은 `"*"`로 선언해 모노레포 내부 개발 시 항상 로컬 workspace 빌드를 참조합니다.

`dependencies`에 `@memento/*`를 다시 넣지 마세요. `verify-pack-bundle`이 발행 매니페스트에서 그 이름을 발견하면 실패합니다.

## 개발 원칙

의존성은 `shared` ← `domains` ← `infrastructure` 방향으로만 흘러야 합니다. 이 경계를 지키면 도메인 로직이 인프라 세부에 오염되지 않습니다. 신규 금지 방향(domain→infra, shared→infra/server)과 확인된 runtime cycle은 `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`가 CI에서 막습니다(기존 위반은 allowlist+rationale로 freeze; allowlist 증가는 frozen size bump가 필요해 명시 리뷰를 강제). MCP 도구 핸들러는 자기 도메인 안에 둡니다(도메인 = 기능 단위). 핸들러 파일은 `tools/`·`adapters/` 디렉터리 아래에 두거나 이름을 `*-tool.ts`·`*-tool-*.ts` 로 짓고, `tools/types.js`(`ToolContext`)·`tools/base-tool.js`·`tools/caller-scope.js` 를 import 하는 곳은 이 핸들러 파일뿐입니다. 서비스·리포지토리 등 나머지 도메인 파일이 `tools/` 를 import 하면 같은 spec 이 막습니다(#1341). 전체 원칙은 [DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md)에서 다룹니다(**Functional Core, Structured Shell** 지침 참조).

## 변경 이력

기능·하드닝의 최신 목록은 루트 [CHANGELOG.md](../../CHANGELOG.md)와 [AGENTS.md](../../AGENTS.md) §3.1을 본다. 이 문서에 스펙 폴더 번호를 나열하지 않는다.
