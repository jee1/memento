# Memento Agent (Actionable Memory Assistant)

기억을 기반으로 행동하는 AI 비서. Memento Core의 장기 기억을 활용해 맥락을 이해하고, 검색 등 행동을 수행한 뒤 결과를 다시 기억합니다.

## 선행 조건

- **Memento(Core)가 설치·실행 중이어야 합니다.**
  - 같은 레포 루트: `npm install && npm run dev:http` 로 HTTP 서버 기동 (기본 포트 9001)
  - 또는 [Docker Compose](../../README.md) 로 Core 컨테이너 기동

## 설치 및 실행

```bash
cd services/agent
npm install
```

### 환경 변수

`services/agent/.env`에 두면 실행 시 자동으로 로드됩니다 (CLI·서버 공통). 터미널에서 `export`로 넘겨도 됩니다.

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `MEMENTO_BASE_URL` | Memento HTTP API 베이스 URL | `http://localhost:9001` |
| `AGENT_PORT` | Agent HTTP 서버 포트 | `3001` |
| `AGENT_LLM_PROVIDER` | LLM 제공자: `openai` \| `gemini` \| `ollama` | `ollama` |
| `AGENT_OLLAMA_MODEL` | Ollama 모델 이름 (예: `llama2`, `llama3.2`, `mistral`) | `llama2` |
| `OLLAMA_BASE_URL` | Ollama API 주소 | `http://localhost:11434` |
| `OPENAI_API_KEY` | OpenAI 사용 시 API 키 | - |
| `GEMINI_API_KEY` | Gemini 사용 시 API 키 | - |

### 로컬 실행

```bash
export MEMENTO_BASE_URL=http://localhost:9001
npm run dev          # HTTP 서버 (개발)
npm run start        # HTTP 서버 (프로덕션 빌드 후)
npm run chat         # CLI 채팅 (빌드 후)
```

### 연결 확인 (선택)

```bash
npm run doctor       # Memento 연결 가능 여부 체크 (빌드 후)
```

연결 실패 시 확인할 것:

- Core가 해당 포트에서 실행 중인지 (예: 루트에서 `npm run dev:http`, 기본 9001)
- `MEMENTO_BASE_URL`이 **실행 환경에서** 접근 가능한 주소인지
  - 호스트에서 doctor 실행 시: `http://localhost:9001` 또는 Core가 바인딩한 포트
  - Docker/Compose 내부에서 실행 시: `http://memento-mcp-server:9001` 등 서비스 이름 사용
- scheme 누락 시 자동으로 `http://`가 붙습니다 (예: `localhost:9001` → `http://localhost:9001`)

**Ollama 404 / "Ollama failed: 404"**: Ollama가 실행 중인데 404가 나오면 **모델이 없을 수 있습니다**. `ollama run llama2` 또는 사용할 모델(예: `ollama run llama3.2`)로 풀한 뒤, 해당 모델명을 `AGENT_OLLAMA_MODEL`에 맞추세요 (기본값 `llama2`).

## API

- **POST /chat** — 대화 한 턴. Body: `{ "message": "...", "ownerId": "user_abc", "sessionId?": "s_1" }`

## 지원 Core API 버전

Agent는 Memento Core의 **HTTP `/tools` API**를 사용합니다 (recall, remember). Core는 동일 레포의 `src/` 기준 빌드와 호환됩니다.
