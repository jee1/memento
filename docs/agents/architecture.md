# 아키텍처

루트는 npm workspaces 기반 모노레포입니다.

## 패키지 구성

| 패키지 | 역할 |
|--------|------|
| `packages/memento-core` (`@memento/core`) | 도메인 로직, DB, 서비스 |
| `packages/memento-server` | MCP stdio·HTTP 관리 서버 |
| `packages/memento-client` (`@memento/client`) | 서버 연결 클라이언트 |
| `packages/memento-assistant` (`@memento/assistant`) | 에이전트 어시스턴트 유틸리티 |
| `packages/memento-agent-integration` (`@memento/agent-integration`) | 에이전트 통합 계약·어댑터 |
| `apps/experimental-example` | core in-process 데모 |

## 도메인 구조 (`memento-core/src/domains/`)

| 경로 | 역할 |
|------|------|
| `memory/` | remember, recall, pin, forget |
| `search/` | 하이브리드 검색·랭킹 |
| `embedding/` | TF-IDF, MiniLM, OpenAI, Gemini |
| `forgetting/` | TTL·데이터 정리 |
| `anchor/` | 앵커 슬롯(A/B/C) 검색 |
| `relation/` | 관계 추출·시각화 |
| `procedural/` | 버전 관리 절차 메모리 |
| `monitoring/services/` | `PerformanceMonitor` — types·CPU·알림·검색통계·DB·analytics sub-module (#594); 진입점 `performance-monitor.ts` |

## Workspace 의존성 pin 정책

| 위치 | `@memento/core` 선언 | 이유 |
|------|---------------------|------|
| 루트 `package.json` | exact `"1.17.0"` + `bundledDependencies` | npm pack/배포 시 workspace 패키지를 단일 tarball에 고정 번들 |
| `packages/memento-server`, `apps/experimental-example` | `"*"` | monorepo 내부 개발 시 항상 로컬 workspace 빌드 사용 |
| `_archived/*` | exact pin | 아카이브 스냅샷 재현성 |

루트 exact pin은 `^`/`~`로 바꾸지 않는다. 버전 bump는 `@memento/core` 릴리스와 루트 `bundledDependencies`를 함께 갱신하는 별도 chore로 처리한다.

## 개발 원칙

- **Functional Core, Structured Shell**
- **의존성 방향**: `shared` ← `domains` ← `infrastructure`
- 상세: [DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md)

## 최근 활성 기술

- Docker DB 운영 (`db:backup`, `db:pre-docker-deploy` 등)
- 에피소딕 → 시맨틱 오프라인 증류 (`005-sleep-consolidation`)
- Docker 보안 강화·Helmet.js (`011-docker-security-hardening`)
- 환경 설정 정리 (`016-env-config-cleanup`)
