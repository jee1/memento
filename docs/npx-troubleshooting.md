# npx 사용자 문제 해결 가이드

npx를 통해 `memento-mcp-server`를 실행하는 일반 사용자를 위한 문제 해결 가이드입니다.

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

