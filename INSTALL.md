# 🚀 Memento MCP Server 설치 가이드

AI Agent 기억 보조 MCP 서버의 다양한 설치 방법을 제공합니다.

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

### 👨‍💻 **개발자/연구자**
- **npx 방식** 또는 **소스코드 방식** 권장
- 빠른 프로토타이핑과 디버깅에 최적화

### 👤 **일반 사용자**
- **원클릭 설치** 또는 **Docker 방식** 권장
- 간단한 설치와 안정적인 실행

### 🏢 **팀/조직**
- **Docker 방식** 필수
- 표준화된 배포와 확장성

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

### 2. npx 방식

#### 기본 사용법
```bash
# 개발 모드 (핫 리로드)
npx memento-mcp-server@latest dev

# 프로덕션 모드
npx memento-mcp-server@latest start

# HTTP/WebSocket 서버
npx memento-mcp-server@latest dev-http

# 자동 설정
npx memento-mcp-server@latest setup
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
npm run test:forgetting  # 망각 정책 테스트
npm run test:performance # 성능 벤치마크
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

- **MCP 서버**: `stdio` 또는 `ws://localhost:8080/mcp`
- **HTTP API**: `http://localhost:8080`
- **WebSocket**: `ws://localhost:8080`
- **관리 대시보드**: `http://localhost:8080/admin`

## 🚨 문제 해결

### 일반적인 문제들

#### 1. Node.js 버전 오류
```bash
# Node.js 20 이상 필요
node --version

# nvm으로 Node.js 설치 (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

#### 2. 포트 충돌
```bash
# 포트 8080이 사용 중인 경우
# .env 파일에서 PORT 변경
PORT=8081
```

#### 3. 데이터베이스 오류
```bash
# 데이터베이스 재초기화
rm -rf data/memory.db*
npm run db:init
```

#### 4. Docker 오류
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
- **개발자 가이드**: [docs/developer-guide.md](docs/developer-guide.md)
- **API 참조**: [docs/api-reference.md](docs/api-reference.md)

## 🎉 설치 완료!

설치가 완료되면 다음 단계를 진행하세요:

1. **서버 상태 확인**: `http://localhost:8080/health`
2. **MCP 클라이언트 연결**: [클라이언트 가이드](packages/mcp-client/README.md)
3. **API 테스트**: [API 문서](docs/api-reference.md)
4. **사용법 학습**: [사용자 매뉴얼](docs/user-manual.md)

---

**💡 팁**: 처음 사용하시는 경우 `npm run quick-start` 명령어로 모든 설정을 자동으로 완료할 수 있습니다!
