# 모노레포 + Memento(core) — SPEC 요약

SDD **Specify** 단계 사후 요약. 구현 완료 상태를 반영한 범위·요구사항·수용 기준 요약.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 모노레포 + Memento(core) 분리 |
| **문서 유형** | SPECIFY (요약 명세) |
| **날짜** | 2026-03-04 |
| **설계** | [design.md](./design.md) |
| **구현 계획** | [implementation-plan.md](./implementation-plan.md) |

---

## 1. 범위

- **In scope**: 루트 npm workspaces, packages/memento-core, memento-server, memento-client, apps/ 실험 서비스. core는 도메인·인프라·공유만, server는 core 소비(MCP/HTTP), client는 서버 연결. 서비스는 @memento/core(라이브러리) 또는 @memento/client(원격) 선택.
- **Out of scope**: MCP/HTTP 프로토콜 변경, 기존 bin 동작 변경.

---

## 2. 요구사항 요약 (REQ)

- **REQ-1** 루트 workspaces에 core, server, client, apps 예시 1개 포함.
- **REQ-2** memento-core는 domains + infrastructure + shared만, 라이브러리 진입점(createMementoCore 등)만 export.
- **REQ-3** memento-server는 @memento/core만 의존, 기존 MCP/HTTP bin 동작.
- **REQ-4** memento-client는 서버 연결 클라이언트, CI 빌드·테스트.
- **REQ-5** createMementoCore({ dbPath, config? }) API 존재·문서화.
- **REQ-6** 에셋(schema, migrations) 경로는 core 패키지 루트 기준.
- **REQ-7** 루트 npm run build 시 core → server → client 순서 보장.
- **REQ-8** apps/*는 @memento/core 또는 @memento/client만 의존, README에 연결 방식 명시.

---

## 3. 수용 기준 (AC)

- workspaces 정의, 3패키지 + apps 예시 포함.
- core에 MCP/HTTP/도구 레지스트리 코드 없음, 진입점만 export.
- server 기존 bin·도구 노출 동작.
- client 기능 유지, CI 빌드·테스트.
- core 라이브러리 사용 시 DB 경로·설정 주입 API 및 문서.
- 에셋 경로 core 기준, copy-assets·런타임 로딩 일치.
- 빌드 순서 보장, 예시 앱 README에 연결 방식 명시.

---

**다음 단계**: [implementation-plan.md](./implementation-plan.md), [phase3-thin-server-plan.md](./phase3-thin-server-plan.md)
