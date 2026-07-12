# Memento 문서 포털

Memento 문서는 **제품을 쓰는 사람**과 **제품을 만드는 사람**이 같은 저장소 안에서 길을 잃지 않도록 설계되어 있습니다. `docs/` 아래에는 설치부터 API, 배포까지 이어지는 **공식 문서**가 있고, 진행 중인 설계·리뷰·검증 기록은 **`_work/`** 에 모여 있습니다. 카테고리가 헷갈릴 때는 [docs-classification.md](docs-classification.md)를 보면, 각 폴더가 어떤 질문에 답하는지 정리되어 있습니다.

---

## Memento 사용하기

Memento를 처음 켜 보려면, 아래 **시작하기** 문서부터 읽는 것이 가장 빠릅니다. Cursor나 Claude Desktop에 MCP를 연결하고 싶다면 설정 가이드를, 터미널에서 `recall`/`remember`를 쓰고 싶다면 CLI 가이드를 따라가면 됩니다. API 스펙이나 보안 모델이 필요해지면 **연동·레퍼런스**로 넘어가고, 멀티 에이전트·검색 튜닝처럼 특정 과제가 생겼을 때 **How-to**를 골라 읽으면 됩니다.

저장소 루트의 [README.md](../README.md)와 [INSTALL.md](../INSTALL.md)는 제품 소개와 설치의 첫 관문입니다. AI 에이전트가 저장소 안에서 작업할 때는 [AGENTS.md](../AGENTS.md)와 [agents/](agents/README.md)가 상세 가이드 역할을 합니다.

### 시작하기

| 문서 | KO | EN |
|------|----|----|
| 사용자 매뉴얼 | [user-manual.md](guides/ko/user-manual.md) | [user-manual.md](guides/en/user-manual.md) |
| Cursor / MCP 설정 | [cursor-mcp-setup.md](guides/ko/cursor-mcp-setup.md) | [cursor-mcp-setup.md](guides/en/cursor-mcp-setup.md) |
| Memento CLI for AI | [memento-cli-for-ai.md](guides/ko/memento-cli-for-ai.md) | [memento-cli-for-ai.md](guides/en/memento-cli-for-ai.md) |
| type 파라미터 롤아웃 | [type-param-rollout.md](guides/ko/type-param-rollout.md) | [type-param-rollout.md](guides/en/type-param-rollout.md) |

### 연동·레퍼런스

Memento를 다른 앱이나 에이전트에 붙일 때는, **무엇을 호출할 수 있는지**와 **어떻게 보호되는지**를 함께 봐야 합니다. API 레퍼런스와 보안 문서가 그 역할을 합니다. OpenClaw 같은 외부 비서와 연동하려면 [integrations/README.md](integrations/README.md)가 출발점입니다.

| 문서 | KO | EN |
|------|----|----|
| 전체 API | [api-reference.md](api/ko/api-reference.md) | [api-reference.md](api/en/api-reference.md) |
| 임베딩 API | [embedding-api-reference.md](api/ko/embedding-api-reference.md) | — |
| 관계 그래프 API | [relation-graph-api.md](api/ko/relation-graph-api.md) | [relation-graph-api.md](api/en/relation-graph-api.md) |
| 관계 타입 표준 | [relation-type-vocabulary.md](reference/ko/relation-type-vocabulary.md) | - |
| 리소스 URI | [resource-uri.md](reference/ko/resource-uri.md) | - |
| 이벤트 Outbox | [event-outbox.md](reference/ko/event-outbox.md) | [event-outbox.md](reference/en/event-outbox.md) |
| 감사 해시 체인 | [audit-log.md](reference/ko/audit-log.md) | [audit-log.md](reference/en/audit-log.md) |
| 보안 | [security.md](reference/ko/security.md) | [security.md](reference/en/security.md) |
| 외부 비서 통합 | [integrations/README.md](integrations/README.md) | — |

### How-to

아래 문서들은 **특정 문제를 풀 때** 읽는 가이드입니다. 예를 들어 여러 에이전트가 하나의 DB를 공유해야 한다면 멀티 에이전트 가이드를, recall이 느리다면 성능 튜닝 가이드를 열면 됩니다.

| 주제 | KO | EN |
|------|----|----|
| 멀티 에이전트 | [multi-agent-usage.md](guides/ko/multi-agent-usage.md) | [multi-agent-usage.md](guides/en/multi-agent-usage.md) |
| 관계 라벨링 | [relation-labeling-guide.md](guides/ko/relation-labeling-guide.md) | [relation-labeling-guide.md](guides/en/relation-labeling-guide.md) |
| 앵커 연결 확인 | [how-to-check-anchor-connections.md](guides/ko/how-to-check-anchor-connections.md) | [how-to-check-anchor-connections.md](guides/en/how-to-check-anchor-connections.md) |
| Recall 성능 튜닝 | [recall-performance-tuning.md](guides/ko/recall-performance-tuning.md) | [recall-performance-tuning.md](guides/en/recall-performance-tuning.md) |
| 검색 품질 튜닝 | [search-quality-tuning.md](guides/ko/search-quality-tuning.md) | [search-quality-tuning.md](guides/en/search-quality-tuning.md) |
| 마이그레이션 시스템 | [migration-system-guide.md](guides/ko/migration-system-guide.md) | [migration-system-guide.md](guides/en/migration-system-guide.md) |
| MCP 서버 사용 지침 | [mcp-server-instructions.md](guides/ko/mcp-server-instructions.md) | [mcp-server-instructions.md](guides/en/mcp-server-instructions.md) |
| SDD 워크플로 | [sdd-workflow.md](guides/ko/sdd-workflow.md) | — |
| 개인 지식 에이전트 (CLI·HTTP) | [personal-knowledge-agent-mvp.md](guides/ko/personal-knowledge-agent-mvp.md) | [personal-knowledge-agent-mvp.md](guides/en/personal-knowledge-agent-mvp.md) |
| 기억 진화 데모 (시드·운영) | [evolution-demo.md](ko/evolution-demo.md) | — |

---

## Memento 개발·기여하기

코드를 수정하거나 PR을 올릴 때는, **환경을 맞추는 방법**과 **아키텍처를 이해하는 방법**이 순서대로 필요합니다. [developer-guide.md](guides/ko/developer-guide.md)가 그 흐름을 한 번에 설명하고, [AGENTS.md](../AGENTS.md)는 에이전트·기여자가 매일 참고하는 운영 메모에 가깝습니다.

### 개발자 온보딩

| 문서 | KO | EN |
|------|----|----|
| 개발자 가이드 | [developer-guide.md](guides/ko/developer-guide.md) | [developer-guide.md](guides/en/developer-guide.md) |
| DB 설계 명세 | [database-design.md](architecture/ko/database-design.md) | [database-design.md](architecture/en/database-design.md) |

임베딩 설정, 캐시 동기화, 레거시 스크립트처럼 주제가 더 넓어지면 [guides/ko/](guides/ko/) · [guides/en/](guides/en/) 전체를 탐색하면 됩니다.

### 아키텍처·설계

Memento가 **왜 이렇게 나뉘어 있는지**를 이해하려면 아키텍처 문서를 읽습니다. DB ERD와 비동기 보강 파이프라인, FTS5 마이그레이션 전략처럼 설계 결정이 드러나는 문서들이 여기에 모여 있습니다.

- DB ERD: [KO](architecture/ko/database-erd.md) / [EN](architecture/en/database-erd.md) (영문은 KO 링크 안내)
- 비동기 보강 파이프라인: [KO](architecture/ko/async-augmentation-pipeline.md) / [EN](architecture/en/async-augmentation-pipeline.md)
- FTS5 무중단 마이그레이션: [KO](architecture/ko/zero-downtime-fts5-migration.md) / [EN](architecture/en/zero-downtime-fts5-migration.md)
- 아키텍처 개요: [KO](architecture/ko/architecture.md) / [EN](architecture/en/architecture.md)
- 기억 구조화 문제 분석: [KO](architecture/ko/memory-structuring-problem-analysis.md)
- 대시보드 디자인 시스템: [DESIGN.md](DESIGN.md)
- 아키텍처 결정 기록(ADR): [adr/](adr/)

### 운영·도구

프로덕션에 올리거나 장애를 추적할 때는 **운영 문서**를 따릅니다. Docker 배포 전 DB 백업, 릴리스 절차, npx 트러블슈팅, 검토 큐 정리 같은 작업이 여기에 정리되어 있습니다.

| 문서 | KO | EN |
|------|----|----|
| 스크립트 인덱스 | [scripts-index.md](operations/ko/scripts-index.md) | — |
| GitHub 릴리스 | [github-release-workflow.md](operations/ko/github-release-workflow.md) | [github-release-workflow.md](operations/en/github-release-workflow.md) |
| 마이그레이션 상태 점검 | [check-migration-status.md](operations/ko/check-migration-status.md) | [check-migration-status.md](operations/en/check-migration-status.md) |
| 검토 큐 안전 정리 | [review-queue-cleanup.md](operations/ko/review-queue-cleanup.md) | [review-queue-cleanup.md](operations/en/review-queue-cleanup.md) |
| 문서 전수 검수 (worktree) | [doc-audit-workflow.md](operations/ko/doc-audit-workflow.md) | — |
| 배포 전 환경변수 점검 | [env-deployment-checklist.md](operations/env-deployment-checklist.md) | — |
| Docker 배포 절차 (DB 백업 포함) | [docker-deploy-procedure.md](operations/ko/docker-deploy-procedure.md) | — |
| 트러블슈팅 | [npx-troubleshooting.md](operations/ko/npx-troubleshooting.md) 등 | [operations/en/](operations/en/) |

### 참조 (reference)

로깅 형식, 보안 수칙, 마일스톤, 검색 수식처럼 **한 번 찾아두고 다시 보는** 자료는 [reference/ko/](reference/ko/) · [reference/en/](reference/en/)에 있습니다.

### 명세·태스크 (저장소 루트)

기능 단위 설계와 작업 목록은 루트 [specs/](../specs/)와 [tasks/](../tasks/)에 있습니다. Spec Kit으로 진행하는 이슈는 `specs/0NN-<slug>/` 패턴을 따릅니다.

### 블로그

비정기 회고와 공지는 [blog/](blog/)에 올라갑니다.

### 내부 작업 문서 (`docs/_work/`)

`_work/`는 **아직 제품 문서로 굳지 않은** 산출물의 보관함입니다. 이슈별 계획, 코드 리뷰 초안, 검증 보고, 품질 시나리오가 시간순으로 쌓입니다. 최종 사용자가 꼭 읽을 필요는 없지만, 기여자와 에이전트가 맥락을 이어 붙일 때 자주 참조합니다.

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

공식 문서는 `guides/`, `architecture/`, `api/`, `operations/`, `reference/` 아래 **언어별 `ko/`·`en/`** 폴더를 기본으로 합니다. `_work/`는 작업 문서라 경로마다 언어 배치가 다를 수 있습니다. 새 문서를 쓸 때는 [docs-classification.md](docs-classification.md)의 **네러티브 문체** 지침을 따르는 것을 권장합니다.
