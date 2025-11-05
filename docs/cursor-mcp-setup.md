# Cursor MCP 설정 가이드

Cursor에서 Memento MCP Server를 사용하기 위한 설정 방법입니다.

## 🚨 문제 해결: "Cannot destructure property 'package' of 'node.target' as it is null"

이 오류는 `npx -y memento-mcp-server@latest`를 사용할 때 npm의 내부 오류로 발생할 수 있습니다.

## ✅ 해결 방법

### 방법 1: 로컬 경로 사용 (권장)

로컬에 클론한 프로젝트의 빌드된 파일을 직접 사용합니다.

#### 1. 프로젝트 빌드

```bash
# 프로젝트 디렉토리에서
npm install
npm run build
```

#### 2. Cursor MCP 설정

Cursor 설정 파일 (`.cursor/mcp.json` 또는 Cursor 설정에서)에 다음을 추가:

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

**Windows 경로 예시:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\git\\memento\\dist\\server\\index.js"]
    }
  }
}
```

**Linux/macOS 경로 예시:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/dist/server/index.js"]
    }
  }
}
```

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

### 방법 3: npm 캐시 정리 후 재시도

npm 캐시 문제일 수 있으므로 다음을 시도:

```bash
# npm 캐시 정리
npm cache clean --force

# 다시 시도
npx -y memento-mcp-server@latest
```

### 방법 4: 직접 npx 실행 스크립트 사용

Cursor 설정에서 직접 npx 명령을 실행:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"]
    }
  }
}
```

하지만 이 방법도 같은 오류가 발생할 수 있으므로 **방법 1 (로컬 경로)을 권장**합니다.

## 📋 전체 설정 예시

### Windows (PowerShell)

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

### Linux/macOS

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DATA_DIR": "/home/username/git/memento/data"
      }
    }
  }
}
```

## 🔍 문제 진단

### 1. 빌드 확인

```bash
# dist 디렉토리에 파일이 있는지 확인
ls dist/server/index.js  # Linux/macOS
dir dist\server\index.js  # Windows
```

### 2. Node.js 실행 확인

```bash
# 직접 실행 테스트
node dist/server/index.js
```

### 3. 로그 확인

Cursor의 MCP 로그를 확인하여 정확한 오류 메시지를 확인하세요.

## 🎯 권장 설정

**가장 안정적인 방법:**

1. 프로젝트를 로컬에 클론
2. `npm install && npm run build` 실행
3. Cursor 설정에서 로컬 경로 사용
4. Cursor 재시작

이 방법은 npm 레지스트리나 캐시 문제에 영향을 받지 않습니다.

