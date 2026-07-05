# JSONL 메모리 Export / Import (DR·마이그레이션)

Issue #668 — `memory_item` 행과 선택적 `memory_relation`을 JSONL로 내보내고, 새 DB에 복원하는 운영 워크플로입니다.

## 언제 사용하나

| 시나리오 | 권장 도구 |
|----------|-----------|
| 동일 버전 DR / 스테이징 이전 | `npm run memory:export` → `npm run memory:import` |
| 파일 단위 백업 (전체 SQLite) | `npm run db:backup` |
| Admin UI/API 단건 내보내기 | `GET /admin/export?format=jsonl` (#672) |

JSONL export는 **스키마 버전·체크섬 manifest**가 1행째에 포함되어 무결성 검증과 버전 호환 확인에 적합합니다.

## Export

```bash
# 기본 (memory_item만)
DB_PATH=./data/memory.db npm run memory:export -- --output ./backup/memories.jsonl

# 관계 포함
DB_PATH=./data/memory.db npm run memory:export -- \
  --output ./backup/memories-with-relations.jsonl \
  --include-relations
```

출력 JSONL 형식:

1. **1행 (manifest)**: `schema_version`, `checksum` (sha256), `record_counts`, `exported_at`
2. **이후 행**: `{ "type": "memory_item"|"memory_relation", "row": { ... } }`

`schema_version`은 `@memento/core`의 `MEMENTO_LATEST_SCHEMA_VERSION`(현재 DB 마이그레이션 최신)과 일치해야 import 시 검증을 통과합니다.

## Import (fresh DB)

```bash
# 새 DB 경로 지정
npm run memory:import -- \
  --input ./backup/memories.jsonl \
  --target ./data/restored-memory.db

# 또는 DB_PATH로 대상 지정
DB_PATH=./data/restored-memory.db npm run memory:import -- --input ./backup/memories.jsonl
```

Import는:

- manifest `checksum` 검증
- `schema_version` 검증 (구버전 export는 `--allow-legacy`로 완화 가능)
- `memory_item` → `memory_relation` 순으로 삽입

**주의**: 임베딩·FTS·벡터 테이블은 포함하지 않습니다. 복원 후 `npm run regenerate:embeddings` 등으로 재생성이 필요할 수 있습니다.

## DR 워크플로 (권장)

1. **배포 전**: `npm run db:pre-docker-deploy` (무결성 + 파일 백업)
2. **논리 백업**: `npm run memory:export -- --output ./backup/daily-$(date +%F).jsonl --include-relations`
3. **복구 연습** (스테이징):
   ```bash
   npm run memory:import -- --input ./backup/daily-YYYY-MM-DD.jsonl --target /tmp/restore.db
   npm run db:check-migration -- /tmp/restore.db
   ```
4. **프로덕션 복원**: MCP/HTTP 중지 → import → `db:migrate` → 서비스 재기동 → 검색/임베딩 재생성

## 마이그레이션(버전 업) 시

1. 구 환경에서 JSONL export (`schema_version` 기록 확인)
2. 신 환경 Memento 설치·`db:migrate`
3. `memory:import` (동일 major migration line이면 `--allow-legacy` 없이 가능)
4. 스키마 불일치 시 export를 신 버전에서 다시 수행

## 관련 명령

| 명령 | 설명 |
|------|------|
| `npm run memory:export` | JSONL export |
| `npm run memory:import` | JSONL import |
| `npm run db:backup` | SQLite 파일 백업 |
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run db:check-migration` | 스키마 버전 확인 |

## 망각 이벤트 로그 (#669)

삭제 사유 audit trail은 별도 테이블 `memory_forgetting_event`에 기록됩니다.

- CLI: `npm run forgetting:events -- --memory-id <id>`
- Admin: `GET /admin/forgetting/events?memory_id=&action=&limit=`

자세한 필드: `reason`, `policy`, `forget_score`, `ttl_days`, `metadata_json`.
