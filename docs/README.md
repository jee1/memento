# Memento 문서 포털

`docs/`는 **공식 문서**(사용자·개발자·운영)와 **내부 작업 문서**(`_work/`)로 나뉩니다. 분류 체계는 [docs-classification.md](docs-classification.md)를 참고하세요.

---

## Memento 사용하기

MCP·CLI·대시보드를 **설치·연동·운영**할 때 필요한 문서입니다.

### 시작하기

| 문서 | KO | EN |
|------|----|----|
| 사용자 매뉴얼 | [user-manual.md](guides/ko/user-manual.md) | [user-manual.md](guides/en/user-manual.md) |
| Cursor / MCP 설정 | [cursor-mcp-setup.md](guides/ko/cursor-mcp-setup.md) | [cursor-mcp-setup.md](guides/en/cursor-mcp-setup.md) |
| Memento CLI for AI | [memento-cli-for-ai.md](guides/ko/memento-cli-for-ai.md) | — |

- **저장소 루트**: [README.md](../README.md), [README.en.md](../README.en.md), [GEMINI.md](../GEMINI.md), [AGENTS.md](../AGENTS.md)

### 연동·레퍼런스

| 문서 | KO | EN |
|------|----|----|
| 전체 API | [api-reference.md](api/ko/api-reference.md) | [api-reference.md](api/en/api-reference.md) |
| 임베딩 API | [embedding-api-reference.md](api/ko/embedding-api-reference.md) | — |
| 관계 그래프 API | [relation-graph-api.md](api/ko/relation-graph-api.md) | [relation-graph-api.md](api/en/relation-graph-api.md) |
| 보안 | [security.md](reference/ko/security.md) | [security.md](reference/en/security.md) |
| 외부 비서 통합 | [integrations/README.md](integrations/README.md) | — |

### How-to

| 주제 | KO | EN |
|------|----|----|
| 멀티 에이전트 | [multi-agent-usage.md](guides/ko/multi-agent-usage.md) | [multi-agent-usage.md](guides/en/multi-agent-usage.md) |
| 관계 라벨링 | [relation-labeling-guide.md](guides/ko/relation-labeling-guide.md) | [relation-labeling-guide.md](guides/en/relation-labeling-guide.md) |
| 앵커 연결 확인 | [how-to-check-anchor-connections.md](guides/ko/how-to-check-anchor-connections.md) | [how-to-check-anchor-connections.md](guides/en/how-to-check-anchor-connections.md) |
| Recall 성능 튜닝 | [recall-performance-tuning.md](guides/ko/recall-performance-tuning.md) | [recall-performance-tuning.md](guides/en/recall-performance-tuning.md) |
| 마이그레이션 시스템 | [migration-system-guide.md](guides/ko/migration-system-guide.md) | [migration-system-guide.md](guides/en/migration-system-guide.md) |
| MCP 서버 사용 지침 | [mcp-server-instructions.md](guides/ko/mcp-server-instructions.md) | — |
| SDD 워크플로 | [sdd-workflow.md](guides/ko/sdd-workflow.md) | — |
| 기억 진화 데모 (시드·운영) | [evolution-demo.md](ko/evolution-demo.md) | — |

---

## Memento 개발·기여하기

코어·서버·클라이언트를 **빌드·수정·배포**할 때 쓰는 공식 문서입니다.

### 개발자 온보딩

| 문서 | KO | EN |
|------|----|----|
| 개발자 가이드 | [developer-guide.md](guides/ko/developer-guide.md) | [developer-guide.md](guides/en/developer-guide.md) |
| DB 설계 명세 | [database-design.md](architecture/ko/database-design.md) | [database-design.md](architecture/en/database-design.md) |

- **저장소 가이드**: [AGENTS.md](../AGENTS.md) — 워크스페이스, 빌드·테스트·DB 명령
- **기타 가이드**: 임베딩 서비스·설정, 레거시 스크립트, 캐시 동기화 등은 [guides/ko/](guides/ko/) · [guides/en/](guides/en/)

### 아키텍처·설계

- DB ERD: [KO](architecture/ko/database-erd.md) / [EN](architecture/en/database-erd.md) (영문은 KO 링크 안내)
- 비동기 보강 파이프라인: [KO](architecture/ko/async-augmentation-pipeline.md) / [EN](architecture/en/async-augmentation-pipeline.md)
- FTS5 무중단 마이그레이션: [KO](architecture/ko/zero-downtime-fts5-migration.md) / [EN](architecture/en/zero-downtime-fts5-migration.md)
- 아키텍처 개요: [KO](architecture/ko/architecture.md) / [EN](architecture/en/architecture.md)
- 기억 구조화 문제 분석: [KO](architecture/ko/memory-structuring-problem-analysis.md)
- 대시보드 디자인 시스템: [DESIGN.md](DESIGN.md)
- 아키텍처 결정 기록(ADR): [adr/](adr/)

### 운영·도구

| 문서 | KO | EN |
|------|----|----|
| 스크립트 인덱스 | [scripts-index.md](operations/ko/scripts-index.md) | — |
| GitHub 릴리스 | [github-release-workflow.md](operations/ko/github-release-workflow.md) | [github-release-workflow.md](operations/en/github-release-workflow.md) |
| 마이그레이션 상태 점검 | [check-migration-status.md](operations/ko/check-migration-status.md) | [check-migration-status.md](operations/en/check-migration-status.md) |
| 검토 큐 안전 정리 | [review-queue-cleanup.md](operations/ko/review-queue-cleanup.md) | [review-queue-cleanup.md](operations/en/review-queue-cleanup.md) |
| 문서 전수 검수 (worktree) | [doc-audit-workflow.md](operations/ko/doc-audit-workflow.md) | — |
| 배포 전 환경변수 점검 | [env-deployment-checklist.md](operations/env-deployment-checklist.md) | — |
| 트러블슈팅 | [npx-troubleshooting.md](operations/ko/npx-troubleshooting.md) 등 | [operations/en/](operations/en/) |

### 참조 (reference)

- 코드베이스 분석·로깅·외부 API·마일스톤·수식 등: [reference/ko/](reference/ko/) · [reference/en/](reference/en/)

### 명세·태스크 (저장소 루트)

- [specs/](../specs/) — 기능별 명세(Spec Kit 등)
- [tasks/](../tasks/) — PRD·작업 목록 ([tasks/README.md](../tasks/README.md))

### 블로그

- [blog/](blog/)

### 내부 작업 문서 (`docs/_work/`)

계획·설계 초안·코드 리뷰·검증 보고·품질 시나리오 등 **기여·자동화 작업용** 산출물입니다. 최종 사용자가 반드시 읽을 필요는 없습니다.

| 경로 | 설명 |
|------|------|
| [_work/plans/](_work/plans/) | 이슈별 design / spec / implementation-plan, 로드맵, 제안 |
| [_work/design/](_work/design/) | 설계·리뷰 초안 |
| [_work/brainstorms/](_work/brainstorms/) | 브레인스토밍 |
| [_work/code_review/](_work/code_review/) | 사전 코드 리뷰·리뷰 요청 |
| [_work/reviews/](_work/reviews/) | 단계별 검증·테스트 보고 |
| [_work/testing/](_work/testing/) | consolidation·검색 품질 등 작업용 테스트 가이드 |
| [_work/research/](_work/research/) | 리서치 노트 |
| [_work/solutions/](_work/solutions/) | 이슈 해결 사례 |
| [_work/issues/](_work/issues/) | 이슈 메모·기능 제안 |

- Plans 영문 안내: [_work/plans/en/README.md](_work/plans/en/README.md)

---

*공식 문서는 `guides/`, `architecture/`, `api/`, `operations/`, `reference/` 등에서 언어별 `ko/`·`en/` 하위를 기본으로 합니다. `_work/`는 작업 문서이며 하위에 `ko/`·`en/`가 혼재할 수 있습니다.*
