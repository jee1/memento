# Node.js 버전 호환성 문제 해결 가이드

## 🚨 문제: "SQLite를 사용할 수 없습니다" 또는 네이티브 모듈 빌드 오류

Node.js 버전이 높거나 낮을 때 `better-sqlite3`나 `sqlite-vec` 같은 네이티브 모듈이 제대로 빌드되지 않을 수 있습니다.

## ✅ 해결 방법

### 방법 1: 네이티브 모듈 재빌드 (권장)

#### Windows
```powershell
# 의존성 재빌드
npm rebuild better-sqlite3 sqlite-vec

# 또는 전체 재빌드
npm rebuild
```

#### Linux/macOS
```bash
# 의존성 재빌드
npm rebuild better-sqlite3 sqlite-vec

# 또는 전체 재빌드
npm rebuild
```

### 방법 2: Node.js 버전 확인 및 변경

#### 현재 Node.js 버전 확인
```bash
node --version
```

#### 권장 Node.js 버전
- **최소 버전**: Node.js 24.0.0
- **권장 버전**: Node.js 24.x LTS (또는 최신 Current)

#### nvm으로 Node.js 버전 관리 (Linux/macOS)
```bash
# nvm 설치 (이미 설치되어 있다면 생략)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Node.js 24 LTS 설치
nvm install 24
nvm use 24
nvm alias default 24
```

#### nvm-windows로 Node.js 버전 관리 (Windows)
```powershell
# nvm-windows 설치: https://github.com/coreybutler/nvm-windows/releases

# Node.js 24 LTS 설치
nvm install 24
nvm use 24
```

### 로컬 검증 (저장소 `.nvmrc`)

루트 `.nvmrc`는 major `24`를 가리킵니다. nvm 사용 시 디렉터리 진입 후:

```bash
nvm use          # .nvmrc → 24
nvm alias default 24   # 선택: 기본값도 24로
node -v          # v24.x 여야 함
which node       # nvm 경로인지 확인
npm run rebuild-native
```

**주의:** Cursor agent 등 IDE 번들 Node가 PATH에서 nvm보다 앞에 있으면 `which node` / `node -v`만으로 오판할 수 있습니다. 에이전트 셸과 일반 터미널을 각각 확인하세요. Node major를 바꾼 뒤에는 반드시 `npm run rebuild-native`로 `better-sqlite3`·`sqlite-vec` ABI를 맞추세요.

### 방법 3: 소스에서 빌드

네이티브 모듈을 소스에서 빌드하여 설치:

```bash
# better-sqlite3 소스에서 빌드
npm install better-sqlite3 --build-from-source

# sqlite-vec 소스에서 빌드
npm install sqlite-vec --build-from-source

# 또는 전체 재설치
rm -rf node_modules package-lock.json
npm install --build-from-source
```

### 방법 4: 개발 도구 설치 (필요 시)

네이티브 모듈 빌드에 필요한 개발 도구가 설치되어 있어야 합니다.

#### Windows
```powershell
# Visual Studio Build Tools 설치 필요
# 또는 Windows Build Tools 설치
npm install --global windows-build-tools
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

### 방법 5: 완전 재설치

모든 것을 초기화하고 다시 설치:

```bash
# 1. node_modules 및 캐시 삭제
rm -rf node_modules package-lock.json
npm cache clean --force

# 2. Node.js 버전 확인 (24.x 권장)
node --version

# 3. 재설치 (소스에서 빌드)
npm install --build-from-source

# 4. 빌드
npm run build
```

## 🔍 문제 진단

### 1. 에러 메시지 확인

일반적인 에러 메시지:
- `Module not found: Can't resolve 'better-sqlite3'`
- `Error: Cannot find module 'better-sqlite3'`
- `gyp ERR! stack Error: node-gyp failed`
- `Error: The module 'better-sqlite3' was compiled against a different Node.js version`

### 2. Node.js 버전 확인
```bash
node --version
npm --version
```

### 3. 네이티브 모듈 상태 확인
```bash
# better-sqlite3 확인
node -e "require('better-sqlite3')"

# sqlite-vec 확인
node -e "require('sqlite-vec')"
```

## 📋 Node.js 버전별 호환성

| Node.js 버전 | better-sqlite3 | sqlite-vec | 상태 |
|-------------|----------------|------------|------|
| ≤22.x | ⚠️ ABI 불일치 가능 | ⚠️ | `engines.node`≥24와 불일치 — 사용 금지 |
| **24.x** | ✅ | ✅ | **권장** (`engines`·CI·Docker) |
| 25.x+ | ⚠️ 테스트 필요 | ⚠️ | major 전환 후 `rebuild-native` 필수 |

## 🎯 빠른 해결 체크리스트

1. ✅ Node.js 버전 확인 (**24.x 권장**)
2. ✅ 개발 도구 설치 확인
3. ✅ 네이티브 모듈 재빌드 시도
4. ✅ 소스에서 빌드 시도
5. ✅ 완전 재설치 시도

## 💡 예방 방법

### package.json에 postinstall 스크립트 추가

자동으로 네이티브 모듈을 재빌드하도록 설정할 수 있습니다:

```json
{
  "scripts": {
    "postinstall": "npm rebuild better-sqlite3 sqlite-vec || true"
  }
}
```

> **참고**: `|| true`는 빌드 실패 시에도 설치를 계속 진행합니다.

## 🆘 추가 도움

문제가 지속되면:
1. GitHub Issues에 에러 로그와 함께 보고
2. Node.js 버전, OS 정보 포함
3. `npm install` 전체 로그 제공

