# Cursor MCP 설정 가이드

Cursor에서 Memento MCP Server를 연결하는 방법을 설명합니다. Memento는 주로 **stdio MCP** 방식으로 연결하며, 로컬에 클론한 저장소의 빌드 산출물 또는 npm 패키지를 `node`로 직접 실행합니다. Docker로 서버를 운영하는 경우에는 HTTP URL로 연결할 수도 있습니다.

## 먼저 확인할 것: 빌드 산출물

Memento의 서버 진입점은 `packages/memento-server/dist/server/index.js`입니다. 이 파일은 Git에 포함되지 않으므로, 로컬 경로 방식을 사용하기 전에 반드시 먼저 빌드해야 합니다.

```bash
npm install
npm run build
```

빌드가 성공하면 `packages/memento-server/dist/server/index.js`가 생성됩니다. Cursor MCP 설정에 지정한 경로가 이 파일을 가리키는지 확인하세요.

## 방법 1: 로컬 경로 사용 (권장)

로컬에 클론한 저장소의 빌드된 파일을 직접 사용하는 방식입니다. 네트워크나 npm 캐시에 의존하지 않으므로 가장 안정적입니다.

Cursor 설정 파일 또는 `.cursor/mcp.json`에 다음을 추가합니다.

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

경로는 실제 프로젝트 위치에 맞게 수정하세요. Windows에서는 백슬래시를 `\\`로 이스케이프해야 합니다.

프로젝트 내부에 `.cursor/mcp.json`을 두고 `cwd`를 명시하면 상대 경로도 사용할 수 있습니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["./packages/memento-server/dist/server/index.js"],
      "cwd": "/home/username/git/memento",
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db"
      }
    }
  }
}
```

## 방법 2: npx로 직접 실행

npm 패키지를 별도로 설치하지 않고 `npx`로 바로 실행하는 방식입니다. 설정이 간단하지만, npm 캐시 문제가 발생할 수 있으므로 문제가 생기면 방법 1로 전환하는 것을 권장합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/home/username/memento/data/memory.db"
      }
    }
  }
}
```

`DB_PATH`는 절대 경로를 사용하는 것을 강력히 권장합니다. 상대 경로를 쓰면 `npx` 실행 시 작업 디렉터리에 따라 데이터베이스가 예상치 못한 위치에 생성될 수 있습니다.

`-y` 플래그는 패키지 설치 확인을 자동 승인하고, `@latest`는 최신 버전을 사용합니다. 특정 버전을 고정하려면 `@1.0.0` 형식으로 지정하세요. 첫 실행 시 패키지 다운로드 시간이 소요됩니다.

## 방법 3: 전역 설치 후 사용

```bash
npm install -g memento-mcp-server
```

전역 설치 후에는 `command`에 `memento-mcp-server`를 지정합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "/home/username/memento/data/memory.db"
      }
    }
  }
}
```

## 방법 4: Docker 방식 (운영 환경)

Docker 컨테이너로 서버를 실행하는 경우, HTTP/SSE 서버로 동작하므로 `command` 대신 `url`로 연결합니다.

먼저 컨테이너가 실행 중인지 확인합니다.

```bash
docker ps | grep memento
curl http://localhost:9001/health
```

`.cursor/mcp.json` 또는 Cursor 전역 설정에 URL을 추가합니다.

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:9001/mcp"
    }
  }
}
```

포트를 변경했다면 `9001`을 해당 포트 값으로 바꾸세요(`MCP_SERVER_PORT` 환경 변수 기준).

Docker 컨테이너 시작과 중지는 다음과 같이 합니다.

```bash
# 시작
docker compose up -d

# 로그 확인
docker compose logs -f

# 중지
docker compose down
```

Cursor를 재시작하거나 MCP 서버를 재연결하기 전에 컨테이너가 반드시 실행 중이어야 합니다.

## 문제 진단

### "Cannot find module '.../dist/server/index.js'"

빌드 산출물이 없거나 오래된 경우입니다. 프로젝트 루트에서 다음을 실행한 뒤 Cursor를 재시작하세요.

```bash
npm install
npm run build
```

빌드 결과를 직접 확인하려면 다음을 실행합니다.

```bash
# Linux/macOS
ls -la packages/memento-server/dist/server/index.js

# Windows
dir packages\memento-server\dist\server\index.js
```

### "Cannot destructure property 'package' of 'node.target' as it is null"

`npx -y memento-mcp-server@latest`를 사용할 때 npm 내부 오류로 발생할 수 있습니다. npm 캐시를 정리한 뒤 재시도하세요.

```bash
npm cache clean --force
node --version  # 20.0.0 이상이어야 합니다
npx -y memento-mcp-server@latest
```

문제가 계속되면 방법 1(로컬 경로 사용)로 전환하는 것을 권장합니다.

### 직접 실행 테스트

Cursor 설정과 무관하게 서버가 정상적으로 뜨는지 확인하려면 다음을 실행합니다.

```bash
node packages/memento-server/dist/server/index.js
```

오류 없이 프로세스가 실행되면 MCP 서버가 정상입니다.

## 환경 변수 설정

특정 기능을 활성화하거나 동작을 바꾸려면 `env` 섹션에 환경 변수를 추가합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db",
        "OPENAI_API_KEY": "your-key-here",
        "GEMINI_API_KEY": "your-key-here",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

주요 환경 변수는 다음과 같습니다.

- **DB_PATH**: 데이터베이스 파일 경로. 절대 경로 사용을 권장합니다. 기본값은 `~/.memento/memory.db`입니다.
- **NODE_ENV**: 실행 환경(`development` 또는 `production`).
- **OPENAI_API_KEY**: OpenAI 임베딩 사용 시 필요합니다.
- **GEMINI_API_KEY**: Gemini 임베딩 사용 시 필요합니다.
- **EMBEDDING_PROVIDER**: 임베딩 제공자(`tfidf`, `lightweight`, `minilm`, `openai`, `gemini`). 기본값은 `minilm`입니다.
- **LOG_LEVEL**: 로그 레벨(`debug`, `info`, `warn`, `error`).

## 개발 중 소스 직접 실행

소스 파일을 빌드 없이 바로 실행하고 싶다면 `tsx`를 사용합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "tsx", "packages/memento-server/src/server/index.ts"],
      "cwd": "/home/username/git/memento",
      "env": {
        "NODE_ENV": "development",
        "DB_PATH": "/home/username/git/memento/data/memory.db",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## 권장 설정 순서 요약

1. 저장소 클론 후 `npm install && npm run build` 실행
2. `.cursor/mcp.json`에 위 방법 1의 JSON 추가 (경로를 실제 위치로 수정)
3. Cursor 재시작 또는 MCP 서버 재연결
4. Memento 도구 목록에 `remember`, `recall` 등이 표시되는지 확인
