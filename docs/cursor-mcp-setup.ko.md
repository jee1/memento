# Cursor MCP 설정 가이드 (한국어)

Cursor에서 Memento MCP Server를 사용하기 위한 설정 방법입니다.

## 🚨 문제 해결: "Cannot destructure property 'package' of 'node.target' as it is null"

이 오류는 `npx -y memento-mcp-server@latest`를 사용할 때 npm의 내부 오류로 발생할 수 있습니다.

> **최신 업데이트**: 패키지에 `prepublishOnly` 스크립트와 bin 파일 검증을 추가하여 npm publish 시 빌드가 보장되도록 개선했습니다. 다음 버전부터는 더 안정적으로 작동할 예정입니다.

## ✅ 해결 방법

### 방법 1: 로컬 경로 사용 (권장) ⭐

로컬에 클론한 프로젝트의 빌드된 파일을 직접 사용합니다.

#### 1. 프로젝트 빌드

```bash
# 프로젝트 디렉토리에서
cd C:\Users\jee1l\git\memento
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
      "args": ["C:\\Users\\jee1l\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production"
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
      "args": ["/home/username/git/memento/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

> **참고**: 경로를 실제 프로젝트 경로로 변경하세요.

### 방법 2: 전역 설치 후 사용

#### 1. 전역 설치

```bash
npm install -g memento-mcp-server
```

#### 2. Cursor MCP 설정

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server"
    }
  }
}
```

### 방법 3: npm 캐시 정리

npm 캐시 문제일 수 있으므로:

```bash
# npm 캐시 정리
npm cache clean --force

# Node.js 버전 확인 (20 이상 필요)
node --version

# 다시 시도
npx -y memento-mcp-server@latest
```

## 📋 상세 설정 예시

### Windows (완전한 예시)

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\jee1l\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DATA_DIR": "C:\\Users\\jee1l\\git\\memento\\data"
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
      "args": ["./dist/server/index.js"],
      "cwd": "C:\\Users\\jee1l\\git\\memento"
    }
  }
}
```

## 🔍 문제 진단

### 1. 빌드 확인

```bash
# Windows
dir dist\server\index.js

# Linux/macOS
ls -la dist/server/index.js
```

### 2. 직접 실행 테스트

```bash
# 프로젝트 디렉토리에서
node dist/server/index.js
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
   cd C:\Users\jee1l\git\memento
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
      "args": ["C:\\Users\\jee1l\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DATA_DIR": "C:\\Users\\jee1l\\git\\memento\\data",
        "OPENAI_API_KEY": "your-key-here",
        "GEMINI_API_KEY": "your-key-here"
      }
    }
  }
}
```

### 디버깅 모드

개발 중이라면 소스 파일을 직접 실행:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "tsx", "src/server/index.ts"],
      "cwd": "C:\\Users\\jee1l\\git\\memento"
    }
  }
}
```

## ⚠️ 주의사항

- Windows에서는 경로에 백슬래시(`\`)를 두 개(`\\`)로 이스케이프해야 합니다.
- 절대 경로를 사용하는 것이 가장 안정적입니다.
- `npx`를 사용하는 방법은 npm 캐시 문제로 실패할 수 있으므로 로컬 경로 사용을 권장합니다.

