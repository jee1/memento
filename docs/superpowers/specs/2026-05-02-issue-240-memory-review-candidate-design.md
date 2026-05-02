# 설계: 이슈 #240 — 리뷰 후보 저장 모델·마이그레이션

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-02  
**이슈**: [GitHub #240](https://github.com/jee1/memento/issues/240)  
**상위 맥락**: [GitHub #18](https://github.com/jee1/memento/issues/18) (기억 재생·자동 리뷰 MVP). 전체 제품 설계는 부모 이슈 분해 문서가 `main`에 합류하면 그 경로를 정식 출처로 링크한다. 본 문서는 #240 구현 범위만 고정한다.

---

## 1. 배경·문제

중요 기억 자동 리뷰 MVP의 첫 단계로, 리뷰 **후보**를 SQLite에 안정적으로 저장하고 `pending` 행이 `memory_id`당 하나만 되도록 보장할 필요가 있다. 이후 이슈에서 산출 로직·Admin API·배치 Job이 이 테이블을 사용한다.

---

## 2. 목표·비목표

### 2.1 목표 (#240)

- `memory_review_candidate` 테이블과 제약·인덱스를 **번호 마이그레이션**으로 추가한다 (다음 사용 가능 번호: `033-`, 기존 최대 `032-` 기준).
- `pending` 상태에 대해 **동일 `memory_id` 중복 삽입 방지**를 DB 계층에서 보장한다 (partial unique index).
- 기본 조회 패턴 `(status, priority 내림차순, due_at 오름차순)`에 맞는 **복합 인덱스**를 둔다.
- 마이그레이션과 동일 DDL의 **`ensureMemoryReviewCandidateSchema`** 멱등 함수를 추가하고, `init` 등 기존 경로에서 다른 `ensure*`와 같이 호출 가능하게 한다.
- **신규 DB**와 **기존 DB(마이그레이션 연쇄)** 모두에서 마이그레이션이 성공하는지 **스펙 테스트**로 검증한다.
- `@memento/core` **package entry**에서 ensure 함수를 re-export한다 (다른 `ensureMetaMemoryStatsSchema` 등과 동일 패턴).

### 2.2 비목표 (#240)

- 후보 **산출** 비즈니스 로직, **HTTP Admin** 엔드포인트, **BatchScheduler** Job 등록.
- MCP 도구 노출, 대시보드 UI.
- `memory_item` 삭제·하이브리드 랭킹 변경.

---

## 3. 데이터 모델

### 3.1 테이블 `memory_review_candidate`

| 컬럼 | 타입 | 제약 |
|------|------|------|
| `id` | TEXT | PRIMARY KEY |
| `memory_id` | TEXT | NOT NULL, FK → `memory_item(id)` **ON DELETE CASCADE** |
| `status` | TEXT | NOT NULL, `CHECK (status IN ('pending','reviewed','dismissed','expired'))` |
| `priority` | REAL | NOT NULL |
| `reason` | TEXT | NOT NULL |
| `due_at` | TEXT | NOT NULL (ISO-8601 문자열; 기존 마이그레이션의 타임스탬프 관례와 정합) |
| `created_at` | TEXT | NOT NULL |
| `updated_at` | TEXT | NOT NULL |
| `reviewed_at` | TEXT | NULL |
| `dismissed_at` | TEXT | NULL |
| `metadata_json` | TEXT | NULL (산출 시점 스냅샷 JSON; 정규화된 진실 원천 아님) |

### 3.2 인덱스

1. **Partial unique (pending 중복 방지)**  
   - 유니크 대상: `memory_id`  
   - 조건: `WHERE status = 'pending'`  
   - SQLite 예: `CREATE UNIQUE INDEX ... ON memory_review_candidate(memory_id) WHERE status = 'pending';`

2. **조회 큐**  
   - `(status, priority DESC, due_at ASC)`  
   - 프로젝트 SQLite 버전 전제에서 `CREATE INDEX ... ON memory_review_candidate(status, priority DESC, due_at ASC);` 형태로 정의하고, 기존 마이그레이션 파일들과 동일한 표현 관례를 따른다.

인덱스 이름은 구현 시 `idx_memory_review_candidate_*` 네이밍으로 통일한다.

---

## 4. 구현 요약

| 영역 | 내용 |
|------|------|
| 마이그레이션 | `033-memory-review-candidate-schema.ts` (+ 프로젝트가 `.sql` 분리 파일을 쓰면 동일 번호), `SchemaVersionManager` 등록 패턴 준수. |
| ensure | `packages/memento-core/src/shared/utils/ensure-memory-review-candidate-schema.ts`: `memory_item` 존재 시에만 DDL 실행; `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` / 일반 인덱스 `IF NOT EXISTS` 등으로 **멱등**. 참고: `ensure-meta-memory-stats-schema.ts`. Partial unique는 SQLite에서 `IF NOT EXISTS`와 함께 생성 가능하므로 ensure 경로와 마이그레이션 DDL을 동일하게 유지한다. |
| init | `packages/memento-core/src/infrastructure/database/database/init.ts`에서 다른 ensure와 함께 호출해 구 DB·baseline 불일치 시에도 스키마가 수렴하도록 한다. |
| 테스트 | `033-memory-review-candidate-schema.spec.ts`: (1) 최소 베이스 스키마 DB에 마이그레이션 적용, (2) 연쇄·재실행 시 idempotency, (3) 동일 `memory_id`에 `pending` 두 행 삽입 시 **실패** 확인. |
| export | `packages/memento-core/src/index.ts` shared re-export 블록에 `ensureMemoryReviewCandidateSchema` 추가. |

---

## 5. 오류·동시성

- 애플리케이션이 중복 삽입을 시도하면 partial unique 위반으로 실패한다. 상위 서비스는 추후 이슈에서 catch 후 “이미 pending 존재”로 처리할 수 있다 (#240에서는 서비스 로직 필수 아님).
- FK는 `memory_item` 삭제 시 후보 행이 연쇄 삭제된다.

---

## 6. 검증 (완료 조건)

- `npm test` 관련 마이그레이션 스펙 통과.
- `npm run type-check` 통과.
- 이슈 #240 본문의 완료 조건: 신규·기존 DB 마이그레이션 성공, `pending` 중복 불가, 스키마 테스트 통과.

---

## 7. 출처

- [GitHub #240](https://github.com/jee1/memento/issues/240)  
- 부모 분해 설계(예: 워크트리 `issue-18-decomposition`의 memory review decomposition 문서): 데이터 모델·인덱스 정의와 정합.
