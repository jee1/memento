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

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `MEMENTO_BASE_URL` | Memento HTTP API 베이스 URL | `http://localhost:9001` |
| `AGENT_PORT` | Agent HTTP 서버 포트 | `3001` |
| `AGENT_LLM_PROVIDER` | LLM 제공자: `openai` \| `gemini` \| `ollama` | `ollama` |
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

## API

- **POST /chat** — 대화 한 턴. Body: `{ "message": "...", "ownerId": "user_abc", "sessionId?": "s_1" }`

## 지원 Core API 버전

Agent는 Memento Core의 **HTTP `/tools` API**를 사용합니다 (recall, remember). Core는 동일 레포의 `src/` 기준 빌드와 호환됩니다.
