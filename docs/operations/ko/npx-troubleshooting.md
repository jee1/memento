# npx 사용자 문제 해결 가이드

`npx memento-mcp-server@latest`로 서버를 띄울 때는 **매 실행마다 임시 캐시**를 쓰기 때문에, Node 버전·네이티브 모듈·경로 문제가 로컬 클론과 다르게 나타날 수 있습니다. 이 가이드는 그때 흔한 증상과 복구 순서를 정리합니다. 반복 사용이면 글로벌 설치나 소스 클론을 검토하세요.

## 🚨 일반적인 문제들

### 1. SQLite 모듈 오류 (Node.js 버전 문제)

**증상:**
```
Error: Cannot find module 'better-sqlite3'
또는
Error: The module 'better-sqlite3' was compiled against a different Node.js version
```

**원인:** Node.js 버전이 높거나 낮아서 네이티브 모듈이 빌드되지 않음

**해결 방법:**

#### 방법 1: 자동 재빌드 (권장)

npx 실행 시 자동으로 재빌드를 시도합니다. 만약 실패하면:

```bash
# npx 캐시 위치 찾기 (Windows)
# 보통: C:\Users\YOUR_USERNAME\AppData\Local\npm-cache\_npx\

# npx 캐시 위치 찾기 (Linux/macOS)
# 보통: ~/.npm/_npx/

# 캐시 삭제 후 재시도
npx --yes memento-mcp-server@latest
```

#### 방법 2: Node.js 버전 확인 및 변경

```bash
# 현재 버전 확인
node --version

# Node.js 20.x 권장 (LTS)
# nvm 사용 (Linux/macOS)
nvm install 20
nvm use 20

# nvm-windows 사용 (Windows)
# https://github.com/coreybutler/nvm-windows/releases
nvm install 20.18.0
nvm use 20.18.0
```

#### 방법 3: 전역 설치 후 사용

```bash
# 전역 설치
npm install -g memento-mcp-server

# 사용
memento-mcp-server

# 또는 재빌드 후 사용
npm rebuild -g better-sqlite3 sqlite-vec
memento-mcp-server
```

### 2. npx 실행 시 "could not determine executable to run"

**증상:**
```
npm error could not determine executable to run
```

**해결 방법:**
```bash
# 명령어를 명시적으로 지정
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest setup

# 또는 간단하게
npx memento-mcp-server@latest
```

### 3. 개발 도구 누락 오류

**증상:**
```
gyp ERR! stack Error: node-gyp failed
또는
Error: missing required build tools
```

**해결 방법:**

#### Windows
```powershell
# Windows Build Tools 설치
npm install --global windows-build-tools

# 또는 Visual Studio Build Tools 설치
# https://visualstudio.microsoft.com/downloads/
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    build-essential
```

#### macOS
```bash
# Xcode Command Line Tools 설치
xcode-select --install

# 또는 Homebrew로
brew install python3 sqlite3
```

### 4. CI 빌드/npx 실행 시 initializing에서 "Connection closed" / "Client closed"

**증상 (Cursor MCP 로그):**
```
Starting new stdio process with command: npx -y memento-mcp-server@next
Server creation in progress, waiting for completion
[V1] initializing -> error: Client closed
Pending server creation failed: MCP error -32000: Connection closed
```

**근본 원인:**  
서버가 MCP transport를 먼저 연결한 뒤, DB·서비스 초기화(`runHeavyInit`)를 백그라운드에서 수행합니다. 이 초기화가 실패하면(DB 경로·권한, 설정 검증, better-sqlite3 등) 기존에는 `process.exit(1)`로 프로세스가 종료되어, 이미 연결된 클라이언트 입장에서 연결이 끊긴 것처럼 보입니다. 이전 버전은 무거운 초기화를 먼저 했기 때문에 실패 시 connect 전에 종료되어 증상이 다르게 나타났습니다.

**해결 방법:**

1. **초기화 실패 원인 확인**  
   터미널에서 직접 실행해 stderr 메시지를 확인하세요.
   ```bash
   npx -y memento-mcp-server@latest
   ```
   `[ERROR] MCP Server Initialization Failed` 다음에 나오는 `Error:` / `Stack:` 내용을 확인하면, DB_PATH·설정·네이티브 모듈 등 실패 원인을 알 수 있습니다.

2. **서버 동작 변경 (v1.17.0 이후)**  
   초기화 실패 시에도 프로세스는 종료하지 않고, MCP 연결은 유지됩니다. 도구 호출 시 초기화 실패 에러가 반환되므로, 위 1번으로 원인을 해결한 뒤 다시 시도하면 됩니다.

3. **환경 점검**  
   - `DB_PATH`(또는 기본값 `./data/memory.db`)에 대한 쓰기 권한  
   - `validateConfig` 실패 시: 환경 변수·설정 검증 메시지 확인  
   - better-sqlite3: Node 버전·플랫폼 일치 여부 ([일반적인 문제](#1-sqlite-모듈-오류-nodejs-버전-문제) 참고)

## 🔍 문제 진단

### 1. Node.js 버전 확인
```bash
node --version  # 20.x 이상 권장
npm --version
```

### 2. npx 캐시 확인
```bash
# 캐시 위치 확인
npm config get cache

# 캐시 삭제 (필요시)
npm cache clean --force
```

### 3. 네이티브 모듈 테스트
```bash
# 임시 디렉토리에서 테스트
cd /tmp  # 또는 임시 디렉토리
npx --yes memento-mcp-server@latest

# 또는 직접 테스트
node -e "require('better-sqlite3')"
```

## ✅ 빠른 해결 체크리스트

1. ✅ Node.js 버전 확인 (20.x 권장)
2. ✅ 개발 도구 설치 확인
3. ✅ npx 캐시 삭제 후 재시도
4. ✅ 전역 설치 시도
5. ✅ 상세 오류 로그 확인

## 💡 npx 사용 팁

### 캐시 사용 안 함 (항상 최신 버전)
```bash
npx --yes memento-mcp-server@latest
```

### 특정 버전 사용
```bash
npx memento-mcp-server@1.6.0
```

### 캐시 삭제 후 실행
```bash
# Windows PowerShell
Remove-Item -Recurse -Force "$env:APPDATA\npm-cache\_npx"

# Linux/macOS
rm -rf ~/.npm/_npx

# 그 후 재시도
npx --yes memento-mcp-server@latest
```

## 🆘 추가 도움

문제가 지속되면:
1. GitHub Issues에 보고
2. 다음 정보 포함:
   - Node.js 버전 (`node --version`)
   - npm 버전 (`npm --version`)
   - OS 정보
   - 전체 오류 로그
   - npx 실행 명령어

## 📋 Node.js 버전별 호환성

| Node.js 버전 | npx 지원 | 권장 |
|-------------|----------|------|
| 18.x | ⚠️ 제한적 | 권장하지 않음 |
| **20.x LTS** | ✅ 완전 지원 | **권장** |
| 22.x | ✅ 지원 | 지원 |
| 23.x+ | ⚠️ 테스트 필요 | 확인 필요 |

