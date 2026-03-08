# Cursor MCP 설정 가이드 (한국어)

Cursor에서 Memento MCP Server를 사용하기 위한 설정 방법입니다.

## 🚨 문제 해결

### "Cannot find module '.../dist/server/index.js'" 또는 "packages/memento-server/dist/..."

로컬 경로로 MCP를 설정했는데 위와 같은 오류가 나면 **빌드 산출물이 없거나 오래된 경우**입니다. 서버 빌드 결과는 `packages/memento-server/dist/`에 생성되며, Git에 포함되지 않으므로 `npm run build`를 해야 합니다.

**해결**: 프로젝트 루트에서 다음을 실행한 뒤 Cursor를 다시 시작하거나 MCP 서버를 재연결하세요.

```bash
npm install
npm run build
```

빌드가 성공하면 `packages/memento-server/dist/server/index.js`가 생성됩니다. Cursor MCP가 참조하는 경로가 이 파일을 가리키는지 확인하세요.

### "Cannot destructure property 'package' of 'node.target' as it is null"

이 오류는 `npx -y memento-mcp-server@latest`를 사용할 때 npm의 내부 오류로 발생할 수 있습니다.

> **최신 업데이트**: 패키지에 `prepublishOnly` 스크립트와 bin 파일 검증을 추가하여 npm publish 시 빌드가 보장되도록 개선했습니다. 다음 버전부터는 더 안정적으로 작동할 예정입니다.

## ✅ 해결 방법

### 방법 1: 로컬 경로 사용 (권장) ⭐

로컬에 클론한 프로젝트의 빌드된 파일을 직접 사용합니다.

#### 1. 프로젝트 빌드

```bash
# 프로젝트 디렉토리에서
cd C:\Users\username\git\memento
npm install
npm run build
```

#### 2. Cursor MCP 설정

Cursor 설정 파일 또는 `.cursor/mcp.json`에 다음을 추가:

**Windows:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\packages\\memento-server\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db"
      }
    }
  }
}
```

**Linux/macOS:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db"
      }
    }
  }
}
```

> **참고**: 경로를 실제 프로젝트 경로로 변경하세요.

### 방법 2: npx로 직접 실행 (간단한 방법)

npx를 사용하여 패키지를 다운로드 없이 직접 실행할 수 있습니다.

#### Cursor MCP 설정

Cursor 설정 파일 또는 `.cursor/mcp.json`에 다음을 추가:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **DB_PATH 설정 참고**:
> - 기본값: `./data/memory.db` (현재 작업 디렉토리 기준)
> - Windows 절대 경로 예시: `"DB_PATH": "C:\\Users\\username\\memento\\data\\memory.db"`
> - Linux/macOS 절대 경로 예시: `"DB_PATH": "/home/username/memento/data/memory.db"`
> - 상대 경로는 npx 실행 시 작업 디렉토리에 따라 달라질 수 있으므로, 절대 경로 사용을 권장합니다.

> **참고**: 
> - `-y` 플래그는 패키지 설치 확인을 자동으로 승인합니다.
> - `@latest`는 최신 버전을 사용합니다. 특정 버전을 사용하려면 `@1.0.0` 형식으로 지정할 수 있습니다.
> - 첫 실행 시 패키지가 자동으로 다운로드됩니다.

#### 장점
- 별도의 설치 과정이 필요 없습니다
- 항상 최신 버전을 사용할 수 있습니다
- 전역 설치 없이 사용 가능합니다

#### 단점
- 첫 실행 시 다운로드 시간이 소요될 수 있습니다
- npm 캐시 문제로 실패할 수 있습니다 (이 경우 방법 4 참고)

### 방법 3: 전역 설치 후 사용

#### 1. 전역 설치

```bash
npm install -g memento-mcp-server
```

#### 2. Cursor MCP 설정

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **DB_PATH 설정 참고**: 전역 설치 시에도 DB_PATH를 명시적으로 설정하는 것을 권장합니다. 절대 경로 사용을 권장합니다.

### 방법 4: 문제 해결 (npm 캐시 정리)

npx 사용 시 "Cannot destructure property 'package' of 'node.target' as it is null" 오류가 발생하는 경우:

```bash
# npm 캐시 정리
npm cache clean --force

# Node.js 버전 확인 (20 이상 필요)
node --version

# 다시 시도
npx -y memento-mcp-server@latest
```

여전히 문제가 발생한다면 방법 1 (로컬 경로 사용)을 권장합니다.

## 📋 상세 설정 예시

### Windows (완전한 예시)

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\packages\\memento-server\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db"
      }
    }
  }
}
```

### 상대 경로 사용 (프로젝트 내에서)

프로젝트 루트에 `.cursor/mcp.json` 파일을 생성:

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["./packages/memento-server/dist/server/index.js"],
      "cwd": "C:\\Users\\username\\git\\memento",
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **참고**: `cwd`가 설정되어 있으므로 `DB_PATH`는 상대 경로로도 사용 가능합니다. 하지만 절대 경로 사용을 권장합니다.

## 🔍 문제 진단

### 1. 빌드 확인

```bash
# Windows
dir dist\server\index.js

# Linux/macOS
ls -la packages/memento-server/dist/server/index.js
```

### 2. 직접 실행 테스트

```bash
# 프로젝트 디렉토리에서
node packages/memento-server/dist/server/index.js
```

정상적으로 실행되면 MCP 서버가 시작됩니다.

### 3. Node.js 버전 확인

```bash
node --version  # 20.0.0 이상이어야 함
```

### 4. 의존성 확인

```bash
npm install
npm run build
```

## 🎯 권장 설정 순서

1. ✅ 프로젝트 클론 (이미 완료)
   ```bash
   cd C:\Users\username\git\memento
   ```

2. ✅ 의존성 설치 및 빌드
   ```bash
   npm install
   npm run build
   ```

3. ✅ Cursor 설정에 로컬 경로 추가
   - Cursor 설정 → MCP Servers
   - 또는 `.cursor/mcp.json` 파일 생성

4. ✅ Cursor 재시작

5. ✅ 연결 테스트

## 💡 추가 팁

### 환경 변수 설정

특정 환경 변수가 필요한 경우:

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\packages\\memento-server\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db",
        "OPENAI_API_KEY": "your-key-here",
        "GEMINI_API_KEY": "your-key-here",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### 주요 환경 변수 설명

- **DB_PATH** (필수 권장): 데이터베이스 파일 경로
  - 기본값: `./data/memory.db`
  - Windows 예시: `C:\\Users\\username\\memento\\data\\memory.db`
  - Linux/macOS 예시: `/home/username/memento/data/memory.db`
  - 절대 경로 사용을 권장합니다 (상대 경로는 실행 위치에 따라 달라질 수 있음)

- **NODE_ENV**: 실행 환경 (`development` 또는 `production`)
- **OPENAI_API_KEY**: OpenAI API 키 (OpenAI 임베딩 사용 시)
- **GEMINI_API_KEY**: Google Gemini API 키 (Gemini 임베딩 사용 시)
- **EMBEDDING_PROVIDER**: 임베딩 제공자 (`tfidf`, `lightweight`, `minilm`, `openai`, `gemini`)
- **LOG_LEVEL**: 로그 레벨 (`debug`, `info`, `warn`, `error`)

### 디버깅 모드

개발 중이라면 소스 파일을 직접 실행:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "tsx", "packages/memento-server/src/server/index.ts"],
      "cwd": "C:\\Users\\username\\git\\memento",
      "env": {
        "NODE_ENV": "development",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## ⚠️ 주의사항

- Windows에서는 경로에 백슬래시(`\`)를 두 개(`\\`)로 이스케이프해야 합니다.
- 절대 경로를 사용하는 것이 가장 안정적입니다.
- `npx`를 사용하는 방법은 간편하지만, npm 캐시 문제로 실패할 수 있습니다. 이 경우 방법 1 (로컬 경로 사용)을 권장합니다.
- 방법 2 (npx)는 첫 실행 시 패키지를 다운로드하므로 인터넷 연결이 필요합니다.
- **DB_PATH 설정**: 데이터베이스 파일 경로를 명시적으로 설정하는 것을 권장합니다. 설정하지 않으면 기본값(`./data/memory.db`)이 사용되지만, 실행 위치에 따라 예상치 못한 위치에 데이터베이스가 생성될 수 있습니다.
- **데이터베이스 디렉토리**: DB_PATH에 지정한 디렉토리가 존재하지 않으면 자동으로 생성됩니다. 하지만 쓰기 권한이 필요하므로 적절한 위치를 지정하세요.

