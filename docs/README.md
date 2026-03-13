# Memento 문서 인덱스

`docs/` 하위 문서를 **용도·대상**별로 정리한 목차입니다. 모든 문서는 **언어별**로 `en/`, `ko/` 하위에 있습니다.

분류 체계: [docs-classification.md](docs-classification.md)

---

## 빠른 링크

| 문서 | KO | EN |
|------|----|----|
| DB 설계 명세 | [architecture/ko/database-design.md](architecture/ko/database-design.md) | [architecture/en/database-design.md](architecture/en/database-design.md) |
| 마이그레이션 가이드 | [guides/ko/migration-system-guide.md](guides/ko/migration-system-guide.md) | [guides/en/migration-system-guide.md](guides/en/migration-system-guide.md) |
| 사용자 매뉴얼 | [guides/ko/user-manual.md](guides/ko/user-manual.md) | [guides/en/user-manual.md](guides/en/user-manual.md) |
| 개발자 가이드 | [guides/ko/developer-guide.md](guides/ko/developer-guide.md) | [guides/en/developer-guide.md](guides/en/developer-guide.md) |
| Cursor/MCP 설정 | [guides/ko/cursor-mcp-setup.md](guides/ko/cursor-mcp-setup.md) | [guides/en/cursor-mcp-setup.md](guides/en/cursor-mcp-setup.md) |
| 보안 | [reference/ko/security.md](reference/ko/security.md) | [reference/en/security.md](reference/en/security.md) |

**루트 문서:** [README](../README.md), [README.en](../README.en.md). [GEMINI.md](../GEMINI.md) — Gemini 등 AI 컨텍스트용 프로젝트 요약(빌드·실행). [AGENTS.md](../AGENTS.md) — 모노레포 구조·빌드·테스트·DB 명령 상세. 상세는 README·가이드 참고.

**현재 구조:** 저장소는 npm workspaces 모노레포로, `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`가 구현되어 있습니다. 서버 진입점은 `packages/memento-server`(MCP/HTTP), DB·도메인 로직은 `packages/memento-core`에 있습니다.

---

## 1. 가이드 (guides/en, guides/ko)

### 공통 (EN/KO)
- Cursor MCP: [en](guides/en/cursor-mcp-setup.md) / [ko](guides/ko/cursor-mcp-setup.md)
- MCP serverUseInstructions (서버 사용 지침): [ko](guides/ko/mcp-server-instructions.md)
- **Memento CLI for AI**: [ko](guides/ko/memento-cli-for-ai.md) — recall, remember, forget, memory_injection, 설정(~/.memento, DB_PATH), 워크플로·예제.
- **SDD 워크플로**: [ko](guides/ko/sdd-workflow.md) — Specification-Driven Development: Design → SPEC → PLAN → 구현, 문서 위치·체크리스트.
- 관계 라벨링: [en](guides/en/relation-labeling-guide.md) / [ko](guides/ko/relation-labeling-guide.md)
- 앵커 연결 확인: [en](guides/en/how-to-check-anchor-connections.md) / [ko](guides/ko/how-to-check-anchor-connections.md)
- 멀티 에이전트: [en](guides/en/multi-agent-usage.md) / [ko](guides/ko/multi-agent-usage.md)
- Recall 성능 튜닝: [en](guides/en/recall-performance-tuning.md) / [ko](guides/ko/recall-performance-tuning.md)

### 한국어 (guides/ko/)
- 사용자 매뉴얼, 개발자 가이드, 임베딩 서비스·설정, LLM 제공자 설정, 마이그레이션 시스템, 레거시 스크립트 마이그레이션, 캐시 동기화 전략

### 영어 (guides/en/)
- User manual, Developer guide, LLM provider configuration, Migration system guide, Embedding service·configuration, Legacy scripts migration, Cache synchronization strategy

---

## 2. 아키텍처 (architecture/en, architecture/ko)

- DB 설계: [ko](architecture/ko/database-design.md) / [en](architecture/en/database-design.md)
- DB ERD: [ko](architecture/ko/database-erd.md) / [en](architecture/en/database-erd.md)
- 비동기 보강 파이프라인: [ko](architecture/ko/async-augmentation-pipeline.md) / [en](architecture/en/async-augmentation-pipeline.md)
- FTS5 무중단 마이그레이션: [ko](architecture/ko/zero-downtime-fts5-migration.md) / [en](architecture/en/zero-downtime-fts5-migration.md)
- 아키텍처 개요: [en](architecture/en/architecture.md) / [ko](architecture/ko/architecture.md)

---

## 3. API (api/en, api/ko)

- 관계 그래프 API: [ko](api/ko/relation-graph-api.md) / [en](api/en/relation-graph-api.md)
- 전체 API 레퍼런스: [en](api/en/api-reference.md) / [ko](api/ko/api-reference.md)
- 임베딩 API: [ko](api/ko/embedding-api-reference.md)

---

## 4. 계획·제안 (plans/ko, plans/en)

이슈별 설계·구현 계획. 주로 [plans/ko/](plans/ko/)에 있으며, [plans/en/README.md](plans/en/README.md)에서 안내.

- **모노레포·memento-core 분리**: [plans/ko/2026-03-04-monorepo-memento-core-implementation-plan.md](plans/ko/2026-03-04-monorepo-memento-core-implementation-plan.md) — 구현 계획. 설계·브레인스토밍: [brainstorms/2026-03-04-monorepo-memento-core-brainstorm.md](brainstorms/2026-03-04-monorepo-memento-core-brainstorm.md). 실험 앱 연결 방식(라이브러리 in-process vs 서버 원격)은 계획서·브레인스토밍 참고.
- [plans/ko/database-design-consolidation-proposal.md](plans/ko/database-design-consolidation-proposal.md) — DB 설계 통합 제안
- [plans/ko/2026-02-05-issue57-phase2-roadmap.md](plans/ko/2026-02-05-issue57-phase2-roadmap.md) — Phase2 로드맵
- [plans/ko/2026-03-03-repo-cleanup-design.md](plans/ko/2026-03-03-repo-cleanup-design.md) — 저장소 정리 설계 (불필요 파일·디렉토리, 단계별 정리)
- [plans/ko/2026-03-02-memento-growth-strategy-design.md](plans/ko/2026-03-02-memento-growth-strategy-design.md) — 성장 전략 설계 (Phase 0 성능 적정성 판단 + 마일스톤 결합)
- 기타: [plans/ko/](plans/ko/) 디렉터리 참고
- PRD·태스크 목록: 루트 [tasks/](../tasks/) ([tasks/README.md](../tasks/README.md) 참고)

### 명세·계획 (SDD) — 기능별 동일 경로

구현 명세(SPEC)와 구현 계획(PLAN)은 **기능마다 한 디렉터리**에 둔다: `plans/ko/YYYY-MM-DD-기능명/spec.md`, `implementation-plan.md` (선택: Structure.md, Tech.md, Product.md). Plan → Tasks → Implement 시 기준 문서로 사용. **SDD 절차**: [guides/ko/sdd-workflow.md](guides/ko/sdd-workflow.md).

- **Memento CLI for AI**: 기능별 디렉터리 [plans/ko/2026-03-11-memento-cli-for-ai/](plans/ko/2026-03-11-memento-cli-for-ai/) — [design.md](plans/ko/2026-03-11-memento-cli-for-ai/design.md), [spec.md](plans/ko/2026-03-11-memento-cli-for-ai/spec.md), [implementation-plan.md](plans/ko/2026-03-11-memento-cli-for-ai/implementation-plan.md), Memory Bank(Structure/Tech/Product). 이슈 [#110](https://github.com/jee1/memento/issues/110). *(신규 기능도 동일하게 기능별 디렉터리에 design + spec + plan 함께 둠.)*
- **현 상태 SDD 이관 검토**: [plans/ko/2026-03-14-sdd-current-state-migration-review.md](plans/ko/2026-03-14-sdd-current-state-migration-review.md) — 기존 문서 정리·신규 문서 생성 방안, 기능별 그룹핑·우선순위.

---

## 5.5. 해결 사례 (solutions/)

이슈 해결 과정·근본 원인·검증이 정리된 문서. 문제 유형별 하위 디렉터리.

- [integration-issues/mcp-log-duplicate-two-processes.md](solutions/integration-issues/mcp-log-duplicate-two-processes.md) — MCP 로그 두 번 출력 (두 프로세스 / Cursor UI)

---

## 6. 리뷰·검증 (reviews/ko, code_review/ko)

- 코드 리뷰: [code_review/ko/](code_review/ko/)
- 검증·테스트 보고: [reviews/ko/](reviews/ko/)
- [reviews/en/README.md](reviews/en/README.md), [code_review/en/README.md](code_review/en/README.md)

---

## 7. 테스트 (testing/ko, testing/en)

- Consolidation 품질 테스트: [ko](testing/ko/consolidation-quality-testing.md) / [testing/en/README.md](testing/en/README.md)

---

## 8. 운영·도구 (operations/en, operations/ko)

- GitHub 릴리스: [ko](operations/ko/github-release-workflow.md) / [en](operations/en/github-release-workflow.md)
- 스크립트 인덱스: [ko](operations/ko/scripts-index.md)
- 마이그레이션 상태 점검: [ko](operations/ko/check-migration-status.md) / [en](operations/en/check-migration-status.md)
- 트러블슈팅: [ko](operations/ko/troubleshooting-node-version.md) / [en](operations/en/troubleshooting-node-version.md), [ko](operations/ko/npx-troubleshooting.md) / [en](operations/en/npx-troubleshooting.md)
- npm unpublish: [ko](operations/ko/npm-unpublish-guide.md) / [en](operations/en/npm-unpublish-guide.md)

---

## 9. 참조 (reference/en, reference/ko)

- **코드베이스 분석**: [ko](reference/ko/codebase-analysis.md) — 전체 코드 구조·도메인·조건·데이터 흐름 정리
- **파일 위치·필요성 감사**: [ko](reference/ko/file-location-audit.md) — 파일별 위치 적합성·필요여부·개선 방안
- 로깅 스키마: [ko](reference/ko/logging-schema.md) / [en](reference/en/logging-schema.md)
- 보안: [ko](reference/ko/security.md) / [en](reference/en/security.md)
- 외부 API 호출: [ko](reference/ko/external-api-calls.md) / [en](reference/en/external-api-calls.md)
- 임베딩 제공자 이슈: [ko](reference/ko/embedding-provider-issues.md) / [en](reference/en/embedding-provider-issues.md)
- PRD·성능 테스트: [reference/ko/](reference/ko/)
- Memento 목표·마일스톤·M1 스펙, 검색 랭킹·감쇠 수식, 임베딩 벤치마크: [reference/en/](reference/en/), [reference/ko/](reference/ko/)

---

## 10. 리서치 (research/ko, research/en)

- Memento 기반 개인 비서(OpenClaw 유사) 기능·MVP 리서치: [ko](research/ko/memento-based-personal-assistant-mvp-research.md)

---

## 11. 블로그

- [blog/](blog/)

---

*모든 문서는 해당 카테고리의 `en/` 또는 `ko/` 하위에 두고, 필요 시 반대 언어 번역을 추가합니다.*
