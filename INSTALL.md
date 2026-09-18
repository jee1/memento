# Memento 설치 가이드

<div align="center">
  [🇰🇷 한국어](INSTALL.md) | [🇺🇸 English](INSTALL.en.md)
</div>

역할에 맞는 **기본 경로 하나**만 고르세요. 제품 소개와 짧은 시작은 [README.md](README.md)를, 문서 전체는 [docs/README.md](docs/README.md)를 참고해 주세요.

패키지 매니저는 **npm**만 지원합니다.

## 역할별 기본 경로

### Claude Code → 플러그인

```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```

MCP 서버 등록과 `recall`→`remember` 습관 skill이 함께 설치됩니다. 기억 DB는 `${CLAUDE_PLUGIN_DATA}/memory.db`에 두어 업데이트 후에도 유지됩니다. `/plugin` 패널에서 `memento` MCP가 연결됐는지 확인해 주세요.

기본으로 노출되는 도구는 `recall` · `remember` · `memory_injection` · `feedback` 4개입니다. 나머지 도구까지 목록에 보이게 하려면 사용자/프로젝트 MCP 설정의 `memento` 서버 `env`에 `MEMENTO_TOOLSET=full`을 넣으세요. 플러그인 내부 `.mcp.json` 수정은 업데이트 시 사라집니다.

### Cursor·기타 MCP → npx + mcp.json

```bash
npx memento-mcp-server@latest
```

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

설정 파일 위치:

- Cursor: `.cursor/mcp.json` 또는 `~/.cursor/mcp.json`
- Claude Desktop / Claude Code: [Cursor MCP 설정 가이드](docs/guides/ko/cursor-mcp-setup.md)를 참고해 주세요 (호스트별 경로 안내 포함)

자주 쓴다면 `npm i -g memento-mcp-server`를 권장합니다. `npm exec`를 쓸 때는 실행 파일을 명시하세요: `npm exec -- memento-mcp-server@latest`.

공식 MCP 레지스트리 이름: `io.github.jee1/memento-mcp-server` (`server.json`).

### 운영·자체 호스팅 → Docker 또는 소스

**Docker (팀·프로덕션)**

```bash
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
```

로그·중지는 같은 `-f` 파일에 `logs -f` / `down`을 붙이면 됩니다. Compose 프로젝트 이름은 기본 `memento`입니다. 바꾸려면 `COMPOSE_PROJECT_NAME`을 설정하세요.

**소스 (기여·디버깅)**

```bash
git clone https://github.com/jee1/memento.git
cd memento
npm install
npm run build
npm run db:init
npm run db:migrate
npm run quick-start
```

또는 `npm run setup` 후 `npm run dev` / `npm run start`을 사용하세요.

**원클릭 스크립트** (로컬에 빠르게 깔고 싶을 때)

```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

Windows PowerShell에서는 스크립트를 받은 뒤 `bash install.sh`로 실행하세요.

### 다중 에이전트 → HTTP MCP 하나

SQLite는 writer가 하나여야 안정적입니다. 여러 에이전트가 동시에 쓰면 **MCP/HTTP 서버 프로세스 하나**만 띄우고 모두 그쪽으로 붙이세요.

```bash
npm run build && npm run start:http
```

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://127.0.0.1:9001/mcp"
    }
  }
}
```

포트는 아래 «포트» 절을 참고해 주세요.

## 환경 설정

```bash
cp env.example .env
```

OpenAI·Gemini 키는 선택입니다. 전체 변수는 [env.example](env.example)가 기준입니다.

## 포트

HTTP/MCP 포트는 세 값이 있습니다.

- **코드 기본값**: `3000`
- **로컬·Docker 권장 프로필** ([env.example](env.example)): `MCP_SERVER_PORT=9001` / `PORT=9001`
- **Docker 이미지 기본값**: `9001` — `Dockerfile` 이 `PORT=9001` 을 박아 `EXPOSE`·`HEALTHCHECK` 와 맞춘다. 환경변수로 덮어쓸 수 있다.

이 문서의 URL 예시는 **권장 프로필 `9001`** 기준입니다. 기본값으로 띄운다면 `3000`으로 바꿔 읽으세요. 충돌 시 `.env`에서 `PORT` / `MCP_SERVER_PORT`를 바꾸세요.

권장 프로필 기준 접속 예:

- MCP (HTTP): `http://localhost:9001/mcp`
- HTTP API: `http://localhost:9001`
- 대시보드: `http://localhost:9001/dashboard`
- Health: `http://localhost:9001/health`

stdio MCP는 포트를 쓰지 않습니다.

## 자주 쓰는 명령

```bash
npm run dev              # MCP 개발
npm run start            # MCP 프로덕션
npm run dev:http         # HTTP 개발
npm run start:http       # HTTP 프로덕션
npm run test
npm run docker:dev
npm run docker:prod
```

## 문제 해결 (요약)

- **`npm exec` 오류**: `npm exec -- memento-mcp-server@latest …`처럼 명령을 명시하거나 `npx`를 쓰세요.
- **Node.js**: `package.json` engines 기준 **≥ 24**가 필요합니다.
- **SQLite/네이티브 모듈**: `npm rebuild better-sqlite3 sqlite-vec` 또는 [npx 트러블슈팅](docs/operations/ko/npx-troubleshooting.md)을 참고하세요.
- **DB 초기화**: `npm run db:init` (필요 시 DB 파일 삭제 후).

자세한 운영 이슈는 [docs/operations/ko/](docs/operations/ko/)를 참고해 주세요.

## 다음 단계

1. 서버·MCP 연결 확인
2. [사용자 매뉴얼](docs/guides/ko/user-manual.md)
3. [API 레퍼런스](docs/api/ko/api-reference.md)
4. 외부 비서 연동: [docs/integrations/](docs/integrations/README.md)

## 지원

- 이슈: [GitHub Issues](https://github.com/jee1/memento/issues)
- 문서: [docs/README.md](docs/README.md)
