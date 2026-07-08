# 개인 지식 에이전트 — CLI 사용 가이드

## 개요

`memento agent ask`는 **로컬 SQLite DB**에 쌓인 기억만으로 질문에 답하고, 답변 과정에서 새로 드러난 지식을 승인 후 저장하는 CLI입니다. 질문 → recall → LLM 답변 → 후보 추출 → 터미널에서 승인/거절 → `remember` 저장까지 한 턴 안에서 끝나며, MCP나 HTTP 대시보드 없이 DB 파일 하나로 동작합니다.

HTTP 서버를 이미 띄운 환경에서는 같은 Agent를 **run / persist-approved** API 두 단계로 호출할 수 있습니다. 이 경로는 서버의 `ToolContext`와 `remember`를 그대로 쓰므로, 승인된 후보가 **현재 서버 DB**에 들어갑니다.

## 전제 조건

저장소 루트에서 `npm install`과 `npm run build`를 완료한 상태여야 합니다.

CLI 진입점은 `node packages/memento-server/dist/cli.js`입니다. `memento`가 PATH에 등록된 환경에서는 `memento`로 사용할 수 있습니다.

## 기본 사용법

### DB 준비

DB 파일이 없으면 자동으로 생성됩니다. `--db-path`로 파일 경로를 지정합니다.

```bash
DB=./my-knowledge.db
node packages/memento-server/dist/cli.js --db-path "$DB" remember \
  "프로젝트에서는 TypeScript 엄격 모드를 사용한다" \
  --type semantic
```

### 질문 실행 (mock LLM)

테스트나 빠른 확인 목적으로 실제 LLM 없이 mock 응답을 사용할 수 있습니다. `--llm mock` 플래그를 붙이면 환경 변수와 무관하게 항상 mock으로 동작합니다.

```bash
node packages/memento-server/dist/cli.js --db-path "$DB" agent ask \
  "우리 프로젝트의 TypeScript 설정은 어떻게 돼 있어?" \
  --llm mock
```

실행되면 stderr에 LLM 요약과 지식 후보 목록이 표시되고, 각 후보마다 승인 여부를 묻는 프롬프트가 나타납니다.

- `y` 또는 엔터: 해당 후보를 승인하고 `remember`에 저장합니다.
- `n` 또는 빈 줄: 거절합니다.
- `s` 또는 `q`: 남은 후보를 건너뛰고, 지금까지 승인한 항목만 저장합니다.

### Ollama로 실제 LLM 사용

로컬 Ollama를 사용하는 경우 먼저 Ollama 데몬과 모델을 준비합니다.

```bash
ollama serve           # 다른 터미널에서
ollama pull llama3.2
```

그다음 환경 변수를 설정하고 `--llm` 플래그를 생략합니다.

```bash
export MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=ollama
export MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL=llama3.2
# 기본 URL은 http://127.0.0.1:11434이므로 동일한 경우 생략 가능
# export MEMENTO_PERSONAL_AGENT_OLLAMA_URL=http://127.0.0.1:11434

node packages/memento-server/dist/cli.js --db-path "$DB" agent ask \
  "다음 스프린트에서 가장 중요한 작업은 무엇인가?" \
  --project-id my-project
```

Ollama가 실행 중이지 않거나 모델이 없으면 CLI가 오류와 함께 종료됩니다. stderr 메시지를 확인하세요.

### OpenAI / Gemini 사용

```bash
export MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
# 또는
export MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=gemini
export GEMINI_API_KEY=...
```

## 환경 변수 참조

| 환경 변수 | 설명 | 기본값 |
|---------|------|-------|
| `MEMENTO_PERSONAL_AGENT_LLM_PROVIDER` | LLM 제공자 (mock\|ollama\|openai\|gemini) | mock |
| `MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL` | Ollama 사용 시 모델명 | 없음 (필수) |
| `MEMENTO_PERSONAL_AGENT_OLLAMA_URL` | Ollama 서버 URL | `http://127.0.0.1:11434` |
| `OPENAI_API_KEY` | OpenAI API 키 | 없음 |
| `GEMINI_API_KEY` | Gemini API 키 | 없음 |

## CLI 플래그 참조

| 플래그 | 설명 |
|-------|------|
| `--db-path <경로>` | SQLite DB 파일 경로 |
| `--project-id <id>` | 프로젝트 스코프 (같은 ID끼리 컨텍스트 공유) |
| `--llm <provider>` | LLM 제공자 강제 지정. `--llm mock`으로 mock 사용 |
| `--json` | stdout에 JSON 한 줄 출력 |
| `--no-save` | 저장 단계 생략 (승인 없이 바로 종료) |

## 스크립트 및 CI 환경

비TTY 환경(파이프, CI)에서 대화형 승인 루프는 동작하지 않습니다. 저장 없이 응답만 받으려면 `--json --no-save`를 함께 사용하세요.

```bash
node packages/memento-server/dist/cli.js --db-path "$DB" agent ask \
  "배포 전 체크리스트는 무엇인가?" \
  --llm mock --json --no-save
```

stdout에 JSON 한 줄이 출력되고, 저장이나 대화형 입력 없이 종료됩니다.

## HTTP 서버 런타임 사용법

HTTP 호스트는 저장을 자동으로 수행하지 않습니다. 먼저 한 턴을 실행해 후보를 받은 뒤, 사용자 승인 결과를 별도 요청으로 제출합니다.

### 1. 서버 실행

`/api/v1/agent/*` 엔드포인트는 API 키 인증을 사용합니다. 로컬 테스트에서는 mock LLM이 기본값입니다.

```bash
export ADMIN_API_KEY=dev-key
export MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=mock
npm run dev:http
```

### 2. 한 턴 실행

```bash
curl -sS http://127.0.0.1:3000/api/v1/agent/personal:run \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "앞으로는 커밋 메시지는 영어로 쓰자",
    "project_id": "my-project",
    "session_id": "session-1",
    "token_budget": 1000
  }'
```

응답에는 `llm.response`, `knowledgeContext`, `candidates`, `persistence`가 포함됩니다. 이 단계의 `persistence.attempted`는 항상 `false`이며 DB 저장을 하지 않습니다.

호스트는 응답의 `candidates` 배열을 그대로 보관해야 합니다. 후보 `id`는 해당 응답 스냅샷 안에서 승인 목록과 매칭하기 위한 값입니다.

### 3. 승인 후보 저장

사용자가 승인한 후보 id만 `approved_candidate_ids`에 넣고, 직전 응답의 `candidates` 배열을 그대로 보냅니다.

```bash
curl -sS http://127.0.0.1:3000/api/v1/agent/personal:persist-approved \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "candidates": [
      {
        "id": "kc_...",
        "category": "preference",
        "content": "커밋 메시지는 영어로 쓰자",
        "reason": "사용자 메시지에 선호·습관 변경 신호가 포함되어 있습니다.",
        "suggestedMemoryType": "semantic",
        "tags": ["personal-agent", "preference"],
        "importance": 0.62,
        "confidence": 0.9,
        "sourceContext": "앞으로는 커밋 메시지는 영어로 쓰자"
      }
    ],
    "approved_candidate_ids": ["kc_..."],
    "project_id": "my-project",
    "session_id": "session-1",
    "process_id": "http-host"
  }'
```

성공 응답의 `persistence.items[]`에는 후보별 `status`, 성공 시 `memoryId`, 실패 시 `errorMessage`가 들어갑니다. 승인하지 않은 후보는 저장되지 않습니다.

## 관련 문서

- [사용자 매뉴얼](./user-manual.md)
- [LLM 프로바이더 설정 가이드](./llm-provider-configuration.md)
