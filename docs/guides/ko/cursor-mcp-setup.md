# Cursor MCP 설정 가이드

Cursor에서 Memento MCP Server를 연결하는 방법을 설명합니다. Memento는 주로 **stdio MCP**로 연결하며, Docker로 HTTP 서버를 띄운 경우에는 URL로도 연결할 수 있습니다.

역할에 맞게 고르세요.

- **일반 사용 (권장)**: 아래 **방법 1 — npx**
- **기여·디버깅**: **방법 2 — 로컬 빌드**
- **운영·공유 서버**: **방법 4 — Docker (HTTP)**

설치 개요는 [INSTALL.md](../../../INSTALL.md)를, 포트 기본값/권장값 구분은 INSTALL «포트» 절을 참고해 주세요.

**요구 사항:** Node.js **≥ 24** (`package.json` engines).

기본으로 `tools/list`에 보이는 MCP 도구는 **`recall` · `remember` · `memory_injection` · `feedback` 4개**입니다. 나머지까지 목록에 보이게 하려면 `env`에 `MEMENTO_TOOLSET=full`을 넣으세요.

## 방법 1: npx (일반 사용 · 권장)

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

`DB_PATH`는 **절대 경로**를 쓰세요. 상대 경로면 `npx` 작업 디렉터리에 따라 DB 위치가 달라질 수 있습니다.

설정 파일: 프로젝트 `.cursor/mcp.json` 또는 `~/.cursor/mcp.json`.

문제가 나면 npm 캐시를 비우거나(`npm cache clean --force`) 방법 2로 전환하세요.

## 방법 2: 로컬 빌드 (기여·디버깅)

서버 진입점은 `packages/memento-server/dist/server/index.js`입니다. Git에 없으므로 먼저 빌드하세요.

```bash
npm install
npm run build
```

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

프로젝트 루트에 `.cursor/mcp.json`을 두고 `cwd`를 쓰면 상대 경로도 가능합니다.

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

## 방법 3: 전역 설치

```bash
npm install -g memento-mcp-server
```

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

## 방법 4: Docker (HTTP)

컨테이너가 HTTP/SSE로 뜨면 `command` 대신 `url`로 연결합니다.

포트는 두 값이 있습니다.

- **코드 기본값**: `3000`
- **로컬·Docker 권장 프로필** (`env.example`): `9001`

아래 예시는 **권장 프로필 `9001`** 기준입니다. 기본값으로 띄웠다면 `3000`으로 바꾸세요.

```bash
docker ps | grep memento
curl http://localhost:9001/health
```

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:9001/mcp"
    }
  }
}
```

```bash
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
# 같은 -f 파일로:
# docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml logs -f
# docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml down
```

또는 `npm run docker:dev` / `npm run docker:prod`를 사용하세요. Cursor를 재연결하기 전에 컨테이너가 실행 중이어야 합니다.

## 문제 진단

### "Cannot find module '.../dist/server/index.js'"

빌드 산출물이 없거나 오래됐습니다.

```bash
npm install
npm run build
```

### "Cannot destructure property 'package' of 'node.target' as it is null"

`npx` 사용 시 npm 내부 오류일 수 있습니다.

```bash
npm cache clean --force
node --version  # ≥ 24
npx -y memento-mcp-server@latest
```

계속되면 방법 2(로컬 빌드)로 전환하세요. 자세한 내용: [npx 트러블슈팅](../../operations/ko/npx-troubleshooting.md).

### 직접 실행 테스트

```bash
node packages/memento-server/dist/server/index.js
```

## 환경 변수

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db",
        "MEMENTO_TOOLSET": "full",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

- **DB_PATH**: 절대 경로 권장. 미설정 시 서버가 `~/.memento/memory.db` 등으로 잡을 수 있습니다.
- **MEMENTO_TOOLSET**: `core`(기본, 목록 4개) 또는 `full`(등록 도구 전부 나열).
- **OPENAI_API_KEY** / **GEMINI_API_KEY**: 해당 임베딩 사용 시.
- **EMBEDDING_PROVIDER**: `tfidf`, `lightweight`, `minilm`, `openai`, `gemini` (기본 `minilm`).

전체 목록은 [env.example](../../../env.example)를 참고해 주세요.

## 개발 중 소스 직접 실행

빌드 없이 TypeScript를 돌리려면 `tsx`를 사용합니다.

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

1. Node.js ≥ 24 확인
2. 일반 사용이면 방법 1(npx) JSON을 `.cursor/mcp.json`에 추가. 기여·디버깅이면 `npm install && npm run build` 후 방법 2
3. Cursor 재시작 또는 MCP 재연결
4. 도구 목록에 기본 4개(`recall`, `remember`, `memory_injection`, `feedback`)가 보이는지 확인. 더 필요하면 `MEMENTO_TOOLSET=full`
