# 아키텍처

Memento는 **npm workspaces 모노레포**로 구성되어 있습니다. 도메인 로직·데이터베이스·MCP 도구는 `@memento/core`에 집중되고, `memento-server`가 stdio와 HTTP 두 경로로 외부에 노출합니다. 코드를 수정할 때는 "어느 패키지가 이 동작을 소유하는가"와 "의존성이 올바른 방향으로 흐르는가"를 먼저 확인하면 대부분의 혼선을 예방할 수 있습니다.

## 패키지 구성

저장소는 여섯 개의 패키지로 나뉩니다. `packages/memento-core`(`@memento/core`)가 핵심으로, 도메인 로직·DB·서비스를 모두 담당합니다. `packages/memento-server`는 MCP stdio와 HTTP 관리 서버를 제공하고, `packages/memento-client`(`@memento/client`)는 서버에 연결하는 클라이언트입니다. `packages/memento-assistant`(`@memento/assistant`)는 에이전트 어시스턴트 유틸리티를, `packages/memento-agent-integration`(`@memento/agent-integration`)은 에이전트 통합 계약과 어댑터를 담습니다. `apps/experimental-example`은 core를 in-process로 사용하는 데모 앱입니다.

## 도메인 구조

`memento-core/src/domains/` 아래에 각 기능이 독립된 도메인으로 자리합니다. `memory/`가 remember·recall·pin·forget을 담당하고, `search/`가 FTS5와 벡터를 결합한 하이브리드 검색과 랭킹을 처리합니다. `embedding/`에는 TF-IDF·MiniLM·OpenAI·Gemini 네 종류의 임베딩 구현이 있고, `forgetting/`은 TTL과 데이터 정리를 맡습니다. `anchor/`는 슬롯 A/B/C로 나뉜 앵커 기반 검색을, `relation/`은 관계 추출과 시각화를 제공합니다. `procedural/`은 버전 관리가 있는 절차 메모리를 구현하고, `monitoring/services/`에는 `PerformanceMonitor`가 있습니다. PerformanceMonitor는 types·CPU·알림·검색통계·DB·analytics 서브모듈(#594)로 분해되어 있으며, `performance-monitor.ts`가 진입점입니다.

## Workspace 의존성 pin 정책

루트 `package.json`은 `@memento/core`를 exact 버전(`"1.17.0"`)과 `bundledDependencies`로 선언합니다. 이는 `npm pack`과 배포 시 workspace 패키지를 단일 tarball에 고정 번들하기 위해서입니다. `packages/memento-server`와 `apps/experimental-example`은 `"*"`로 선언해 모노레포 내부 개발 시 항상 로컬 workspace 빌드를 참조합니다. `_archived/*`는 아카이브 스냅샷 재현성을 위해 exact pin을 씁니다.

루트의 exact pin은 `^`나 `~`로 바꾸지 마세요. 버전 bump는 `@memento/core` 릴리스와 루트 `bundledDependencies`를 함께 갱신하는 별도 chore 커밋으로 처리합니다.

## 개발 원칙

의존성은 `shared` ← `domains` ← `infrastructure` 방향으로만 흘러야 합니다. 이 경계를 지키면 도메인 로직이 인프라 세부에 오염되지 않습니다. 전체 원칙은 [DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md)에서 다룹니다(**Functional Core, Structured Shell** 지침 참조).

## 최근 활성 기술

현재 진행 중이거나 최근 적용된 기술 영역은 다음과 같습니다. Docker DB 운영(`db:backup`, `db:pre-docker-deploy` 등)이 안정화되었고, 에피소딕 → 시맨틱 오프라인 증류(`005-sleep-consolidation`)와 Docker 보안 강화·Helmet.js(`011-docker-security-hardening`)가 적용되어 있습니다. 환경 설정 정리는 `016-env-config-cleanup`으로 진행되었습니다.
