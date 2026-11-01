# 환경 변수 거버넌스 가이드

Memento는 서버와 에이전트가 별도 프로세스로 동작할 수 있는 모노레포 구조를 가지고 있습니다. 이로 인해 "어떤 환경 변수를 어느 파일에서 관리하는가"라는 질문이 온보딩 과정에서 자주 혼선을 일으킵니다. 이 문서는 그 질문에 답하기 위한 단일 출처 정책을 정의합니다.

## 단일 출처 정책

Memento의 환경 변수는 두 개의 템플릿 파일을 기준으로 관리합니다.

**루트 `env.example`**은 서버(MCP stdio 서버와 HTTP 관리 서버)가 공통으로 사용하는 변수의 기준입니다. 데이터베이스 경로, 포트, 임베딩 프로바이더, 관리 API 키 같은 서버 수준의 설정이 여기에 속합니다.

**`services/agent/env.example`**은 에이전트 런타임 프로세스가 읽는 변수의 기준입니다. 에이전트의 LLM 프로바이더, 모델 이름, 타임아웃 같은 설정이 `AGENT_*` 네이밍으로 정의됩니다.

동일한 파일 안에서는 동일한 키가 두 번 나오지 않도록 유지해야 합니다. 같은 변수를 두 파일에서 서로 다른 이름으로 정의하는 것은 허용되지만, 이 경우 아래 매핑표를 명시하여 혼선을 방지합니다.

## 에이전트 별칭 매핑

루트 `env.example`에는 `MEMENTO_AGENT_*` 블록이 있습니다. 이 블록은 모노레포 루트의 단일 `.env` 파일에서 서버와 에이전트를 함께 구동할 때 쓰는 별칭 예시입니다. 에이전트 프로세스가 실제로 읽는 변수는 `services/agent/env.example`의 `AGENT_*` 키이며, `MEMENTO_AGENT_*`는 그것을 루트 `.env`에서 설정하기 위한 편의 이름입니다.

| 의미 | 에이전트 템플릿 (`AGENT_*`) | 루트 별칭 (`MEMENTO_AGENT_*`) |
|------|----------------------------|-------------------------------|
| LLM 제공자 | `AGENT_LLM_PROVIDER` | `MEMENTO_AGENT_LLM_PROVIDER` |
| Ollama 베이스 URL | `AGENT_OLLAMA_BASE_URL` | `MEMENTO_AGENT_OLLAMA_BASE_URL` |
| Ollama 모델 | `AGENT_OLLAMA_MODEL` | `MEMENTO_AGENT_OLLAMA_MODEL` |
| OpenAI 키·모델 | `AGENT_OPENAI_API_KEY`, `AGENT_OPENAI_MODEL` | `MEMENTO_AGENT_OPENAI_API_KEY`, `MEMENTO_AGENT_OPENAI_MODEL` |
| Gemini 키·모델 | `AGENT_GEMINI_API_KEY`, `AGENT_GEMINI_MODEL` | `MEMENTO_AGENT_GEMINI_API_KEY`, `MEMENTO_AGENT_GEMINI_MODEL` |
| 로그·타임아웃 | `AGENT_LOG_LEVEL`, `AGENT_TIMEOUT_MS` | `MEMENTO_AGENT_LOG_LEVEL`, `MEMENTO_AGENT_TIMEOUT_MS` |

우선순위는 항상 에이전트 프로세스가 명시적으로 읽는 변수(`AGENT_*`)가 기준입니다. 루트와 `services/agent`를 동시에 사용할 때는 한쪽만 채우거나, 팀에서 정한 하나의 방식으로 통일합니다.

## 주요 서버 환경 변수

아래는 서버 운영에 자주 필요한 주요 변수입니다. 전체 목록과 설명은 루트 `env.example`을 참고하십시오.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_PATH` | `~/.memento/memory.db` | SQLite 데이터베이스 파일 경로 |
| `MCP_SERVER_PORT` / `PORT` | `9001` | HTTP 관리 서버 포트 |
| `EMBEDDING_PROVIDER` | `minilm` | 임베딩 프로바이더 (tfidf, minilm, openai, gemini) |
| `LLM_PROVIDER` | `ollama` | 관계 추출 등에 사용하는 LLM 프로바이더 |
| `ADMIN_API_KEY` | — | 브라우저 대시보드 로그인 키 (프로덕션 필수) |
| `MEMENTO_API_TOKENS` | — | programmatic HTTP 인증 토큰 JSON 배열 (v2.0.0 부터 유일한 경로, #1241) |
| `MEMENTO_HTTP_BIND_HOST` | `127.0.0.1` | HTTP 서버 바인드 주소 |
| `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` | — | 무키 기동 허용 (로컬 개발 전용) |
| `MEMENTO_RECALL_PROFILE` | — | `1`로 설정 시 recall 프로파일링 활성화 |

## 로딩 규칙

`memento` CLI는 다음 순서로 `.env` 파일을 탐색합니다: `--env-file` 옵션 → `MEMENTO_CONFIG_DIR` 환경 변수가 가리키는 경로 → 현재 작업 디렉터리 → `~/.memento/.env`.

HTTP 서버와 MCP stdio 서버는 CLI와 다른 탐색 경로를 가질 수 있으므로, 프로세스 매니저·도커·쉘 환경에서 직접 환경 변수를 주입하는 방식으로 관리하는 것이 가장 안전합니다.

## 실효값 우선순위와 설정 탭

조정 가능한 12개 키(기능 플래그, 운영 손잡이)의 실효값은 DB override, 기동 때 env(`.env` 포함, 빈 문자열은 미설정), 코드 기본값 순으로 정해집니다. 대시보드 **설정** 탭은 DB override 를 쓰고 지우는 화면입니다. 변경과 되돌리기마다 사유를 받아 `setting_override_event` 에 남기며, 화면은 값의 출처와 코드 기본값과의 차이를 함께 보여 줍니다. 되돌리면 `.env` 값(없으면 코드 기본값)으로 돌아갑니다. 비밀값, 인프라 키, 임베딩 모델은 이 경로로 바꾸지 않으며 읽기 전용 목록에 설정 여부만 보입니다. 재기동 키는 값을 저장해도 다음 기동 전까지 `재기동 대기`로 표시됩니다. 경로와 응답 형식은 [API 레퍼런스](../../api/ko/api-reference.md)의 런타임 설정 override 절을 봅니다.

## 보안 변수 규칙

`ADMIN_API_KEY`는 프로덕션 환경에서 반드시 설정해야 합니다. 미설정 시 서버는 비루프백 주소에서 기동을 거부합니다. `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true`는 로컬 개발 환경에서 키 없이 기동하기 위한 옵션이며, 프로덕션에서는 절대 사용하지 마십시오.

보안에 민감한 변수는 `env.example` 내에 `[REQUIRED in production]` 주석이 포함되어 있습니다. 이 주석이 있는 항목은 배포 전 반드시 실제 값으로 채워야 합니다.

## 비파괴 전환 원칙

템플릿(`env.example`, `services/agent/env.example`)이 업데이트되더라도 사용자의 기존 `.env`는 자동으로 수정되거나 삭제되지 않습니다. 코드나 템플릿에서 제거된 미사용 키가 운영 `.env`에 남아도 Docker Compose 화이트리스트와 런타임 설정 로더는 이를 무시하므로 기동에 영향을 주지 않습니다. 운영자는 점검 시점에 불필요한 키를 정리하면 됩니다. 변수 이름이 바뀌는 경우 기존 이름과의 호환성을 일정 기간 유지하거나 마이그레이션 안내를 제공합니다.
