# 아키텍처

Memento는 **npm workspaces 모노레포**로 구성되어 있습니다. 도메인 로직·데이터베이스·MCP 도구는 `@memento/core`에 집중되고, `memento-server`가 stdio와 HTTP 두 경로로 외부에 노출합니다. 코드를 수정할 때는 "어느 패키지가 이 동작을 소유하는가"와 "의존성이 올바른 방향으로 흐르는가"를 먼저 확인하면 대부분의 혼선을 예방할 수 있습니다.

## 패키지 구성

저장소는 여섯 개의 패키지로 나뉩니다. `packages/memento-core`(`@memento/core`)가 핵심으로, 도메인 로직·DB·서비스를 모두 담당합니다. `packages/memento-server`는 MCP stdio와 HTTP 관리 서버를 제공하고, `packages/memento-client`(`@jee1/memento-client`)는 서버에 연결하는 클라이언트입니다. `packages/memento-assistant`(`@jee1/memento-assistant`)는 에이전트 어시스턴트 유틸리티를, `packages/memento-agent-integration`(`@memento/agent-integration`)은 에이전트 통합 계약과 어댑터를 담습니다(내부 전용, npm 미발행). `apps/experimental-example`은 core를 in-process로 사용하는 데모 앱입니다.

## 도메인 구조

`packages/memento-core/src/domains/` 아래 최상위는 `memory/`, `search/`, `embedding/`, `forgetting/`, `anchor/`, `relation/`, `monitoring/`, `consolidation/`, `telemetry/`, `personal-agent/`, `agent-integration/`이다. 절차 메모리 도구·서비스는 형제 도메인이 아니라 `memory/procedural/`에 있다. `embedding/`에는 TF-IDF·lightweight·MiniLM·OpenAI·Gemini가 있다. `monitoring/`의 `PerformanceMonitor`(`performance-monitor.ts`)는 types·CPU·알림·검색통계·DB·analytics 서브모듈(#594)로 나뉜다.

## Workspace 의존성 pin 정책

루트 `package.json`은 `@memento/core`·`@memento/agent-integration`을 의존성으로 **선언하지 않습니다**. 두 패키지는 registry 에 없는 비공개 워크스페이스라 이름이 발행 매니페스트에 남으면 소비자의 `npm audit signatures`가 404 로 실패합니다(#1038). 대신 `prepack`이 `dist/node_modules/@memento/*`로 복사해 tarball 에 싣고, 설치 후 `dist/server/*.js` 기준 상위 탐색으로 해석됩니다. `packages/memento-server`와 `apps/experimental-example`은 `"*"`로 선언해 모노레포 내부 개발 시 항상 로컬 workspace 빌드를 참조합니다.

`dependencies`에 `@memento/*`를 다시 넣지 마세요. `verify-pack-bundle`이 발행 매니페스트에서 그 이름을 발견하면 실패합니다.

## 개발 원칙

의존성은 `shared` ← `domains` ← `infrastructure` 방향으로만 흘러야 합니다. 이 경계를 지키면 도메인 로직이 인프라 세부에 오염되지 않습니다. 신규 금지 방향(domain→infra, shared→infra/server)과 확인된 runtime cycle은 `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`가 CI에서 막습니다(기존 위반은 allowlist+rationale로 freeze; allowlist 증가는 frozen size bump가 필요해 명시 리뷰를 강제). MCP 도구 핸들러는 자기 도메인 안에 둡니다(도메인 = 기능 단위). 핸들러 파일은 `tools/`·`adapters/` 디렉터리 아래에 두거나 이름을 `*-tool.ts`·`*-tool-*.ts` 로 짓고, `tools/types.js`(`ToolContext`)·`tools/base-tool.js`·`tools/caller-scope.js` 를 import 하는 곳은 이 핸들러 파일뿐입니다. 서비스·리포지토리 등 나머지 도메인 파일이 `tools/` 를 import 하면 같은 spec 이 막습니다(#1341). 전체 원칙은 [DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md)에서 다룹니다(**Functional Core, Structured Shell** 지침 참조).

## 변경 이력

기능·하드닝의 최신 목록은 루트 [CHANGELOG.md](../../CHANGELOG.md)와 [AGENTS.md](../../AGENTS.md) §3.1을 본다. 이 문서에 스펙 폴더 번호를 나열하지 않는다.
