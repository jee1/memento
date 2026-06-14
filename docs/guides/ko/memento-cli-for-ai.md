# Memento CLI for AI 가이드

AI 에이전트는 Memento 기억을 MCP 도구뿐 아니라 CLI 서브커맨드로도 조작할 수 있습니다. 다른 프로젝트 컨텍스트에서 가장 안전하게 실행하는 형태는 `npm exec --package memento-mcp-server -- memento ...`이며, 글로벌 설치 후에는 단순히 `memento ...`로 호출합니다.

## 워크플로

CLI를 사용하는 주요 패턴은 세 단계로 이루어집니다. 작업 전에는 `recall` 또는 `memory_injection`으로 관련 기억을 불러와 컨텍스트로 활용합니다. 작업 중에는 중요한 정보를 타입에 맞게 분류해 저장합니다. 작업 후에는 완료 기록을 `episodic`, 재사용 가능한 지식을 `semantic`, 반복 절차를 `procedural`로 저장합니다.

앵커를 사용하는 환경에서는 MCP의 `search_local`과 동일한 데이터를 CLI의 `recall`로 조회할 수 있습니다.

## 설정

### DB 경로

`DB_PATH` 환경 변수 또는 `--db-path <path>` 옵션으로 데이터베이스 파일 경로를 지정합니다. 기본값은 `~/.memento/memory.db`입니다.

`.env` 파일 탐색 순서는 다음과 같습니다.

1. `--env-file`로 지정한 파일
2. `--config-dir` 또는 `MEMENTO_CONFIG_DIR`이 가리키는 디렉터리의 `.env`
3. 현재 작업 디렉터리의 `.env`
4. `~/.memento/.env`

### 권장 실행 형태

상황에 따라 세 가지 실행 방식 중 하나를 선택합니다.

```bash
# 다른 프로젝트에서 패키지를 임시로 사용하는 경우
npm exec --package memento-mcp-server -- memento <명령>

# memento-mcp-server가 현재 프로젝트의 로컬 의존성으로 설치된 경우
npm exec -- memento <명령>

# 글로벌 설치 후 (반복 사용에 권장)
memento <명령>
```

AI 에이전트가 `recall`/`remember`를 자주 호출하는 경우, `npm exec`나 `npx`의 프로세스 시작 오버헤드가 누적될 수 있습니다. 반복 사용이 많다면 글로벌 설치 또는 로컬 설치 후 바이너리를 직접 실행하는 방식을 권장합니다.

## 명령 참조

### recall — 기억 검색

하이브리드 검색(FTS5 전문 검색 + 벡터 검색)으로 관련 기억을 반환합니다.

```bash
# 기본 검색
npm exec --package memento-mcp-server -- memento recall --query "프로젝트 결정 사항" --limit 5

# DB 경로를 명시하는 경우
npm exec --package memento-mcp-server -- memento --db-path /path/to/db.db recall --query "test" --limit 2

# 글로벌/로컬 설치 후 간단히
memento recall --query "프로젝트 결정 사항" --limit 5

# 타입과 태그로 필터링
memento recall --query "배포" --type "procedural" --tags "docker" --limit 10
```

성공 시 stdout에 `{"items":[...],"total_count":n,...}` 형태의 JSON이 출력되고 exit code는 0입니다.

### remember — 기억 저장

```bash
npm exec --package memento-mcp-server -- memento remember \
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

성공 시 stdout에 `memory_id` 등이 포함된 JSON이 출력되고 exit code는 0입니다.

### forget — 기억 삭제

```bash
# 소프트 삭제
npm exec --package memento-mcp-server -- memento forget --id mem_xxxxx

# 하드 삭제 (복구 불가)
npm exec --package memento-mcp-server -- memento forget --id mem_xxxxx --hard --confirm true
```

### memory_injection — 컨텍스트 주입

관련 기억을 요약해 프롬프트에 주입할 수 있는 형태로 반환합니다.

```bash
npm exec --package memento-mcp-server -- memento memory_injection \
  --query "이전에 논의한 보안 정책" \
  --token_budget 1000
```

### agent ask — 개인 지식 Agent

저장된 기억을 기반으로 LLM에게 질문하고 답변을 받습니다. Ollama, OpenAI, Gemini LLM을 지원합니다.

```bash
memento agent ask "지금까지 저장된 TypeScript 관련 결정 사항을 요약해줘"
```

LLM 제공자는 `LLM_PROVIDER` 환경 변수로 설정합니다(`openai`, `gemini`, `ollama`, `auto`).

## 전역 옵션

다음 옵션은 모든 서브커맨드 앞에 올 수 있습니다.

```bash
memento --db-path <path>      # 데이터베이스 파일 경로 지정
memento --env-file <file>     # .env 파일 경로 지정
memento --config-dir <dir>    # 설정 디렉터리 지정
```

## 출력 규칙

CLI는 AI 에이전트와 스크립트가 직접 출력을 파싱할 수 있도록 설계되었습니다.

성공 시에는 **stdout에 JSON만** 출력됩니다. Memento 내부의 INFO, WARN, DEBUG 로그는 CLI 모드에서 억제되어 stdout이나 stderr에 섞이지 않습니다.

실패 시에는 **stderr**에 에러 메시지가 출력되고 **exit code는 non-zero**입니다.

단, onnxruntime 등 서드파티 라이브러리가 stderr에 직접 쓰는 메시지는 환경에 따라 보일 수 있습니다. 이는 CLI 자체의 오류가 아닙니다.
