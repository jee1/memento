# C4 Model — Memento 아키텍처 다이어그램

Memento를 [C4 Model](https://c4model.com/)로 표현한 다이어그램 모음입니다. Simon Brown의 4단계( Context → Container → Component → Code ) 중 **Level 1~3**까지를 다룹니다. 신규 기여자가 “시스템 전체 → 배포 단위 → Core 내부” 순으로 맥락을 잡을 때 이 문서를 시작점으로 쓰면 됩니다.

상세 도메인 설명·DB 스키마·비동기 파이프라인은 각각 [아키텍처 개요](../architecture.md), [database-design.md](../database-design.md), [async-augmentation-pipeline.md](../async-augmentation-pipeline.md)를 참조하세요. ARC42(제약·품질·ADR·리스크) 형식은 [ARC42 아키텍처 문서](../arc42.md)를 참조하세요.

## 다이어그램 목록

| Level | 문서 | 범위 |
|-------|------|------|
| 1 — System Context | [01-system-context.md](./01-system-context.md) | Memento와 외부 액터·시스템(MCP Host, Operator, SQLite, LLM API) |
| 2 — Container | [02-container.md](./02-container.md) | Stdio/HTTP 서버, Core Engine, Admin UI, SQLite |
| 3 — Component | [03-component-core.md](./03-component-core.md) | `@memento/core` 내부 도메인·ToolRegistry·BatchScheduler |

## C4 단계별로 무엇을 보나

**System Context**에서는 Memento Memory Server 하나를 중심에 두고, 누가·무엇이 이 시스템과 통신하는지만 그립니다. 패키지나 도메인 폴더는 여기서 다루지 않습니다.

**Container**에서는 실제로 띄우는 프로세스·앱 단위를 나눕니다. `npm run dev`(stdio MCP)와 `npm run dev:http`(HTTP MCP + Admin)가 서로 다른 컨테이너에 해당합니다.

**Component**에서는 `@memento/core` 라이브러리 안의 주요 컴포넌트(memory, search, embedding, BatchScheduler 등)와 의존 관계를 설명합니다.

**Code**(Level 4)는 이 문서 세트에 포함하지 않았습니다. 특정 도메인의 클래스·함수 수준이 필요하면 이슈나 PR에서 해당 도메인만 별도로 다룹니다.

## 다이어그램 렌더링

문서 안의 다이어그램은 [Mermaid](https://mermaid.js.org/) `C4Context` / `C4Container` / `C4Component` 문법을 사용합니다. GitHub, VS Code Mermaid 확장, Cursor 미리보기에서 렌더링할 수 있습니다.

## 관련 문서

- [아키텍처 개요](../architecture.md) — 패키지·도메인·MCP 도구 목록
- [비동기 Augmentation 파이프라인](../async-augmentation-pipeline.md) — `remember` 후 BatchScheduler 경로
- [database-design.md](../database-design.md) — SQLite 스키마 SSOT
- [docs/agents/architecture.md](../../../agents/architecture.md) — 에이전트용 패키지 요약

---

*Last updated: 2026-08-28*
