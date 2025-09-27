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
- 호스트 `./data` 폴더가 컨테이너 `/app/data`에 직접 마운트됩니다
- 파일 복사 없이 실시간 동기화됩니다
- 컨테이너 재시작해도 데이터가 유지됩니다

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

## 🔧 문제 해결

### Docker Desktop이 시작되지 않는 경우
1. Windows 재시작
2. Docker Desktop 재설치
3. WSL2 업데이트

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
