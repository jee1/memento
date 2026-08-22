# docs 분류 체계

**하는 일**: `docs/` 하위 문서의 카테고리 정의와 찾아보기 가이드.  
**연관**: [docs/README.md](README.md)(이중 포털 목차), [AGENTS.md](../AGENTS.md)(저장소 가이드).

---

## 1. 분류 원칙

- **지속적으로 유지할 문서만 저장**: 사용자·운영자·신규 기여자가 제품을 이해하고 쓰기 위해 필요한 문서는 `guides/`, `architecture/`, `api/`, `operations/`, `reference/`, `blog/` 등에 둔다. 일회성 계획·검증 로그·생성 결과는 커밋하지 않는다.
- **명세와 결정 분리**: 기능 설계·구현 상태는 루트 [`specs/`](../specs/README.md), 장기 설계 결정은 `adr/`에서 관리한다.
- **대상·용도**: 누가/무엇을 위해 보는 문서인지로 상위 구분한다.
- **언어**: 공식 문서는 해당 카테고리의 **`en/`** 또는 **`ko/`** 하위에 둔다.
- **Diataxis 참고**: Tutorial · How-to · Reference · **Explanation**(개념·이유 설명)을 의도에 맞게 배치한다.
- **네러티브 문체**: 공식 문서는 **읽히는 글**을 기본으로 한다. 표·불릿·코드 블록은 레퍼런스·체크리스트·복사용 예시에 두고, 절의 서두·개요·전환은 완결된 문장으로 **맥락 → 선택 → 다음 행동**이 이어지게 쓴다. (예: "포트가 충돌하면 `.env`에서 `MCP_SERVER_PORT`를 바꾼 뒤 서버를 재시작합니다.") API 필드 목록·환경 변수 표·MCP 도구 표처럼 **조회용** 구간은 표를 유지해도 된다.

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
| **통합·외부 연동 (integrations)** | 외부 AI 비서와 Memento 연결 가이드 | `integrations/` | user, integrator | stable |
| **아키텍처 결정 기록 (adr)** | 설계 결정 근거 기록 | `adr/` | contributor | stable |

---

## 3. 디렉터리 → 카테고리 매핑

| 디렉터리 | 구분 | 카테고리 |
|----------|-----------|----------|
| `docs/guides/en/`, `docs/guides/ko/` | 공식 | 가이드 |
| `docs/architecture/en/`, `docs/architecture/ko/` | 공식 | 아키텍처 |
| `docs/api/en/`, `docs/api/ko/` | 공식 | API |
| `docs/operations/en/`, `docs/operations/ko/` | 공식 | 운영·도구 |
| `docs/reference/en/`, `docs/reference/ko/` | 공식 | 참조 |
| `docs/blog/` | 공식 | 블로그 |
| `docs/integrations/` | 공식 | 통합·외부 연동 |
| `docs/adr/` | 공식 | 아키텍처 결정 기록 |

---

## 4. 메타데이터 (`audience` / `type` / `status`)

문서 헤더나 PR에 다음을 맞추면 검색·온보딩에 도움이 된다.

| 필드 | 값 예시 | 의미 |
|------|---------|------|
| **audience** | `user`, `integrator`, `operator`, `contributor`, `agent` | 1차 독자. 복수면 쉼표로 병기 가능. |
| **type** (Diataxis) | `tutorial`, `how-to`, `reference`, `explanation` | 문서가 답하려는 질문 유형. |
| **status** | `stable`, `draft`, `completed`, `archived`, `ephemeral` | 유지보수 기대치. 현재 문서 트리에는 지속적으로 관리할 상태만 남긴다. |

---

## 5. 찾아보기

- **전체 포털**: [docs/README.md](README.md)
- **DB·마이그레이션**: [architecture/ko/database-design.md](architecture/ko/database-design.md) / [en](architecture/en/database-design.md), [guides/ko/migration-system-guide.md](guides/ko/migration-system-guide.md) / [en](guides/en/migration-system-guide.md)
- **이슈별 계획·SDD**: [`specs/README.md`](../specs/README.md)

추가 문서는 해당 공식 카테고리에 두고 README 포털에 링크를 더합니다. 기능 명세와 계획은 `specs/`, 재사용 가능한 테스트 절차는 `guides/`, 장기 설계 결정은 `adr/`에 둡니다. 일회성 증거와 프로세스 산출물은 저장소에 누적하지 않습니다.
