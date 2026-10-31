# Memento CLI for AI 가이드

AI 에이전트는 Memento 기억을 MCP 도구뿐 아니라 CLI 서브커맨드로도 조작합니다.

## Agent Skill (Cursor·터미널 에이전트)

MCP 없이 셸에서 `memento`만 쓰는 에이전트는 프로젝트 스킬 [`docs/skills/memento-cli-for-ai/SKILL.md`](../../skills/memento-cli-for-ai/SKILL.md)를 적용합니다. 작업 전 `recall`/`memory_injection`, 작업 후 `remember` 흐름과 stdout JSON 규칙이 요약돼 있습니다. Cursor에 노출하려면 [`README.md`](../../skills/memento-cli-for-ai/README.md)의 복사 절차를 따릅니다. MCP가 연결된 Cursor/Claude Code는 `plugins/memento/skills/memento-memory-loop/`를 우선합니다.

## MCP와 CLI의 역할

- **MCP**: 에이전트 호스트 도구. Claude, Cursor, Codex 등 MCP 호스트가 stdio·HTTP 프로토콜로 도구를 호출해 대화 맥락을 유지합니다.
- **CLI**: 도구 서브커맨드(`recall`, `remember`, `forget`, `memory_injection`)를 HTTP 서버로 중계하는 씬 클라이언트(thin client)입니다. 진단·연결·정리(`doctor`, `status`, `demo`, `connect`, `hook`, `agent ask`, `review-queue cleanup`) 같은 운영 명령도 수행합니다.

## 워크플로

작업 흐름은 세 단계입니다.

1. **작업 전**: `recall` 또는 `memory_injection`으로 관련 기억을 불러와 컨텍스트로 활용합니다.
2. **작업 중**: 중요 정보를 타입(`episodic`, `semantic`, `procedural`)에 맞게 저장합니다.
3. **작업 후**: 완료 작업은 `episodic`, 재사용 지식은 `semantic`, 반복 절차는 `procedural`로 기록합니다.

## 서버 실행 및 연결 설정

도구 서브커맨드(`recall`, `remember`, `forget`, `memory_injection`)는 SQLite 파일을 직접 열지 않고 실행 중인 HTTP 서버의 `/tools/:toolName`을 호출합니다. 서버가 꺼진 상태에서 CLI를 실행하면 서버 실행 안내 메시지를 출력하고 종료 코드 1로 실패합니다.

```
Memento 서버가 실행 중이지 않습니다.
npm run dev 또는 npm run dev:http 로 먼저 서버를 실행하세요.
```

데이터베이스는 서버가 관리합니다. 도구 서브커맨드에 `--db-path`나 `--env-file`을 넘기면 deprecated 경고를 출력합니다.

### 1. 로컬 MCP + CLI 연동 (권장)

MCP 서버 환경 변수에 `MEMENTO_HTTP_SIDECAR=1`을 지정하면 stdio MCP와 HTTP 서버가 프로세스 하나와 DB 연결을 함께 씁니다.

CLI는 `~/.memento/server.json`(또는 `MEMENTO_CONFIG_DIR/server.json`)에서 서버 포트를 자동 감지합니다.

HTTP 도구 호출은 Bearer 인증을 거치므로, CLI를 실행하는 셸에 `MEMENTO_API_TOKENS`의 secret과 일치하는 `MEMENTO_API_KEY`를 설정합니다.

MCP 클라이언트 설정 예시 (`.cursor/mcp.json` 등):

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "MEMENTO_HTTP_SIDECAR": "1",
        "MCP_SERVER_PORT": "0",
        "MEMENTO_API_TOKENS": "[{\"id\":\"local\",\"secret\":\"my-token-secret-01234567890123456789\",\"scopes\":[\"tools:invoke\"]}]"
      }
    }
  }
}
```

셸 환경 변수 설정:

```bash
export MEMENTO_API_KEY="my-token-secret-01234567890123456789"
```

포트 충돌을 피하려면 `MCP_SERVER_PORT=0`을 씁니다. 실제 할당 포트는 `~/.memento/server.json`에 기록되고 CLI가 이를 읽어 접속합니다.

### 2. 독립 HTTP 서버 실행

MCP 없이 서버를 띄울 때는 HTTP 서버를 직접 실행합니다.

```bash
npm run dev:http
```

### 실행 방식

상황에 따라 세 가지 실행 방식 중 하나를 선택합니다.

```bash
# 다른 프로젝트에서 패키지를 임시로 사용할 때
npm exec --package memento-mcp-server -- memento <명령>

# memento-mcp-server가 로컬 의존성으로 설치된 환경
npm exec -- memento <명령>

# 글로벌 설치 환경
memento <명령>
```

## 명령 참조

모든 도구 명령은 HTTP 서버 기동이 필요합니다.

### recall — 기억 검색

하이브리드 검색(FTS5 전문 검색 + 벡터 검색)으로 관련 기억을 반환합니다.

```bash
# 기본 검색
memento recall --query "프로젝트 결정 사항" --limit 5

# 타입과 태그 필터링
memento recall --query "배포" --type procedural --tags docker --limit 10

# 다른 프로젝트에서 패키지 임시 호출
npm exec --package memento-mcp-server -- memento recall --query "JWT 인증" --type episodic --limit 5
```

성공 시 stdout에 JSON을 출력하고 종료 코드는 0입니다.

### remember — 기억 저장

```bash
memento remember \
  --content "작업 완료: API 스펙 확정" \
  --type episodic \
  --tags "completed,api"

# 중요도 지정
memento remember \
  --content "TypeScript 도입 결정" \
  --type semantic \
  --tags "decision,typescript" \
  --importance 0.8
```

성공 시 stdout에 `memory_id`를 담은 JSON을 출력하고 종료 코드는 0입니다.

### forget — 기억 삭제

```bash
# 소프트 삭제
memento forget --id mem_xxxxx

# 하드 삭제 (복구 불가)
memento forget --id mem_xxxxx --hard --confirm true
```

### memory_injection — 컨텍스트 주입

관련 기억을 요약해 프롬프트에 주입할 형태로 반환합니다.

```bash
memento memory_injection \
  --query "보안 정책" \
  --token_budget 1000
```

### agent ask — 개인 지식 Agent

저장된 기억을 바탕으로 LLM 질의응답을 수행합니다(in-process 실행).

```bash
memento agent ask "지금까지 저장된 TypeScript 관련 결정 사항을 요약해줘"
```

LLM 제공자는 `LLM_PROVIDER` 환경 변수로 설정합니다(`openai`, `gemini`, `ollama`, `auto`).

### review-queue cleanup — 검토 큐 일괄 정리

누적된 pending 검토 후보를 서버 없이 SQLite DB에서 직접 확인하고 정리합니다. 기본값은 dry-run이며, 실제 변경에는 `--execute --yes`가 모두 필요합니다.

```bash
# 기본 DB (~/.memento/memory.db) 정리
memento review-queue cleanup --older-than-days 30 --expire
memento review-queue cleanup --older-than-days 30 --expire --execute --yes

# 특정 DB 경로 지정 (이 명령만 --db-path 지원)
memento review-queue cleanup --db-path /path/to/memory.db --older-than-days 30 --expire
```

운영 절차와 상세 옵션은 [검토 큐 안전 정리](../../operations/ko/review-queue-cleanup.md)를 참고합니다.

## 전역 옵션

```bash
memento --config-dir <dir>    # 설정 디렉터리 지정 (~/.memento 대체, server.json 탐색 위치)
memento --db-path <path>      # review-queue cleanup 전용 DB 경로 (기타 명령은 deprecated)
memento --env-file <file>     # (deprecated) .env 파일 경로
memento --help, -h            # 도움말
```

도구 서브커맨드(`recall`, `remember`, `forget`, `memory_injection`)는 서버가 DB를 관리하므로 `--db-path`와 `--env-file` 옵션을 쓰지 않습니다.

## 출력 규칙

- **성공**: stdout에 JSON만 출력합니다. Memento 내부 로그(INFO, WARN, DEBUG)는 억제됩니다.
- **실패**: stderr에 오류 메시지를 출력하고 non-zero 종료 코드를 반환합니다.
