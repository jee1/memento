# 환경변수 거버넌스 가이드

## 목적

`.env`, `env.example`, `services/agent/env.example` 사이의 불일치로 발생하는 온보딩/운영 혼선을 줄이기 위한 기준 문서입니다.

## 단일 출처 정책

- 공통 서버 변수: 루트 `env.example`
- 에이전트 런타임(프로세스)이 읽는 변수: `services/agent/env.example`의 `AGENT_*` 네이밍을 기준으로 합니다.
- 루트 `env.example`에 있는 `MEMENTO_AGENT_*` 블록은 **모노레포 루트 `.env` 한 파일에서 서버+에이전트를 함께 켤 때 쓰는 예시 별칭**이며, 에이전트 디렉터리의 `AGENT_*`와 **의미가 겹칠 수 있습니다**. 이 경우 아래 매핑표를 따르고, 실제 에이전트 코드가 읽는 쪽을 우선합니다.
- 동일 파일(`env.example` 또는 `services/agent/env.example`) 안에서는 동일 키가 두 번 나오지 않도록 유지합니다.

### 에이전트 별칭 매핑 (예시)

| 의미 | 에이전트 템플릿 (`services/agent/env.example`) | 루트 별칭 (`env.example`의 `MEMENTO_AGENT_*`) |
| --- | --- | --- |
| LLM 제공자 | `AGENT_LLM_PROVIDER` | `MEMENTO_AGENT_LLM_PROVIDER` |
| Ollama 베이스 URL | `AGENT_OLLAMA_BASE_URL` | `MEMENTO_AGENT_OLLAMA_BASE_URL` |
| Ollama 모델 | `AGENT_OLLAMA_MODEL` | `MEMENTO_AGENT_OLLAMA_MODEL` |
| OpenAI 키 / 모델 | `AGENT_OPENAI_API_KEY`, `AGENT_OPENAI_MODEL` | `MEMENTO_AGENT_OPENAI_API_KEY`, `MEMENTO_AGENT_OPENAI_MODEL` |
| Gemini 키 / 모델 | `AGENT_GEMINI_API_KEY`, `AGENT_GEMINI_MODEL` | `MEMENTO_AGENT_GEMINI_API_KEY`, `MEMENTO_AGENT_GEMINI_MODEL` |
| 로그 / 타임아웃 | `AGENT_LOG_LEVEL`, `AGENT_TIMEOUT_MS` | `MEMENTO_AGENT_LOG_LEVEL`, `MEMENTO_AGENT_TIMEOUT_MS` |

우선순위: **에이전트 프로세스가 명시적으로 읽는 변수 > 배포 문서에 적힌 단일 출처**. 루트와 `services/agent`를 동시에 쓸 때는 한쪽만 채우거나, 팀에서 정한 한 벌로 맞춥니다.

## 로딩 규칙 (실행 경로별)

- `memento` CLI: `.env` 탐색 로직(`envFile` → `configDir/MEMENTO_CONFIG_DIR` → `cwd` → `~/.memento/.env`) 사용
- `memento-mcp-server` / `http-server`: CLI 탐색 로직과 다를 수 있으므로 런타임 환경변수 주입 방식(쉘/도커/프로세스 매니저)을 기준으로 관리

## 보안 변수 규칙

- `ADMIN_API_KEY`는 프로덕션에서 필수입니다.
- `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true`는 로컬 개발 전용입니다.
- 보안 민감 변수는 템플릿에 `[REQUIRED in production]` 또는 위험 경고 주석을 포함합니다.

## 비파괴 전환 원칙

- 템플릿 업데이트는 사용자의 기존 `.env`를 자동으로 수정/삭제하지 않습니다.
- 전환 시 기존 변수명 호환 또는 마이그레이션 안내를 제공합니다.
