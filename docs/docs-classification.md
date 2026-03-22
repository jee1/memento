# docs 분류 체계

**하는 일**: `docs/` 하위 문서의 카테고리 정의와 찾아보기 가이드.  
**연관**: [docs/README.md](README.md)(이중 포털 목차), [AGENTS.md](../AGENTS.md)(저장소 가이드).

---

## 1. 분류 원칙

- **공식 vs 작업**
  - **공식 문서**: 사용자·운영자·신규 기여자가 제품을 이해하고 쓰기 위해 유지되는 문서(`guides/`, `architecture/`, `api/`, `operations/`, `reference/`, `blog/` 등).
  - **`_work/` 문서**: 계획·리뷰·검증·실험·리서치 등 **진행 중이거나 히스토리 성격**이 강한 산출물. 링크가 자주 바뀌거나 SDD 폴더 구조를 그대로 반영한다.
- **대상·용도**: 누가/무엇을 위해 보는 문서인지로 상위 구분한다.
- **언어**: 공식 문서는 해당 카테고리의 **`en/`** 또는 **`ko/`** 하위에 둔다. `_work/`는 경로별로 `ko/`·`en/`·플랫 파일이 혼재할 수 있다.
- **Diataxis 참고**: Tutorial · How-to · Reference · **Explanation**(개념·이유 설명)을 의도에 맞게 배치한다.

---

## 2. 공식 문서 카테고리

| 카테고리 | 설명 | 예시 경로 | audience(기본) | 상태 기본값 |
|----------|------|-----------|----------------|-------------|
| **가이드 (guides)** | 입문·설정·How-to | `guides/ko/`, `guides/en/` — user-manual, developer-guide, cursor-mcp-setup | user, contributor | stable |
| **아키텍처 (architecture)** | 설계 설명·ERD·파이프라인 | `architecture/ko/`, `architecture/en/` | contributor | stable |
| **API** | 스펙·엔드포인트 레퍼런스 | `api/ko/`, `api/en/` | integrator, contributor | stable |
| **운영·도구 (operations)** | 릴리스·점검·트러블슈팅 | `operations/ko/`, `operations/en/` | operator, contributor | stable |
| **참조 (reference)** | 로깅·보안·수식·상태 보고 등 | `reference/ko/`, `reference/en/` | contributor, operator | stable |
| **블로그 (blog)** | 비정기 게시·회고 | `blog/` | any | ephemeral |

---

## 3. `_work/` 문서 카테고리

| 카테고리 | 설명 | 예시 경로 | audience(기본) | 상태 기본값 |
|----------|------|-----------|----------------|-------------|
| **계획·제안 (plans)** | 이슈별 SDD 폴더·로드맵·제안 | `_work/plans/ko/`, `_work/plans/en/`, `_work/plans/*.md` | contributor, agent | draft / archived |
| **설계 초안 (design)** | 기능 전 설계·리뷰 초안 | `_work/design/` | contributor, agent | draft |
| **브레인스토밍 (brainstorms)** | 탐색적 논의 | `_work/brainstorms/` | contributor | draft |
| **코드 리뷰 (code_review)** | 사전 리뷰·리뷰 요청 | `_work/code_review/ko/`, `_work/code_review/en/` | contributor | completed |
| **검증·보고 (reviews)** | 단계 검증·테스트 보고 | `_work/reviews/ko/`, `_work/reviews/en/` | contributor | completed |
| **테스트 가이드 (testing)** | 품질 시나리오·벤치 가이드 | `_work/testing/ko/`, `_work/testing/en/` | contributor | draft |
| **리서치 (research)** | 조사·MVP 검토 | `_work/research/ko/` 등 | contributor | draft |
| **해결 사례 (solutions)** | 원인·해결 정리 | `_work/solutions/**` | contributor | stable |
| **이슈 메모 (issues)** | 미착수 제안·노트 | `_work/issues/` | contributor | draft |

---

## 4. 디렉터리 → 카테고리 매핑

| 디렉터리 | 공식/작업 | 카테고리 |
|----------|-----------|----------|
| `docs/guides/en/`, `docs/guides/ko/` | 공식 | 가이드 |
| `docs/architecture/en/`, `docs/architecture/ko/` | 공식 | 아키텍처 |
| `docs/api/en/`, `docs/api/ko/` | 공식 | API |
| `docs/operations/en/`, `docs/operations/ko/` | 공식 | 운영·도구 |
| `docs/reference/en/`, `docs/reference/ko/` | 공식 | 참조 |
| `docs/blog/` | 공식 | 블로그 |
| `docs/_work/plans/**` | 작업 | 계획·제안 |
| `docs/_work/design/**` | 작업 | 설계 초안 |
| `docs/_work/brainstorms/**` | 작업 | 브레인스토밍 |
| `docs/_work/code_review/**` | 작업 | 코드 리뷰 |
| `docs/_work/reviews/**` | 작업 | 검증·보고 |
| `docs/_work/testing/**` | 작업 | 테스트 가이드 |
| `docs/_work/research/**` | 작업 | 리서치 |
| `docs/_work/solutions/**` | 작업 | 해결 사례 |
| `docs/_work/issues/**` | 작업 | 이슈 메모 |

---

## 5. 메타데이터 (`audience` / `type` / `status`)

문서 헤더나 PR에 다음을 맞추면 검색·온보딩에 도움이 된다.

| 필드 | 값 예시 | 의미 |
|------|---------|------|
| **audience** | `user`, `integrator`, `operator`, `contributor`, `agent` | 1차 독자. 복수면 쉼표로 병기 가능. |
| **type** (Diataxis) | `tutorial`, `how-to`, `reference`, `explanation` | 문서가 답하려는 질문 유형. |
| **status** | `stable`, `draft`, `completed`, `archived`, `ephemeral` | 유지보수 기대치. `_work/`는 기본 `draft` 또는 `completed`(리뷰·검증 완료 건). |

---

## 6. 찾아보기

- **전체 포털**: [docs/README.md](README.md)
- **DB·마이그레이션**: [architecture/ko/database-design.md](architecture/ko/database-design.md) / [en](architecture/en/database-design.md), [guides/ko/migration-system-guide.md](guides/ko/migration-system-guide.md) / [en](guides/en/migration-system-guide.md)
- **이슈별 계획·SDD**: [_work/plans/ko/](_work/plans/ko/)

추가 문서는 공식이면 해당 공식 카테고리에 두고 README 포털에 링크를 더하고, 작업 산출물이면 `_work/` 아래 적절한 폴더에 둔다.
