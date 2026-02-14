# DB 설계 문서 통합 방안 제안

**목적**: 현재 여러 문서·코드에 분산된 DB/스키마 관련 내용을 **하나의 설계 문서**로 통합하여, 신규 참여자·AI·리뷰 시 단일 참조 지점을 제공한다.

**상태**: 제안(검토용). 적용 시 팀 합의 후 진행.

---

## 1. 현황 요약

### 1.1 현재 DB 관련 정보 분포

| 출처 | 내용 | 한계 |
|------|------|------|
| `docs/en/Memento-M1-DetailSpecs.md` §4 | M1 기준 Database Design (메인 테이블·FTS5/VSS 개요) | M1만 해당, 현재 스키마와 불일치 |
| `docs/ko/Memento-M1-DetailSpecs.md` §4 | 위와 동일(한국어) | 동일 |
| `src/infrastructure/database/database/schema.sql` | **실행용 전체 DDL** (테이블·인덱스·트리거·FTS/VEC) | 주석만으로 의도·관계 설명 부족 |
| `docs/ko/migration-system-guide.md` | 마이그레이션 사용법·인터페이스·실행 절차 | 스키마 “설계” 자체는 아님 |
| `docs/plans/*.md`, `tasks/*.md` | 이슈별 스키마 설계·마이그레이션 계획 | PRD/이슈에 묻혀 있고 단일 문서 아님 |

### 1.2 스키마 소스 정리

- **실제 스키마 진실 공급원**: `schema.sql` + 마이그레이션 002~020 적용 결과.
- **schema.sql에만 정의된 테이블**: `memory_item`, `memory_tag`, `memory_item_tag`, `memory_link`, `feedback_event`, `wm_buffer`, `process_attribute`, `memory_item_fts`, `memory_embedding`, `embedding_model_registry`, `memory_item_vec*`, `core_memory`, `knowledge_vault`.
- **마이그레이션에서만 추가되는 테이블**: `memory_relation`, `relation_type_registry`(005), `anchor`(004), `kg_triple`(018), `memento_schema_version`, 품질·메타 메모리 관련(009, 011) 등.

→ “현재 DB 설계”를 이해하려면 schema.sql + 마이그레이션 목록 + 각 PRD/계획 문서를 오가야 하는 상태.

---

## 2. 통합 방안

### 2.1 단일 설계 문서 도입

- **문서 경로 제안**: `docs/architecture/database-design.md`  
  - `docs/architecture/`에 이미 `async-augmentation-pipeline.md` 등이 있어 아키텍처 문서와 함께 두기 적합.
- **역할**:
  - **사람·AI가 읽는 “DB 설계 명세”**: 테이블 목적, 컬럼 의미, 제약·인덱스·관계, 마이그레이션 이력 요약.
  - **실행용 DDL의 상위 설명**: `schema.sql`과 마이그레이션은 그대로 “진실 공급원”으로 유지하고, 이 문서는 그것을 해석·정리한 단일 참조본.

### 2.2 문서 구조 제안

다음 순서로 단일 문서를 구성한다.

1. **개요**
   - DB 역할(SQLite 임베디드, M1~현재 확장), 단일 문서 정책(schema.sql + 마이그레이션 = 실행 소스, 본 문서 = 설계 설명).
   - **타임스탬프 표준 시간대**: DB 저장용 시각의 표준 시간대(권장: UTC)를 명시하고, 로그/표시용 변환 정책이 있으면 간단히 적는다.
   - 관련 문서 링크: `migration-system-guide.md`, `schema.sql` 경로, `AGENTS.md` DB 절.

2. **개념 수준(선택)**
   - 도메인 관점 요약: 메모리 타입(working/episodic/semantic/procedural), 앵커, 관계(relation), 임베딩/벡터, Core·Vault·KG Triple 등.
   - ER 다이어그램 또는 테이블 관계 요약(선택, Mermaid 등).

3. **테이블 및 컬럼 명명 규칙**
   - **테이블명**: `snake_case`. 복수형보다 단수/집합 의미의 단일 명사 또는 명사_명사 조합. 예: `memory_item`, `memory_item_tag`, `core_memory`, `embedding_model_registry`.
   - **컬럼명**: `snake_case`. 약어는 팀에서 통용되는 것만 사용(예: `id`, `fk` 대신 참조 대상이 드러나게 `memory_id`, `tag_id`).
   - **주 키**: 테이블당 하나. `id`(단일 PK) 또는 `{엔티티}_id`(예: `core_id`, `vault_id`). 복합 PK는 해당 컬럼 나열(예: `memory_id`, `tag_id`).
   - **외래 키·참조 컬럼**: `{참조 테이블 단수/요약}_id`(예: `memory_id`, `source_id`, `target_id`, `agent_id`, `owner_id`, `process_id`, `session_id`). 동일 테이블 참조 시 역할 구분(예: `source_id`, `target_id`).
   - **시각/타임스탬프**: `*_at` 접미사(예: `created_at`, `updated_at`, `last_accessed`, `expires_at`, `last_mentioned_at`, `deleted_at`). ISO 8601 또는 SQLite 호환 타임스탬프. **표준 시간대**: DB에 저장하는 타임스탬프의 표준 시간대는 통합 설계 문서에 반드시 명시한다(권장: **UTC** 저장, ISO 8601 `Z` 접미사 또는 `strftime('%Y-%m-%dT%H:%M:%fZ','now')` 등; 로그·사용자 표시는 필요 시 KST 등으로 변환).
   - **인덱스명**: `idx_{테이블 약어 또는 이름}_{컬럼명}`. 복합이면 `idx_{테이블}_{col1}_{col2}`. 예: `idx_memory_item_type`, `idx_memory_item_process_id`, `idx_core_memory_agent_id`.
   - **가상 테이블**: 물리 테이블과 구분 가능하게 접미사 사용. 예: `memory_item_fts`(FTS5), `memory_item_vec`, `memory_item_vec_tfidf`(vec0).
   - **일관성**: 신규 테이블/컬럼/인덱스 추가 시 위 규칙을 따르고, 통합 설계 문서의 “명명 규칙” 절을 함께 갱신한다.

4. **물리 모델: 테이블·가상 테이블**
   - 테이블별 한 줄 목적 + 컬럼 목록(이름, 타입, 제약, 비즈니스 의미 간단히).
   - `schema.sql`에 없는 테이블(memory_relation, kg_triple, anchor, memento_schema_version, 품질/메타 테이블 등)은 “마이그레이션 NNN에서 추가”로 명시.
   - 가상 테이블: FTS5(`memory_item_fts`), vec0(`memory_item_vec*`) 용도·차원만 요약.

5. **인덱스·제약**
   - 주요 인덱스 목적(조회 패턴·필터): 예) `idx_memory_item_type`, `idx_memory_item_process_id` 등.
   - UNIQUE/FK 요약.

6. **마이그레이션 이력**
   - 버전별 한 줄 요약 테이블(버전, 이름, 변경 요약). 상세는 기존 마이그레이션 파일 참조.

7. **동기화 규칙**
   - 스키마 변경 시: (1) 마이그레이션 추가 및 `schema.sql` 반영(팀 정책에 따름), (2) **본 설계 문서 해당 절 갱신**을 PR 체크리스트에 포함.

### 2.3 기존 문서와의 관계

- **Memento-M1-DetailSpecs.md §4**:  
  - “M1 당시 설계”로 유지하되, “현재 전체 설계는 `docs/architecture/database-design.md` 참조” 문구 추가.
- **docs/ko/migration-system-guide.md**:  
  - 변경 없음. “스키마 변경 후 설계 문서 갱신” 한 줄 추가 권장.
- **PRD/plans 내 스키마 설계 절**:  
  - 이슈별 설계는 그대로 두고, **반영 완료 후** 통합 문서에 해당 테이블/컬럼이 반영되도록 “통합 문서 업데이트”를 태스크로 넣는 방식 권장.

### 2.4 유지보수

- **단일 소스 원칙**: 실행 가능한 스키마의 진실 공급원은 계속 `schema.sql` + 마이그레이션. 통합 문서는 “설명·목적·이력”의 단일 소스.
- **리뷰**: 스키마/마이그레이션을 건드리는 PR에서 “database-design.md 갱신 여부” 체크.
- **자동화(선택)**: CI에서 `schema.sql` 파싱해 테이블/컬럼 목록을 생성하고, 문서와 불일치 시 경고하는 스크립트는 후속 과제로 검토 가능.

---

## 3. 작업 범위(구현 시)

| 단계 | 작업 | 산출물 |
|------|------|--------|
| 1 | `docs/architecture/database-design.md` 초안 작성 | §1~§7 채우기(schema.sql·마이그레이션 002~020 기반, **테이블·컬럼 명명 규칙** 포함) |
| 2 | M1 DetailSpecs §4에 통합 문서 링크 추가 | 영/한 각 1줄 |
| 3 | migration-system-guide에 “설계 문서 갱신” 문구 추가 | 1절 또는 체크리스트 |
| 4 | AGENTS.md 또는 README에 “DB 설계는 docs/architecture/database-design.md” 안내 | 1줄 |

---

## 4. 참고: 외부 Best Practice

- 스키마 문서는 **단일 마크다운**으로 두면 버전 관리·검색·AI 활용에 유리하다.
- 테이블/컬럼마다 **목적·비즈니스 맥락**을 한 문장씩 두면 유지보수와 온보딩에 도움이 된다.
- **마이그레이션 이력**을 문서에 요약해 두면 “언제 무엇이 추가되었는지” 추적이 쉬워진다.

---

## 5. 결론

- **권장**: `docs/architecture/database-design.md`를 새로 두고, 위 §2.2 구조로 “설계 설명 + **테이블·컬럼 명명 규칙** + 마이그레이션 이력 요약”을 통합한다.  
- **진실 공급원**: 실행 DDL은 `schema.sql` + 마이그레이션을 그대로 유지하고, 통합 문서는 이에 대한 단일 읽기 창구로 사용한다.  
- **다음 단계**: 팀 합의 후 §3 작업 범위대로 초안 작성 및 링크 정리 진행.
