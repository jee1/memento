# 🐳 Memento Docker 설정 가이드

## 📋 현재 상태
- ✅ 도커 설정 완료 (MCP 서버용)
- ✅ MCP 클라이언트 분리 완료
- ✅ 데이터 백업 완료 (473개 기억)
- ✅ mcp.json 설정 업데이트 완료

## 🚀 Docker Desktop 시작 후 실행할 명령어

### 1단계: Docker Desktop 시작
- Windows 시작 메뉴에서 "Docker Desktop" 검색 후 실행
- Docker Desktop이 완전히 시작될 때까지 대기

### 2단계: 자동 설정 실행
```bash
# 방법 1: 배치 파일 실행 (권장)
start-docker-setup.bat

# 방법 2: 수동 실행
docker-compose build
docker-compose up -d
```

**📁 데이터 마운트 방식:**
- 기본 설정은 호스트 `${HOME}/.memento/data` → 컨테이너 `/app/data`로 마운트됩니다 (`docker-compose.base.yml` 참고)
- 로그는 호스트 `${HOME}/.memento/logs` → 컨테이너 `/app/logs`로 마운트됩니다
- 파일 복사 없이 실시간 동기화되며, 컨테이너 재시작 후에도 유지됩니다

### 3단계: 설정 확인
```bash
# 컨테이너 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs memento-mcp-server

# 데이터베이스 확인
docker exec memento-mcp-server sqlite3 /app/data/memory.db "SELECT COUNT(*) FROM memory_item;"

# 서버 접속 테스트
curl http://localhost:9001/health
```

## 🧪 진단 모드

Docker Desktop이 일정 시간 뒤 죽거나 멈추는 문제를 재현할 때는 앱 내부 진단 로그와 Docker 외부 관측 로그를 같이 수집해야 합니다.

### 앱 내부 진단 활성화
```bash
DIAGNOSTICS_ENABLED=true \
DIAGNOSTICS_INTERVAL_MS=10000 \
docker-compose up -d
```

- 앱 내부 JSONL 로그는 `${HOME}/.memento/logs/diagnostics` 아래에 기록됩니다.
- Docker 외부 관측은 별도 터미널에서 아래 스크립트로 수집합니다.

```bash
./scripts/collect-docker-diagnostics.sh memento-mcp-server
```

기본 출력 위치는 `${HOME}/.memento/logs/docker-diagnostics`입니다.

### 실험 프로파일
1. **기준선**: 모든 기능 활성화
2. **배치 차단**: `BATCH_SCHEDULER_ENABLED=false`
3. **DB 모니터 차단**: `WAL_CHECKPOINT_ENABLED=false` + `DB_LOCK_MONITOR_ENABLED=false`
4. **전부 차단**: 위 세 플래그 모두 `false`

예시:
```bash
DIAGNOSTICS_ENABLED=true \
DIAGNOSTICS_INTERVAL_MS=10000 \
BATCH_SCHEDULER_ENABLED=false \
docker-compose up -d
```

### 수집 파일
- `${HOME}/.memento/logs/diagnostics/app-runtime.jsonl`: 메모리/상태 샘플
- `${HOME}/.memento/logs/diagnostics/app-events.jsonl`: 서버/배치/모니터 lifecycle 이벤트
- `${HOME}/.memento/logs/docker-diagnostics/docker-stats.jsonl`: 컨테이너 CPU/메모리
- `${HOME}/.memento/logs/docker-diagnostics/docker-inspect.jsonl`: 컨테이너 상태/재시작 카운트
- `${HOME}/.memento/logs/docker-diagnostics/docker-log-size.jsonl`: Docker json-file 로그 크기
- `${HOME}/.memento/logs/docker-diagnostics/docker-disk.log`: Docker 전체 디스크 사용량 스냅샷

## 🔧 문제 해결

### Docker Desktop이 시작되지 않는 경우
1. Windows 재시작
2. Docker Desktop 재설치
3. WSL2 업데이트

### Docker가 “어느 순간” 죽거나(데몬/Desktop 재시작) 멈추는 경우
대부분 **리소스 고갈**(특히 Docker 엔진 내부 컨테이너 로그 파일의 디스크 고갈, 또는 OOM)로 발생합니다.

1) **컨테이너 로그 크기 확인**
```bash
docker ps
docker logs --tail=200 memento-mcp-server
docker inspect memento-mcp-server --format '{{.LogPath}}'
```
`LogPath`에 해당하는 파일이 비정상적으로 커지면 Docker Desktop/daemon이 불안정해질 수 있습니다.

2) **디스크/이미지 정리(필요 시)**
```bash
docker system df
docker system prune
```

3) **로그 로테이션 적용 여부 확인**
- 현재 `docker-compose.base.yml`의 `memento-base`에 `json-file` 로그 로테이션(`max-size`, `max-file`)이 설정되어 있어야 합니다.
- 오래된 설정으로 실행 중이면 `docker-compose down` 후 다시 `up -d`로 재기동하세요.

### 컨테이너가 시작되지 않는 경우
```bash
# 로그 확인
docker-compose logs memento-mcp-server

# 컨테이너 재시작
docker-compose restart memento-mcp-server
```

### 데이터가 보이지 않는 경우
```bash
# 마운트 확인
docker inspect memento-mcp-server | grep -A 5 "Mounts"

# 데이터 디렉토리 확인
docker exec memento-mcp-server ls -la /app/data

# 호스트 데이터 확인
dir ".\data"
```

## 📊 현재 데이터 상태
- **총 기억 수**: 473개
- **일화기억**: 357개
- **의미기억**: 105개
- **절차기억**: 7개
- **작업기억**: 4개

## 🎯 완료 후 확인사항
1. Cursor에서 Memento MCP 서버 연결 확인
2. 기억 검색 기능 테스트
3. 새 기억 저장 테스트
4. 도커 재시작 후 데이터 유지 확인
