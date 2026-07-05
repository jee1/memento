# Multi-agent orchestration template (#673)

여러 AI 에이전트가 **하나의 Memento DB**를 공유할 때, **단일 writer + owner_id 격리** 패턴을 보여주는 참조 템플릿입니다.

관련: [다중 에이전트 사용 가이드](../../docs/guides/ko/multi-agent-usage.md) · GitHub [#664](https://github.com/jee1/memento/issues/664) (writer lock / orchestration)

## 아키텍처

```text
┌─────────────┐   recall (read)    ┌──────────────────┐
│  Agent A    │ ─────────────────► │                  │
│ (reviewer)  │                    │  Memento HTTP    │
└─────────────┘                    │  (single writer) │
┌─────────────┐   recall (read)    │                  │
│  Agent B    │ ─────────────────► │  DB: memory.db   │
│ (research)  │                    │                  │
└─────────────┘                    └────────▲─────────┘
┌─────────────┐   remember (write)          │
│ Orchestrator│ ────────────────────────────┘
│ (writer)    │   owner_id per agent
└─────────────┘
```

## Writer lock 패턴

Memento는 동일 `DB_PATH`에 대해 **프로세스 단위 lock** (`memento-mcp.lock`)을 사용합니다. 두 MCP/HTTP 인스턴스가 같은 DB를 동시에 쓰면 두 번째 프로세스는 기동 시 종료됩니다.

**권장:**

- **읽기 전용 에이전트** 여러 개 → HTTP `recall` / `memory_injection` (각자 `X-Memento-Agent-Id` + `owner_id` 스코프)
- **쓰기** → **하나의 orchestrator**만 `remember` / `remember_procedure` 호출

`scripts/run-orchestration.sh`는 단일 writer 전제로 환경 변수와 에이전트 ID를 설정합니다.

## owner_id 격리

| 에이전트 | owner_id | 권한 |
|----------|----------|------|
| code-reviewer | `code-reviewer` | recall만 (reader) |
| doc-writer | `doc-writer` | recall만 (reader) |
| orchestrator | (호출 시 지정) | remember (writer) |

strict 모드(`MEMENTO_OWNER_SCOPE_MODE=strict`)에서는 recall 시 `owner_id` 또는 `X-Memento-Agent-Id`가 필수입니다.

## 안티패턴: parallel writers

다음 구성은 **피하세요**:

- 동일 DB에 MCP stdio + HTTP 서버를 **동시에** 띄워 둘 다 `remember` 호출
- 여러 orchestrator가 lock 없이 같은 DB에 병렬 `remember`
- `owner_id` 없이 모든 에이전트가 전역 recall (strict 환경에서 의도치 않은 NULL 데이터 혼입)

SQLite 단일 writer 특성상 병렬 writer는 lock 경합·WAL 비대·데이터 경합을 유발합니다.

## 빠른 시작

```bash
# 1. 루트에서 빌드
cd /path/to/memento && npm install && npm run build

# 2. orchestration 스크립트 (단일 HTTP writer)
./apps/multi-agent-orchestration/scripts/run-orchestration.sh
```

또는 Docker:

```bash
cd apps/multi-agent-orchestration
docker compose up -d
```

## 환경 변수

| 변수 | 설명 |
|------|------|
| `DB_PATH` | 공유 DB (단일 writer 전제) |
| `MEMENTO_OWNER_SCOPE_MODE` | `strict` 권장 |
| `MEMENTO_HTTP_DEFAULT_AGENT_ID` | 기본 reader ID (예: `orchestrator`) |
| `MEMENTO_API_TOKENS` | programmatic 토큰 (tools:invoke) |

## 파일

- `docker-compose.yml` — 단일 memento 서비스 + strict owner scope
- `scripts/run-orchestration.sh` — 로컬 기동·writer lock 안내
