# 검토 큐 안전 정리

`memento review-queue cleanup`은 누적된 `pending` 검토 후보를 서버 기동이나 자동 마이그레이션 없이 일괄 `dismiss` 또는 `expire` 처리합니다.

## 1. 대상 확인

기본 동작은 dry-run입니다. 다음 명령은 30일보다 오래된 후보 수만 계산하며 DB를 변경하지 않습니다.

```bash
memento review-queue cleanup \
  --older-than-days 30 \
  --expire
```

전체 pending 후보를 대상으로 확인하려면 다음과 같이 실행합니다.

```bash
memento review-queue cleanup \
  --all-pending \
  --dismiss
```

성공 결과는 JSON으로 출력됩니다.

```json
{
  "ok": true,
  "dry_run": true,
  "action": "expire",
  "selector": { "older_than_days": 30 },
  "database_path": "/path/to/memory.db",
  "target_count": 42,
  "updated_count": 0
}
```

## 2. 명시적 실행

dry-run의 `database_path`, `selector`, `action`, `target_count`를 확인한 뒤 같은 명령에 `--execute --yes`를 모두 추가합니다.

```bash
memento review-queue cleanup \
  --older-than-days 30 \
  --expire \
  --execute \
  --yes
```

`--execute`만 지정하면 명령은 실패합니다. `--yes`만 지정해도 실패하며, 실제 변경은 트랜잭션 하나에서 수행됩니다.

## 선택자와 동작

- 선택자는 `--older-than-days <1..3650>` 또는 `--all-pending` 중 정확히 하나여야 합니다.
- 동작은 `--dismiss` 또는 `--expire` 중 정확히 하나여야 합니다.
- `--dry-run`은 선택 사항이며 기본 동작과 같습니다.

DB 경로는 `--db-path`, `DB_PATH`, 기본 경로 `~/.memento/memory.db` 순서로 결정됩니다. 명령은 DB 파일과 migration 033의 검토 큐 테이블·인덱스가 이미 존재해야 실행되며, 누락된 스키마를 생성하지 않습니다.

실패 시 stderr에 원인이 출력되고 exit code는 0이 아닌 값입니다.
