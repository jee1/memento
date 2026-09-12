# 🧠 Memento

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">

  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
</div>

---

LLM은 대화가 끝나면 모든 것을 잊습니다. 이름도, 결정도, 지난주에 쌓인 맥락도 마찬가지입니다. 이는 모델의 한계가 아니라 **기억 인프라의 부재**입니다.

Memento는 그 인프라입니다. 단순 저장소가 아니라, 기억이 생성·분류·강화·망각되는 **MCP 기반 기억 운영 체제**입니다.

작업기억·일화기억·의미기억·절차기억은 `remember`의 `type`으로 구분합니다. 쓰인 기억은 강화되고, 쓸모없어진 기억은 망각 정책으로 정리됩니다. 비슷한 기억은 벡터로 연결되며, 핵심 맥락은 앵커로 다음 대화에 바로 복원됩니다.

모노레포·패키지 구조·빌드 명령은 [AGENTS.md](AGENTS.md)를 참고해 주세요.

## 빠른 시작

패키지 매니저는 **npm**만 지원합니다 (`pnpm`/`yarn`은 지원하지 않습니다).

역할에 맞는 **기본 경로 하나**만 고르세요. Docker·소스 클론·다중 에이전트 HTTP·원클릭 스크립트는 [INSTALL.md](INSTALL.md)에 있습니다.

### Claude Code → 플러그인

```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```

기억 DB는 `${CLAUDE_PLUGIN_DATA}/memory.db`에 두어 플러그인 업데이트 후에도 유지됩니다. `/plugin` 패널에서 `memento` MCP가 연결됐는지 확인해 주세요.

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

설정 파일 위치는 다음과 같습니다. Cursor는 `.cursor/mcp.json` 또는 `~/.cursor/mcp.json`입니다. Claude Desktop·Claude Code는 [INSTALL.md](INSTALL.md)와 [Cursor MCP 설정 가이드](docs/guides/ko/cursor-mcp-setup.md)를 참고해 주세요.

자주 쓴다면 `npm i -g memento-mcp-server`로 글로벌 설치하는 편이 낫습니다. 공식 MCP 레지스트리 이름은 `io.github.jee1/memento-mcp-server`입니다 (`server.json`).

### 운영·자체 호스팅 → INSTALL.md

Docker, 소스 빌드, HTTP MCP(다중 에이전트), 환경 오버레이는 [INSTALL.md](INSTALL.md)를 따라 주세요.

## 기본으로 보이는 도구

서버에는 도구 22개가 등록되어 있지만, `tools/list`에는 기본적으로 **`recall` · `remember` · `memory_injection` · `feedback` 4개만** 노출됩니다(v1.18+). 나머지는 등록된 채 호출은 가능하고, 목록에서만 빠집니다. 전부 나열하려면 `MEMENTO_TOOLSET=full`을 설정하세요.

## 사용 예시

```typescript
await client.callTool({
  name: "remember",
  arguments: {
    content: "사용자는 React Hook을 학습했습니다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리합니다.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});

const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "React Hook은 어떻게 사용하나요?",
    limit: 5
  }
});
```

더 많은 연결 방식(MCP SDK, `@jee1/memento-client`, 외부 비서 SDK)은 [docs/README.md](docs/README.md)와 [docs/integrations/](docs/integrations/README.md)를 참고해 주세요.

## 핵심 기능

- **4종 기억**: `working` · `episodic` · `semantic` · `procedural`
- **하이브리드 검색**: FTS5 + 벡터, 태그 필터
- **살아있는 기억**: 강화·망각·이웃 탐색·앵커
- **절차 버전**: `procedural_diff` / `procedural_rollback`
- **그래프·대시보드**: HTTP 서버 기동 후 `/dashboard`, `/graph`

망각 TTL·임베딩·보안 등 설정값은 README에 숫자를 두지 않습니다. [env.example](env.example)가 기준입니다.

## 문서

- 문서 포털: [docs/README.md](docs/README.md)
- 설치: [INSTALL.md](INSTALL.md) · [INSTALL.en.md](INSTALL.en.md)
- 기여자·에이전트: [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
- API: [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)
- 보안: [docs/reference/ko/security.md](docs/reference/ko/security.md)

## 로드맵 (요약)

- **M1 개인용 (현재)**: 로컬 SQLite, MCP + HTTP 관리 API
- **M2 팀 (계획)**: 공유 백엔드, API Key, Docker
- **M3 조직 (계획)**: PostgreSQL + pgvector, JWT

## 기여 · 라이선스 · 지원

기여는 [CONTRIBUTING.md](CONTRIBUTING.md)를 따라 주세요. 라이선스는 [MIT](LICENSE)입니다.

- 이슈: [GitHub Issues](https://github.com/jee1/memento/issues)
- 문서: [docs/README.md](docs/README.md)
