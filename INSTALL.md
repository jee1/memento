# 🚀 Memento MCP Server 설치 가이드

<div align="center">
  [🇰🇷 한국어](INSTALL.md) | [🇺🇸 English](INSTALL.en.md)
</div>

AI Agent 기억 보조 MCP 서버의 다양한 설치 방법을 제공합니다.

Memento를 설치하는 방법은 **얼마나 빨리 써 보고 싶은지**, **어디까지 직접 제어하고 싶은지**에 따라 달라집니다. 가장 빠른 길은 원클릭 스크립트이고, 패키지만 받아 바로 실행하려면 npx, 팀 배포와 격리가 필요하면 Docker, 코드까지 수정하려면 소스 클론이 맞습니다. 아래 순서대로 시도해 보시면 됩니다.

## 📋 설치 방법 선택

### 🥇 **1순위: 원클릭 설치 (권장)**
```bash
# 자동 설치 스크립트 실행
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

### 🥈 **2순위: npx 방식 (개발자용)**
```bash
# 즉시 실행 (설치 없이)
npx memento-mcp-server@latest dev

# 자동 설정 후 실행
npx memento-mcp-server@latest setup
npx memento-mcp-server@latest start
```

### 🥉 **3순위: Docker 방식 (프로덕션용)**
```bash
# 개발 환경
docker-compose -f docker-compose.dev.yml up -d

# 프로덕션 환경
docker-compose -f docker-compose.prod.yml up -d
```

### 🛠️ **4순위: 소스코드 방식 (개발자용)**
```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

# 원클릭 설치 및 실행
npm run quick-start
```

## 🎯 사용자별 권장 설치 방법

**개발자·연구자**는 npx나 소스 방식이 디버깅에 유리합니다. **일반 사용자**는 원클릭 설치나 Docker로 충분한 경우가 많고, **팀·조직**은 Docker로 환경을 표준화하는 편이 안전합니다.

## 📚 상세 설치 방법

### 1. 원클릭 설치

#### Linux/macOS
```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

#### Windows (PowerShell)
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/jee1/memento/main/install.sh" -OutFile "install.sh"
bash install.sh
```

### 2. npx 방식 (권장)

#### 기본 사용법
```bash
# 개발 모드 (핫 리로드)
npx memento-mcp-server@latest dev

# MCP 서버 실행
npx memento-mcp-server@latest

# 프로덕션 모드
npx memento-mcp-server@latest start

# HTTP/WebSocket 서버
npx memento-mcp-server@latest dev-http

# 자동 설정
npx memento-mcp-server@latest setup
```

#### npm exec 사용법
```bash
# 명령어를 명시적으로 지정해야 합니다
npm exec -- memento-mcp-server@latest dev
npm exec -- memento-mcp-server@latest setup

# 또는 간단하게 npx 사용 (권장)
npx memento-mcp-server@latest dev
```

#### 전역 설치
```bash
# 전역 설치
npm install -g memento-mcp-server

# 사용법
memento-mcp dev
memento-mcp start
memento-mcp setup
```

### 3. Docker 방식

#### 개발 환경
```bash
# 개발용 Docker Compose 실행
docker-compose -f docker-compose.dev.yml up -d

# 로그 확인
docker-compose -f docker-compose.dev.yml logs -f

# 중지
docker-compose -f docker-compose.dev.yml down
```

#### 프로덕션 환경
```bash
# 프로덕션용 Docker Compose 실행
docker-compose -f docker-compose.prod.yml up -d

# 로그 확인
docker-compose -f docker-compose.prod.yml logs -f

# 중지
docker-compose -f docker-compose.prod.yml down
```

#### 기본 Docker Compose
```bash
# 기본 실행 (프로덕션 모드)
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 중지
docker-compose down
```

### 4. 소스코드 방식

#### 기본 설치
```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

# 의존성 설치
npm install

# 자동 설정
npm run setup

# 개발 서버 시작
npm run dev
```

#### 원클릭 설치
```bash
# 모든 과정을 한 번에
npm run quick-start
```

## ⚙️ 환경 설정

### 환경 변수 설정
```bash
# .env 파일 생성
cp env.example .env

# API 키 설정 (선택사항)
# OPENAI_API_KEY=your_openai_api_key_here
# GEMINI_API_KEY=your_gemini_api_key_here
```

### 데이터베이스 초기화
```bash
# SQLite 데이터베이스 초기화
npm run db:init

# 마이그레이션 실행
npm run db:migrate
```

## 🔧 사용 가능한 명령어

### 개발 명령어
```bash
npm run dev              # MCP 서버 개발 모드
npm run dev:http         # HTTP/WebSocket 서버 개발 모드
npm run dev:http-v2      # HTTP 서버 v2 개발 모드
```

### 프로덕션 명령어
```bash
npm run build            # TypeScript 컴파일
npm run start            # MCP 서버 프로덕션 실행
npm run start:http       # HTTP/WebSocket 서버 프로덕션 실행
```

### 테스트 명령어
```bash
npm run test             # 모든 테스트 실행
npm run test:client      # 클라이언트 테스트
npm run test:search      # 검색 기능 테스트
npm run test:embedding   # 임베딩 기능 테스트
npm run test:lightweight-embedding # 경량 임베딩 테스트
npm run test:gemini-embedding # Gemini 임베딩 테스트
npm run test:forgetting  # 망각 정책 테스트
npm run test:performance # 성능 벤치마크
npm run test:monitoring  # 성능 모니터링 테스트
npm run test:error-logging # 에러 로깅 테스트
npm run test:performance-alerts # 성능 알림 테스트
npm run test:vector-search # 벡터 검색 테스트
npm run test:memory-injection # 메모리 주입 테스트
npm run test:batch-scheduler # 배치 스케줄러 테스트
npm run test:consolidation-quality # Consolidation Score 품질 검증
npm run benchmark:consolidation-quality # Consolidation Score 벤치마크
```

### Docker 명령어
```bash
npm run docker:dev       # 개발용 Docker 실행
npm run docker:prod      # 프로덕션용 Docker 실행
npm run docker:build     # Docker 이미지 빌드
npm run docker:logs      # Docker 로그 확인
```

### 유틸리티 명령어
```bash
npm run setup            # 자동 설정 실행
npm run quick-start      # 원클릭 설치 및 실행
npm run backup:embeddings # 임베딩 백업
npm run regenerate:embeddings # 임베딩 재생성
```

## 🌐 접속 정보

설치 완료 후 다음 주소로 접속할 수 있습니다:

- **MCP 서버**: `stdio` 또는 `http://localhost:9001/mcp`
- **HTTP API**: `http://localhost:9001`
- **WebSocket**: `ws://localhost:9001`
- **관리 대시보드**: `http://localhost:9001/dashboard`

## 🎯 Cursor MCP 설정

Cursor에서 Memento MCP Server를 사용하려면:

1. **프로젝트 빌드**
   ```bash
   npm install
   npm run build
   ```

2. **Cursor 설정 추가**
   - Cursor 설정 → MCP Servers에 추가
   - 또는 `.cursor/mcp.json` 파일 생성
   - 상세 가이드: [Cursor MCP 설정 가이드](docs/guides/ko/cursor-mcp-setup.md)

**빠른 설정 예시 (Windows):**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\git\\memento\\packages\\memento-server\\dist\\server\\index.js"]
    }
  }
}
```

> **참고**: `npx -y memento-mcp-server@latest` 방식이 실패하는 경우, 로컬 경로를 사용하는 방법을 권장합니다.

## 🪟 플랫폼별 실행 방법

### Windows

#### PowerShell/CMD
```powershell
# npx 방식 (권장)
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest setup

# npm exec 사용 시
npm exec -- memento-mcp-server@latest dev

# 전역 설치 후
npm install -g memento-mcp-server
memento-mcp-server dev
```

#### WSL (Windows Subsystem for Linux)
```bash
# Linux와 동일하게 사용
npx memento-mcp-server@latest dev
```

### Linux/macOS

```bash
# npx 방식 (권장)
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest setup

# npm exec 사용 시
npm exec -- memento-mcp-server@latest dev

# 전역 설치 후
npm install -g memento-mcp-server
memento-mcp-server dev
```

### 플랫폼별 차이점

| 항목 | Windows | Linux/macOS |
|------|---------|-------------|
| 경로 구분자 | `\` | `/` |
| 실행 권한 | 자동 처리 | `chmod +x` 필요 |
| Shebang | 무시됨 (npm이 처리) | 사용됨 |
| npm exec | 명령어 명시 필요 | 명령어 명시 필요 |
| npx | 권장 | 권장 |

## 🚨 문제 해결

### 일반적인 문제들

#### 1. npm exec 오류: "could not determine executable to run"

**원인**: npm exec는 실행할 명령어를 명시적으로 지정해야 합니다.

**해결 방법**:
```bash
# ❌ 잘못된 사용법
npm exec memento-mcp-server@latest

# ✅ 올바른 사용법
npm exec -- memento-mcp-server@latest dev
npm exec -- memento-mcp-server@latest setup

# 또는 npx 사용 (권장)
npx memento-mcp-server@latest dev
```

#### 2. Node.js 버전 오류
```bash
# Node.js 24 이상 필요 (package.json engines: >=24)
node --version

# nvm으로 Node.js 설치 (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 24
nvm use 24

# Windows에서 nvm 사용
# nvm-windows 설치: https://github.com/coreybutler/nvm-windows
nvm install 24
nvm use 24
```

#### 3. 포트 충돌
```bash
# 포트 9001이 사용 중인 경우
# .env 파일에서 PORT / MCP_SERVER_PORT 변경
PORT=9002
```

#### 4. 데이터베이스 오류
```bash
# Linux/macOS
rm -rf data/memory.db*
npm run db:init

# Windows (PowerShell)
Remove-Item data\memory.db* -Force
npm run db:init
```

#### 5. Node.js 버전으로 인한 SQLite 모듈 오류

**증상**: "SQLite를 사용할 수 없습니다" 또는 "Module not found: better-sqlite3" 오류

**원인**: Node.js 버전이 높거나 낮아서 네이티브 모듈이 빌드되지 않음

**해결 방법**:

```bash
# 방법 1: 네이티브 모듈 재빌드 (권장)
npm rebuild better-sqlite3 sqlite-vec

# 방법 2: 소스에서 빌드
npm install better-sqlite3 sqlite-vec --build-from-source

# 방법 3: Node.js 버전 확인 및 변경 (24.x 권장)
node --version  # 24.x 이상이어야 함

# 방법 4: 완전 재설치
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --build-from-source
```

**상세 가이드**: 
- [Node.js 버전 호환성 문제 해결 가이드](docs/operations/ko/troubleshooting-node-version.md)
- [npx 사용자 문제 해결 가이드](docs/operations/ko/npx-troubleshooting.md)

#### 6. Docker 오류
```bash
# Docker 컨테이너 완전 정리
docker-compose down -v
docker system prune -a
docker-compose up -d
```

### 로그 확인
```bash
# 애플리케이션 로그
tail -f logs/memento-server.log

# Docker 로그
docker-compose logs -f

# 시스템 로그 (Linux)
journalctl -u memento-mcp-server -f
```

## 📞 지원

- **이슈 리포트**: [GitHub Issues](https://github.com/jee1/memento/issues)
- **문서**: [Wiki](https://github.com/jee1/memento/wiki)
- **개발자 가이드**: [docs/guides/ko/developer-guide.md](docs/guides/ko/developer-guide.md)
- **API 참조**: [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)

## 🎉 설치 완료!

설치가 완료되면 다음 단계를 진행하세요:

1. **서버 상태 확인**: `http://localhost:9001/health`
2. **MCP 클라이언트 연결**: [클라이언트 가이드](packages/mcp-client/README.md)
3. **API 테스트**: [API 문서](docs/api/ko/api-reference.md)
4. **사용법 학습**: [사용자 매뉴얼](docs/guides/ko/user-manual.md)

---

**💡 팁**: 처음 사용하시는 경우 `npm run quick-start` 명령어로 모든 설정을 자동으로 완료할 수 있습니다!
