---
date: 2026-03-04
topic: monorepo-memento-core
---

# 모노레포 + Memento(core) + 실험 서비스 브레인스토밍

## What We're Building

- **모노레포**로 전환하고, 현재 프로젝트를 **memento(core)** 로 둔다.
- Memento를 쓰는 **여러 실험용 서비스**를 같은 레포에서 관리한다.
- **격리**: Memento와 서비스는 명확히 분리되고, 서비스는 서로 의존하지 않는다.
- **사용 방식**: 서비스는 Memento를 **라이브러리(in-process)** 또는 **독립 서버(원격)** 중에서 선택해 사용할 수 있어야 한다.
- **성공 기준**: 실험 속도(빠른 추가/제거, 코어 수정 반영) + 배포 경계(나중에 npm 등으로 분리 배포 가능).
- **격리 수준**: 의존 방향 명확(서비스 → @memento/* 만) + 서비스별 독립 빌드/실행.

## Key Decisions (from dialogue)

| 결정 | 선택 |
|------|------|
| 서비스가 Memento를 쓰는 형태 | **(c) 둘 다** — 라이브러리와 독립 서버 모두 지원 |
| 성공 기준 | **(c) 둘 다** — 빠른 실험 + 배포/경계 명확 |
| 격리 수준 | **(c) 둘 다** — 패키지 의존 격리 + 서비스 단위 빌드/실행 독립 |

## Library vs Server 사용 권장

- **라이브러리(in-process)**  
  - 코어를 직접 `import` 해서 같은 프로세스에서 recall/remember 등 호출.  
  - **장점**: 지연 낮음, 단일 DB, 배포 단순.  
  - **적합**: 스크립트, CLI, 단일 에이전트 서비스, 프로토타입.

- **독립 서버(원격)**  
  - `memento-server`를 별도 프로세스로 띄우고, 서비스는 `@memento/client`로 HTTP/MCP 접속.  
  - **장점**: 한 Memento 인스턴스를 여러 에이전트/서비스가 공유 가능.  
  - **적합**: 다중 에이전트, 다중 서비스가 같은 기억 풀을 쓰는 실험.

- **둘 다 지원하는 방법**  
  - **core**가 프로그램 API(함수/클래스)만 노출.  
  - **server**는 core를 소비하는 “한 가지 애플리케이션”(MCP/HTTP).  
  - 서비스는 용도에 따라 `@memento/core` 직접 의존(라이브러리) 또는 `@memento/client`로 서버 연결(원격).

## 실험 서비스별 Memento 연결 방식

실험 서비스 유형에 따라 Memento와 어떻게 연결할지 정리한다. 서비스는 **한 가지 연결 방식**만 쓰거나, 필요 시 **동일 서비스 내에서 둘 다** 조합할 수 있다(예: 설정에 따라 in-process vs remote 전환).

| 서비스 유형 | 연결 방식 | 의존 패키지 | 연결 형태 요약 |
|-------------|-----------|-------------|----------------|
| **CLI / 스크립트** | 라이브러리(in-process) | `@memento/core` | 같은 프로세스에서 core API 직접 호출. DB 경로는 환경 변수 또는 인자로 전달. |
| **단일 에이전트 백엔드** (한 프로세스가 기억 담당) | 라이브러리(in-process) | `@memento/core` | 서비스가 core를 초기화해 recall/remember 등 호출. 서비스 전용 DB 또는 공유 DB 경로 설정. |
| **다중 에이전트 / 다중 서비스** (여러 프로세스가 한 기억 풀 공유) | 독립 서버(원격) | `@memento/client` | `memento-server`를 별도로 띄우고, 각 서비스·에이전트는 client로 HTTP/MCP 접속. |
| **MCP 클라이언트가 있는 환경** (Cursor, Claude 등) | 독립 서버(원격) | (에디터/클라이언트가 Memento MCP 연결) | 서버만 실행. 실험 서비스는 "Memento를 쓰는 다른 앱"으로, 서버와 동일 네트워크에서 client로 접속하거나, MCP를 쓰는 에이전트와 기억 풀 공유. |
| **하이브리드** (일부는 in-process, 일부는 원격) | 둘 다 | `@memento/core` + `@memento/client` | 예: 로컬 스크립트는 core, 웹/다른 언어 서비스는 client. 또는 서비스 내에서 "로컬 캐시용 core + 원격 공유용 client" 조합. |

- **문서화 규칙(권장)**: 각 실험 서비스(`apps/*`)의 README 또는 `docs/`에 다음을 명시한다.  
  - 이 서비스가 **어떤 연결 방식**을 쓰는지(라이브러리 vs 서버).  
  - 사용하는 패키지(`@memento/core` vs `@memento/client`).  
  - 필요한 환경(DB 경로, 서버 URL, MCP 설정 등).  
  - (선택) 다이어그램: 서비스 프로세스 ↔ Memento(core 또는 server) 관계.

이렇게 하면 새 실험 서비스를 추가할 때 "이건 core 직접" vs "이건 server + client"를 문서만 보고 결정할 수 있다.

## Approach A: 3패키지 분리 (core / server / client)

- **packages/memento-core**  
  - `domains` + `infrastructure` + `shared`.  
  - 라이브러리 진입점만 export (예: `recall`, `remember`, 검색/앵커 등).  
  - MCP/HTTP/도구 레지스트리 없음.

- **packages/memento-server**  
  - `memento-core` 의존.  
  - `server/` + `tools/`, 기존 bin(MCP stdio/HTTP) 유지.

- **packages/memento-client**  
  - 기존 `packages/mcp-client` 유지. 서버에 연결하는 클라이언트.

- **apps/**  
  - `apps/experimental-service-a`, `apps/experimental-service-b` 등.  
  - 각 서비스는 `@memento/core`(in-process) 또는 `@memento/client`(remote) 중 선택.

**Pros:** 경계가 가장 명확. core/server/client 역할 분리, 나중에 npm 배포 시 core·server 각각 배포 용이.  
**Cons:** core 분리(진입점 정의, 의존성 정리) 작업량이 있음.

**Best when:** 배포/경계와 장기 구조를 우선하고, 1–2주 정도 리팩터링을 감수할 수 있을 때.

---

## Approach B: 2패키지 + subpath exports (memento 하나가 core+server)

- **packages/memento**  
  - 현재 코드를 그대로 옮기되, **subpath exports**로:  
    - `memento/core` → 도메인/인프라 API(라이브러리용).  
    - `memento/server` 또는 기본 진입점 → 기존 서버 bin.  
  - 한 패키지가 “라이브러리 + 서버” 이중 역할.

- **packages/memento-client**  
  - 기존 유지.

- **apps/**  
  - 실험 서비스. workspace에서 `memento` 의존.  
  - in-process면 `import ... from 'memento/core'`, remote면 서버 띄우고 client 사용.

**Pros:** 리팩터링 최소. 모노레포와 사용 방식(라이브러리/서버)만 먼저 확립 가능.  
**Cons:** core와 server가 한 패키지라, 나중에 core만 npm 배포하려면 그때 분리 작업 필요.

**Best when:** 빠르게 실험 구조를 만들고, “진짜로 core 단독 배포”는 필요해질 때 분리하는 전략.

---

## Why This Approach

**선택: Approach A (3패키지 분리)**

- **경계 명확**: core는 프로토콜/전송과 무관한 API만 노출하고, server는 그 코어를 소비하는 한 애플리케이션. 라이브러리·서버·클라이언트 역할이 분리되어 실험 서비스가 "in-process vs remote"를 선택하기 쉬움.
- **배포·경계 우선**: 나중에 `@memento/core`, `memento-server`를 npm 등으로 각각 배포해도 패키지 경계가 이미 정리되어 있음. 서비스는 core 또는 client만 의존하면 됨.
- **격리 요구 충족**: packages/memento-core, memento-server, memento-client + apps/* 구조로 의존 방향이 명확하고, 워크스페이스·빌드 설정으로 서비스 단위 독립 빌드/실행 가능.

## Resolved Questions

- 접근 방식: A (3패키지) 선택.

## Open Questions

- 패키지 매니저/워크스페이스: npm workspaces vs pnpm vs Turborepo 등 선호 여부.
- 첫 번째 실험 서비스 예시(한 가지만 정해도 됨): 예) “CLI에서 core 직접 호출” vs “별도 노드 서버가 client로 Memento 서버 연결”.

## Next Steps

→ **구현 계획**: [implementation-plan.md](./implementation-plan.md) — Phase 1(워크스페이스)부터 순서대로 진행.
