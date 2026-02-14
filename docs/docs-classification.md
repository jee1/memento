# docs 분류 체계

**하는 일**: `docs/` 하위 문서의 카테고리 정의와 찾아보기 가이드.  
**연관**: [docs/README.md](README.md)(전체 인덱스), AGENTS.md(저장소 가이드).

---

## 1. 분류 원칙

- **대상·용도 기준**: 누가/무엇을 위해 보는 문서인지로 상위 구분.
- **언어**: 모든 문서는 해당 카테고리의 **`en/`** 또는 **`ko/`** 하위에 둔다. 단일 언어 문서는 가능한 한 반대 언어 번역을 추가한다.
- **Diataxis 참고**: 튜토리얼·How-to·Reference·Discussion을 의도에 맞게 배치.

---

## 2. 카테고리 정의

| 카테고리 | 설명 | 예시 경로/파일 |
|----------|------|----------------|
| **가이드 (guides)** | 사용자·개발자 입문·설정·운영 방법 | `guides/`(공통 + `guides/en/`, `guides/ko/` 언어별) — user-manual, developer-guide, migration-system-guide, cursor-mcp-setup 등 |
| **아키텍처 (architecture)** | 설계·ERD·파이프라인·마이그레이션 전략 | `architecture/` (database-design, database-erd, async-augmentation-pipeline, zero-downtime-fts5-migration), `architecture/en/`, `architecture/ko/` (언어별 아키텍처 개요) |
| **API** | API 스펙·레퍼런스 | `api/`, `api/en/`, `api/ko/` (api-reference, embedding-api-reference) |
| **계획·제안 (plans)** | 이슈별 설계·구현 계획·로드맵·체크리스트 | `plans/` (날짜-이슈-제목 형식, database-design-consolidation-proposal 등) |
| **리뷰·검증 (reviews)** | 코드 리뷰 요청/보고, 단계별 검증·테스트 보고 | `code_review/`, `reviews/` (phase*-verification, anchor-map-*-test-report, code-review-*, tdd-audit-report 등) |
| **운영·도구 (operations)** | 릴리스·트러블슈팅·마이그레이션 점검·npm 등 | `operations/` (github-release-workflow, check-migration-status, troubleshooting-node-version, npx-troubleshooting, npm-unpublish-guide) |
| **참조 (reference)** | 로깅·보안·외부 API·수식·마일스톤 등 | `reference/` (logging-schema, security, external-api-calls 등), `reference/en/`, `reference/ko/` (Search-Ranking-Memory-Decay-Formulas, Memento-Goals, Memento-Milestones, Memento-M1-DetailSpecs, embedding-performance-benchmark) |
| **테스트 (testing)** | 테스트 전략·품질 시나리오 | `testing/` (consolidation-quality-testing 등) |
| **블로그 (blog)** | 비정기 게시·회고 | `blog/` |

---

## 3. 디렉터리 → 카테고리 매핑

모든 문서는 **카테고리/en/** 또는 **카테고리/ko/** 하위에 둔다.

| 디렉터리 | 카테고리 | 비고 |
|----------|----------|------|
| `docs/architecture/en/`, `docs/architecture/ko/` | 아키텍처 | 설계·ERD·파이프라인·개요 |
| `docs/api/en/`, `docs/api/ko/` | API | API 스펙·레퍼런스 |
| `docs/plans/en/`, `docs/plans/ko/` | 계획·제안 | 이슈별 설계·구현 계획 (주로 ko) |
| `docs/code_review/en/`, `docs/code_review/ko/` | 리뷰·검증 | 코드 리뷰 요청/의견 |
| `docs/reviews/en/`, `docs/reviews/ko/` | 리뷰·검증 | 검증·테스트 보고 |
| `docs/testing/en/`, `docs/testing/ko/` | 테스트 | 테스트 전략·품질 시나리오 |
| `docs/guides/en/`, `docs/guides/ko/` | 가이드 | 사용자·개발자·설정·마이그레이션 가이드 |
| `docs/operations/en/`, `docs/operations/ko/` | 운영·도구 | 릴리스·트러블슈팅·점검 |
| `docs/reference/en/`, `docs/reference/ko/` | 참조 | 로깅·보안·외부 API·수식·마일스톤 |
| `docs/blog/` | 블로그 | 비정기 게시·회고 |

---

## 4. 찾아보기

- **전체 목차**: [docs/README.md](README.md)
- **DB·마이그레이션**: [architecture/ko/database-design.md](architecture/ko/database-design.md) / [en](architecture/en/database-design.md), [guides/ko/migration-system-guide.md](guides/ko/migration-system-guide.md) / [en](guides/en/migration-system-guide.md)
- **설계 제안·이슈 계획**: [plans/](plans/)

추가 문서는 위 카테고리에 맞춰 배치하고, README.md의 해당 섹션에 링크를 추가하면 된다.
