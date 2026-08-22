# Docker 배포 절차 (권장)

Memento MCP/HTTP 서버를 Docker로 **재배포·재시작**할 때 따르는 공식 절차입니다.  
`memory.db`는 호스트 `~/.memento/data/`에 마운트되므로, 컨테이너 재기동만으로도 DB 무결성 검사(`quick_check`)가 실행됩니다. 손상된 DB는 서버가 **의도적으로 기동을 거부**합니다.

메인 `Dockerfile` 베이스는 **Node 24**입니다 (`node:24-alpine` builder / `node:24-slim` production). `package.json` `engines.node`·CI와 동일 major입니다. 배포 전 무결성 점검은 아래 `npm run db:pre-docker-deploy`를 따릅니다.

관련 문서:

- [배포 전 환경변수 점검](../env-deployment-checklist.md)
- [Docker 설정 가이드](../DOCKER_SETUP_GUIDE.md)
- [scripts/ 스크립트 인덱스](scripts-index.md)

---

## 언제 이 절차를 따르나

다음 작업 **전·후**에 적용합니다.

- `docker compose build` 후 `up -d` (이미지 재빌드·배포)
- `docker compose up -d`로 컨테이너 재생성
- Dockerfile·서버 코드·정적 대시보드 변경을 운영 인스턴스에 반영할 때

로컬에서 `npm run dev`만 쓰는 경우에는 **Docker와 동시에 같은 `memory.db`를 쓰지 마세요** (writer는 한 프로세스만).

---

## 사전 조건

| 항목 | 내용 |
|------|------|
| DB 경로 (호스트) | `~/.memento/data/memory.db` |
| DB 경로 (컨테이너) | `/app/data/memory.db` (`DB_PATH`) |
| 백업 출력 | `~/.memento/data/backups/memory-backup-<timestamp>.db` |
| 저장소 루트 | `git clone`된 memento 디렉터리에서 명령 실행 |

---

## 표준 배포 절차

### 1. 서버 중지

DB에 대한 **유일한 writer**를 제거합니다. 백업 API가 빈 파일을 만들지 않도록 먼저 중지합니다.

```bash
cd /path/to/memento
docker compose stop memento-mcp-server
```

### 2. 배포 전 DB 검사 및 백업

```bash
npm run db:pre-docker-deploy
```

이 명령은 다음을 수행합니다.

1. `npm run db:backup` — SQLite **online backup API**로 일관된 스냅샷 생성 (`copy` / `copyFileSync` 사용 안 함)
2. 백업 파일에 대해 `PRAGMA quick_check` 실행
3. 실패 시 **종료 코드 1** (배포 중단)

성공 시 JSON 예시:

```json
{
  "ok": true,
  "dbPath": "/home/<user>/.memento/data/memory.db",
  "backupPath": "/home/<user>/.memento/data/backups/memory-backup-....db",
  "quick_check": "ok",
  "memory_item": 26474
}
```

> **주의:** 컨테이너가 DB를 잡고 있는 상태에서 백업하면 0바이트 파일이 생길 수 있습니다. 반드시 **1단계 중지 후** 실행하세요.

### 3. (선택) 코드 품질 게이트

```bash
npm run lint && npm run type-check && npm test
```

### 4. 이미지 빌드 및 기동

```bash
docker compose build memento-mcp-server
docker compose up -d memento-mcp-server
```

`docker-compose.base.yml`에는 `stop_grace_period: 30s`가 설정되어 있어, 정상 `stop` 시 WAL flush 시간을 확보합니다. 컨테이너 기동 시 `scripts/start-container.sh`가 `PRAGMA wal_checkpoint(PASSIVE)`를 시도합니다.

### 5. 배포 후 확인

```bash
docker compose ps memento-mcp-server
docker compose logs --tail=50 memento-mcp-server
curl -sf http://localhost:9001/health
sqlite3 ~/.memento/data/memory.db "PRAGMA quick_check; SELECT count(*) FROM memory_item;"
```

`health` 응답에 `"database":"connected"`가 포함되고, `quick_check`가 `ok`이면 정상입니다.

---

## 한 줄 요약 (체크리스트)

```bash
docker compose stop memento-mcp-server
npm run db:pre-docker-deploy
docker compose build memento-mcp-server
docker compose up -d memento-mcp-server
curl -sf http://localhost:9001/health
```

---

## npm 스크립트 참고

| 명령 | 용도 |
|------|------|
| `npm run db:backup` | online backup만 수행 (서버 중지 후 권장) |
| `npm run db:pre-docker-deploy` | 백업 + `quick_check`; 실패 시 배포 중단 |
| `npm run db:pre-docker-deploy -- --force` | 검사 실패해도 계속 (**위험**, 손상 DB 확인 후에만) |
| `npm run db:restore-from-corrupt` | 손상 DB에서 테이블별 복구 (아래 복구 절 참고) |

환경 변수 `DB_PATH`로 대상 DB를 바꿀 수 있습니다 (기본: `~/.memento/data/memory.db`).

```bash
DB_PATH=/custom/path/memory.db npm run db:backup
```

---

## 롤백

배포 후 문제가 있으면 **가장 최근 성공 백업**으로 되돌립니다.

```bash
docker compose stop memento-mcp-server

BACKUP=~/.memento/data/backups/memory-backup-<timestamp>.db   # pre-docker-deploy 출력 경로
cp ~/.memento/data/memory.db ~/.memento/data/memory.db.before-rollback-$(date -u +%Y%m%dT%H%M%SZ).db
cp "$BACKUP" ~/.memento/data/memory.db

sqlite3 ~/.memento/data/memory.db "PRAGMA quick_check;"

docker compose up -d memento-mcp-server
```

이전 Docker 이미지로 되돌리려면 해당 태그/이미지 ID로 `docker compose up` 전에 이미지를 지정합니다.

---

## DB 손상 시 복구 (배포 실패·crash loop)

### 증상

- 컨테이너가 `database disk image is malformed` 등으로 **재시작 반복**
- `npm run db:pre-docker-deploy`에서 `quick_check` 실패

### 하지 말 것

| 방법 | 이유 |
|------|------|
| `sqlite3 .recover` 결과를 곧바로 `memory.db`로 교체 | 대부분 행이 누락될 수 있음 (실제 사례: 2만+건 → 10건) |
| 실행 중 DB를 `cp` / `copyFileSync`로 복사 | WAL 미반영·불완전 복사 위험 |
| 손상 파일을 그대로 production에 사용 | `quick_check` 실패; 추가 손상 가능 |

### 권장 복구

1. 손상본을 **이름 변경으로 보존** (`memory.db.pre-recover-<timestamp>.db`)
2. `scripts/restore-memory-db-from-corrupt.mjs`로 깨끗한 DB에 **테이블별 복사**

```bash
docker compose stop memento-mcp-server

node scripts/restore-memory-db-from-corrupt.mjs \
  --source ~/.memento/data/memory.db.pre-recover-<timestamp>.db \
  --target ~/.memento/data/memory-restored.db

sqlite3 ~/.memento/data/memory-restored.db "PRAGMA quick_check;"

# 확인 후 교체
cp ~/.memento/data/memory.db ~/.memento/data/memory.db.before-restore-$(date -u +%Y%m%dT%H%M%SZ).db
mv ~/.memento/data/memory-restored.db ~/.memento/data/memory.db

docker compose up -d memento-mcp-server
```

특정 테이블만 다시 합칠 때 (`memory_embedding` 등):

```bash
node scripts/restore-memory-db-from-corrupt.mjs \
  --source ~/.memento/data/memory.db.pre-recover-<timestamp>.db \
  --target ~/.memento/data/memory.db \
  --only-tables memory_embedding
```

`memory_embedding` 복구 시 vec0 트리거가 없는 환경에서는 스크립트가 트리거를 DROP한 뒤 복사합니다. 서버 재기동 시 마이그레이션·vec 인덱스가 다시 맞춰집니다.

손상본은 `~/.memento/data/quarantine/`에도 복사될 수 있습니다. crash loop 시 **15분 내 동일 크기 파일은 한 번만** quarantine에 저장됩니다.

---

## 재발 방지 요약

1. **배포 전** `npm run db:pre-docker-deploy` (이 문서의 표준 절차)
2. **Docker와 로컬 dev 동시 접근 금지** — 같은 `memory.db`에 writer 2개 금지
3. **정상 종료** — `docker compose stop` (kill -9 지양); `stop_grace_period: 30s` 활용
4. **백업 보관** — `~/.memento/data/backups/`에 타임스탬프 백업 유지; 오래된 quarantine 중복본은 정리 검토
5. **배포 전 환경변수** — [env-deployment-checklist.md](../env-deployment-checklist.md)

---

## 문제 해결

| 현상 | 조치 |
|------|------|
| `db:backup`이 빈 파일(0바이트) | `docker compose stop memento-mcp-server` 후 재실행 |
| `quick_check` 실패 | 위 [DB 손상 시 복구](#db-손상-시-복구-배포-실패crash-loop) 절차 |
| health는 ok인데 검색 품질 저하 | `memory_embedding` 건수 확인; `--only-tables memory_embedding` 병합 검토 |
| quarantine 디스크 과다 | pre-recover·최신 backup 확인 후 중복 quarantine 파일 정리 |

추가 Docker 설정은 [DOCKER_SETUP_GUIDE.md](../DOCKER_SETUP_GUIDE.md)를 참고하세요.
