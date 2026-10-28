# Case 지침 주입 가이드

에이전트에게 준 지침을 파일 하나에 쌓으면 파일이 계속 길어집니다. 훅이 앞부분만 주입하면 뒤쪽 지침은 조용히 빠지고, 지침을 지우면 예전 실수가 다시 나옵니다. Case 지침 주입은 지침을 한 줄씩 `case` 기억으로 저장해 두고, 프롬프트마다 관련 있는 것만 골라 넣습니다. 지침이 늘어도 주입 크기는 일정합니다.

영문 문서: [case-directive-injection.md (EN)](../en/case-directive-injection.md). 설계 배경은 [ADR](../../adr/2026-10-25-issue-1486-case-directive-injection.md)에 있습니다.

## 동작

1. 호스트가 프롬프트를 보내면 훅이 `memento hook claude-code` / `memento hook codex` / `memento hook cursor` 를 실행합니다.
2. 훅은 프롬프트 앞 500자로 후보를 고릅니다(최대 15개). 후보는 memento 서버 `case` 기억이거나, `MEMENTO_DIRECTIVES_CASES_DIR` 마크다운 폴더입니다.
3. 300자를 넘는 case 는 건너뛰고, 이 세션에서 이미 넣은 case 도 뺍니다. 남은 것을 순위대로 최대 5개, 본문 합계 4,500 bytes 까지 고릅니다.
4. 고정 지침 파일(pinned)이 있으면 맨 앞에 붙입니다.
5. `live` 모드면 호스트 스키마로 컨텍스트를 넘깁니다. Claude Code와 Codex는 `hookSpecificOutput.additionalContext`, Cursor(`beforeSubmitPrompt`)는 `additional_context` + `continue: true` 입니다. `shadow` 모드면 넘기지 않고 로그만 씁니다.
6. Claude Code와 Codex의 `PreCompact` 에서 세션 중복 기록을 초기화합니다. compact 로 사라진 지침이 다시 들어갈 수 있게 합니다.

후보 소스가 없거나 recall 이 1.5초 안에 끝나지 않으면 출력은 비고, 로그에 `fallback:true` 한 줄이 남습니다. 훅은 항상 exit 0 이라 호스트를 막지 않습니다. 세 호스트는 같은 선택·중복 제거·로그 계약을 쓰고, stdout 래퍼만 다릅니다.

관련도 하한은 `DIRECTIVE_POLICY.minFinalScore`의 `0.5`입니다. `final_score`가 이 값 이상인 후보만 고릅니다. 점수가 없거나 유한한 숫자가 아니면 제외합니다. 기존 중복 제거·300자·5개·4,500 bytes 제한은 그대로 적용합니다.

기존 shadow 로그 61줄(case 51건)에는 점수가 없어 분포로 하한을 보정하지 못했습니다. `0.5`는 초기값이며, 새 로그의 `candidates[{id, final_score}]`로 하한 미만을 포함한 전체 유효 후보의 분포를 확인해 조정합니다.

## 준비

두 경로 중 하나만 있으면 됩니다.

- **마크다운 폴더(서버 불필요, 권장 입문 경로):** 아래 «서버 없이 마크다운 폴더» 절.
- **memento 서버:** 실행 중인 HTTP 서버(`~/.memento/server.json`), `MEMENTO_API_TOKENS` 에 등록한 토큰을 `MEMENTO_API_KEY` 로 전달.

공통: 전역 설치한 memento CLI. `npx` 는 첫 기동이 수십 초라 훅에 쓰지 않습니다.

## 서버 없이 마크다운 폴더

서버를 띄우지 않고 지침 파일만으로 같은 주입·로그 계약을 씁니다.

1. 폴더를 만듭니다. 예: `mkdir -p ~/memento-cases`
2. `.md` 파일을 넣고, **지침 한 줄 = case 하나**로 적습니다. `#` 제목 줄과 빈 줄은 무시합니다. 파일 맨 앞 YAML frontmatter(`---`)도 무시합니다.

```text
# git.md
risk:low PR 은 CI 통과 후 직접 머지한다
medium/high risk PR 은 사용자에게 묻는다
```

3. 래퍼에 한 줄을 추가합니다.

```bash
export MEMENTO_DIRECTIVES_CASES_DIR="$HOME/memento-cases"
```

`MEMENTO_DIRECTIVES_CASES_DIR` 이 있으면 서버 recall 보다 폴더를 먼저 씁니다. API 키와 서버는 필요 없습니다. lifecycle 캡처까지 끄려면 `MEMENTO_CAPTURE=0` 도 함께 둡니다.

4. 확인: `MEMENTO_DIRECTIVES_MODE=shadow` 로 하루 쓰고 로그를 봅니다.

```bash
jq -c 'select(.inj_id) | {ts, n: (.cases | length), fallback, ids: [.cases[].id]}' \
  ~/.claude/state/directive-log/injections-*.jsonl
```

`cases` 에 기대한 줄이 보이면 `live` 로 올립니다. 폴더 매칭은 지침 단어가 프롬프트에 얼마나 등장하는지로 점수를 매깁니다. 관련 단어가 절반 이상 겹치면 후보에 남습니다.

## 1. 지침을 case 로 저장 (서버 경로)

지침 한 줄을 semantic 기억 하나로 저장하고 `case` 태그를 붙입니다. 300자를 넘는 지침은 둘로 나눠 저장합니다.

```javascript
remember({
  type: "semantic",
  content: "risk:low PR 은 CI 통과 후 직접 머지한다. medium/high 는 사용자에게 묻는다.",
  tags: ["case"]
});
```

항상 지켜야 하는 소수 지침(1KB 이하)은 case 대신 pinned 파일에 둡니다. 예: `~/.claude/pinned-directives.md`.

## 2. 훅 등록

래퍼 스크립트에서 환경 변수를 정하고 CLI 를 실행합니다. API 키를 `settings.json` 의 `env` 에 넣으면 Claude Code 가 띄우는 모든 프로세스에 키가 퍼지므로, 래퍼 안에서 읽는 편이 안전합니다.

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/memento-directives.sh  (Codex·Cursor 도 HOST 만 바꿔 재사용)
HOST="${1:-claude-code}"   # claude-code | codex | cursor
export MEMENTO_DIRECTIVES=1
export MEMENTO_DIRECTIVES_MODE=shadow
export MEMENTO_DIRECTIVES_PINNED_FILE="$HOME/.claude/pinned-directives.md"
export MEMENTO_API_KEY="<MEMENTO_API_TOKENS 에 등록한 토큰을 읽어 오는 명령>"
exec memento hook "$HOST"
```

전역 설치에 `memento` 명령이 없으면([#1492](https://github.com/jee1/memento/issues/1492)) 마지막 줄을 `exec node "$(npm root -g)/memento-mcp-server/dist/cli.js" hook "$HOST"` 로 바꿉니다.

**Claude Code** — `~/.claude/settings.json` 의 `UserPromptSubmit` 과 `PreCompact`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/memento-directives.sh claude-code", "timeout": 5 }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/memento-directives.sh claude-code", "timeout": 5 }] }
    ]
  }
}
```

**Codex** — `~/.codex/hooks.json` 의 `UserPromptSubmit` 과 `PreCompact` 에 `memento hook codex` 래퍼를 등록합니다 (`memento connect codex` 가 lifecycle 핸들러를 넣을 때와 같은 파일).

**Cursor** — `~/.cursor/hooks.json` 의 `beforeSubmitPrompt` 에 `memento hook cursor` 래퍼를 등록합니다. Cursor 경로는 lifecycle 캡처 없이 지침 주입만 합니다.

Claude Code와 Codex 훅은 lifecycle 캡처도 함께 실행합니다. 프롬프트 원문이 로컬 서버에 observation 으로 저장됩니다. lifecycle 캡처를 끄고 지침 주입만 쓰려면 `MEMENTO_CAPTURE=0`으로 설정합니다 (#1494).

## 3. shadow 로그 확인

`shadow` 는 에이전트 출력을 바꾸지 않고 "주입했다면 무엇을 골랐을지"만 기록합니다. 며칠 돌린 뒤 로그를 봅니다.

```bash
jq -c 'select(.inj_id) | {ts, n: (.cases | length), fallback, ids: [.cases[].id]}' \
  ~/.claude/state/directive-log/injections-*.jsonl
```

확인할 것:

- 에이전트가 지침을 어겼을 때 그 지침이 해당 프롬프트의 `cases` 에 있었는지.
- 관련 없는 case 가 자주 끼는지([#1493](https://github.com/jee1/memento/issues/1493)).
- `cases[].final_score`와 `candidates[].final_score`를 비교해 관련도 하한 아래 후보가 제외됐는지.
- `fallback:true` 가 잦은지. 잦으면 서버 상태와 토큰을 봅니다.

로그 한 줄의 필드는 `inj_id`, `ts`, `session_id`, `cwd`, `mode`, `prompt_sha1`, `cases[{id, sha1, text}]`, `skipped`, `fallback`, `context_text` 입니다. 초기화 줄은 `{session_id, reset: true, ts}` 입니다.

새 주입 로그는 `cases[].final_score`와 `candidates[{id, final_score}]`도 기록합니다. 기존 로그의 중복 판정은 점수 필드 없이도 그대로 동작합니다.

## 4. live 로 전환

래퍼의 `MEMENTO_DIRECTIVES_MODE` 를 `live` 로 바꿉니다. 이후 프롬프트에는 아래 모양의 컨텍스트가 붙습니다.

```text
[inj:<session 앞 8자>-<epoch ms>-<prompt sha1 앞 6자>]
<pinned 지침>
- <case 본문>
[cases-in-context: <이 세션에서 넣은 case id>]
```

`inj_id` 로 "그때 어떤 지침이 컨텍스트에 있었는지"를 로그에서 찾을 수 있습니다.

## 환경 변수

| 변수 | 뜻 |
|------|----|
| `MEMENTO_DIRECTIVES` | `1` 또는 `true` 일 때만 켭니다 |
| `MEMENTO_DIRECTIVES_MODE` | `shadow`(기본) 또는 `live` |
| `MEMENTO_DIRECTIVES_PINNED_FILE` | 매번 앞에 붙일 고정 지침 파일(1KB 이하) |
| `MEMENTO_DIRECTIVES_LOG_DIR` | 로그 폴더. 기본 `~/.claude/state/directive-log` |
| `MEMENTO_DIRECTIVES_CASES_DIR` | 서버 없이 읽을 마크다운 case 폴더. 설정 시 서버 recall 보다 우선 |
| `MEMENTO_CONFIG_DIR` | `server.json` 이 있는 폴더. 기본 `~/.memento` |
| `MEMENTO_API_KEY` | 서버 API 토큰(폴더 경로에서는 불필요) |

## 한계

- 마크다운 폴더는 로컬 단어 겹침으로만 고릅니다. 서버 임베딩 recall 만큼 의미 매칭은 하지 않습니다.
- Cursor 는 `beforeSubmitPrompt` 만 지원합니다. compact 후 중복 초기화는 Claude Code/Codex `PreCompact` 경로에만 있습니다.
