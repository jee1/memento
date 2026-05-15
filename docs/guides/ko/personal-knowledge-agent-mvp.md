# 개인 지식 Agent MVP — CLI 사용 가이드 (한국어)

이 문서는 **로컬 SQLite DB**와 **`memento agent ask`** 서브커맨드만으로, 질문 → 컨텍스트 주입 → mock LLM 응답 → 지식 후보 → 터미널 승인 → `remember` 저장까지의 **MVP 한 턴**을 실행하는 방법을 설명합니다.  
(MCP/HTTP 서버·실제 LLM provider·대시보드는 범위 밖입니다. 관련 이슈: [#82](https://github.com/jee1/memento/issues/82), [#236](https://github.com/jee1/memento/issues/236), [#237](https://github.com/jee1/memento/issues/237).)

## 전제 조건

- 저장소 루트에서 `npm install` 및 `npm run build` 완료.
- CLI 진입점: `node packages/memento-server/dist/cli.js` (또는 배포본의 `memento`가 PATH에 있는 경우 `memento`).
- **로컬 DB 파일**을 쓰려면 `--db-path <파일>`을 지정합니다. (기본 `recall` / `remember` 도구 CLI는 서버 모드 전제가 많으니, 이 가이드는 **에이전트 ask 경로**에 맞춥니다.)

## 1. DB 준비 및 시드

```bash
DB=./tmp-memento-agent.db
node packages/memento-server/dist/cli.js --db-path "$DB" remember "프로젝트 A 전용 결정 문서" \
  --type semantic --project-id my-app
```

`--project-id`가 같은 기억끼리 `memory_injection` / Agent 컨텍스트에서 묶입니다 (프로젝트 스코프 메모리, 이슈 #81).

## 2. 한 턴 실행 (TTY, 승인 저장)

```bash
node packages/memento-server/dist/cli.js --db-path "$DB" agent ask \
  "앞으로는 커밋 메시지는 영어로 쓰고 싶어" \
  --project-id my-app \
  --llm mock
```

- stderr에 LLM 요약·후보 목록이 표시되고, stdout **마지막 한 줄**은 JSON 결과입니다.
- 각 후보마다 `(y)es / (n)o / (s)kip rest / (q)uit & save approved` 프롬프트가 뜹니다.  
  - `y`: 해당 후보를 승인해 `remember`에 반영합니다.  
  - 빈 줄 또는 `n`: 거절(저장 안 함).  
  - `s` / `q`: 남은 질문을 건너뛰고, 지금까지 `y`로 승인한 항목만 저장합니다.

## 3. 스크립트·CI용 (`--json` / `--no-save`)

- `--json --no-save`: stdout에 **JSON 한 줄만** (저장 단계 생략, 인터랙션 없음).
- `--json`만 주면 설계상 **저장 생략**과 동일하며, stderr에 한 줄 안내가 붙을 수 있습니다.

```bash
node packages/memento-server/dist/cli.js --db-path "$DB" agent ask "짧은 질문" \
  --project-id my-app --llm mock --json --no-save
```

## 4. 비TTY 환경에서의 제약

표준 입력이 TTY가 아니면 **저장·승인 루프**를 쓰려면 반드시 `--json` 또는 `--no-save`가 필요합니다. 그렇지 않으면 exit `1`입니다.  
자동화에서 **승인 저장까지** 검증하려면 Vitest 등 in-process 테스트에서 `runAgentAskMain`의 **런타임 훅**(`stdinIsTTY` / `promptApprove`)을 사용합니다(구현: `packages/memento-server/src/cli/agent-ask.ts`, 예시: `agent-ask-issue237.e2e.spec.ts`).

## 5. 제외·후속 범위

- 실제 OpenAI/Gemini 등 provider 연결: [#238](https://github.com/jee1/memento/issues/238) 트랙.
- HTTP MCP로 Agent 위임: [#390](https://github.com/jee1/memento/issues/390) 등.
- 대시보드·자동 리뷰 문서: 이 MVP 가이드 범위 밖.

## 6. 관련 문서

- CLI 설계(옵션·JSON 스키마·exit code): `docs/superpowers/specs/2026-05-14-issue-236-agent-ask-cli-design.md`
- 기존 CLI·클라이언트 개요: `docs/guides/ko/user-manual.md`
