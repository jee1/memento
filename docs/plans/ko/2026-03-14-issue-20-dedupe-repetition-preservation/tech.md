# 이슈 #20 — Memory Bank: Tech

SDD **Plan** 단계의 **Memory Bank** 문서 2/3. 기술 스택·스키마·제약을 정의한다.

---

## 1. 기술 스택

- **언어·런타임**: TypeScript, Node.js ≥ 20 (기존 memento-core와 동일).
- **DB**: SQLite, better-sqlite3. 스키마는 #88 마이그레이션(017-fact-metadata-fields 등)에서 num_times, last_mentioned_at 추가.
- **기존 활용**: 기존 consolidation-score-worker, batch-scheduler, hybrid-search-engine 등과 동일 스택.

---

## 2. 스키마 전제 (#88)

본 기능은 아래 컬럼이 **이미 존재한다고 가정**한다.

- `memory_item.num_times` — INTEGER, 기본 1. “이 fact/기억이 언급된 횟수”.
- `memory_item.last_mentioned_at` — TIMESTAMP, nullable. 마지막 언급 시각.

추가 컬럼(선택):

- `memory_item.merged_into_id` — TEXT, nullable. 병합된 경우 대표 항목 ID.
- soft-delete: `deleted_at` 또는 동등한 플래그(기존 정책에 따름).

---

## 3. 제약

- **#88 의존**: num_times, last_mentioned_at이 없으면 병합 시 메타 갱신 로직은 스킵하거나 no-op.
- **트랜잭션**: 병합(대표 UPDATE + 병합 대상 처리)은 단일 트랜잭션으로 원자적 수행.
- **인덱스**: #88에서 num_times, last_mentioned_at 인덱스가 recall 성능용으로 있다고 가정. 본 기능은 추가 인덱스 없이 기존 스키마만 사용.

---

*도입 기술·제약 변경 시 이 문서를 먼저 갱신한다.*
