#!/usr/bin/env bash
# git commit 직전: revise-claude-md 스킬로 AGENTS.md·CLAUDE.md 갱신 후 스테이징.
# Cursor beforeShellExecution 훅 — stdin JSON, stdout permission JSON.

set -uo pipefail

STATE_DIR=".cursor/hooks/state"
STATE_FILE="${STATE_DIR}/revise-claude-md.json"
SKILL_FILE="${HOME}/.cursor/skills/revise-claude-md/SKILL.md"
AGENT_DEF="${HOME}/.cursor/agents/pre-commit-revise-claude-md.md"

escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

emit_allow() {
  printf '{"permission":"allow"}\n'
}

emit_deny() {
  local user_msg="$1"
  local agent_msg="$2"
  printf '{"permission":"deny","user_message":"%s","agent_message":"%s"}\n' \
    "$(escape_for_json "$user_msg")" \
    "$(escape_for_json "$agent_msg")"
}

if [[ "${CURSOR_PRE_COMMIT_HOOKS_SKIP:-}" == "1" ]]; then
  emit_allow
  exit 0
fi

if [[ "${REVISE_CLAUDE_MD_SKIP:-}" == "1" ]]; then
  emit_allow
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  emit_deny \
    "Pre-commit revise-claude-md error: jq is not installed." \
    "Install jq to run the revise-claude-md pre-commit hook."
  exit 2
fi

AGENT_BIN="${AGENT_BIN:-$(command -v agent 2>/dev/null || true)}"
if [[ -z "$AGENT_BIN" ]]; then
  emit_deny \
    "Pre-commit revise-claude-md error: Cursor agent CLI is not installed." \
    "Install the Cursor agent CLI (command: agent) or set AGENT_BIN."
  exit 2
fi

input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')
cwd=$(echo "$input" | jq -r '.cwd // empty')

if ! [[ "$command" =~ git[[:space:]]+commit ]]; then
  emit_allow
  exit 0
fi

project_root="${cwd:-$PWD}"
if ! git -C "$project_root" rev-parse --git-dir >/dev/null 2>&1; then
  emit_allow
  exit 0
fi

has_memory_file=false
for candidate in AGENTS.md CLAUDE.md; do
  if [[ -f "${project_root}/${candidate}" ]]; then
    has_memory_file=true
    break
  fi
done
if [[ "$has_memory_file" != "true" ]]; then
  emit_allow
  exit 0
fi

staged_names="$(git -C "$project_root" diff --cached --name-only 2>/dev/null || true)"
if [[ -z "$staged_names" ]]; then
  emit_allow
  exit 0
fi

# 메모리 파일만 커밋하는 경우 스킵
if ! echo "$staged_names" | grep -qvE '^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursor/hooks/state/)'; then
  emit_allow
  exit 0
fi

staged_diff="$(git -C "$project_root" diff --cached --no-color 2>/dev/null || true)"
staged_hash="$(printf '%s' "$staged_diff" | sha256sum | awk '{print $1}')"

mkdir -p "${project_root}/${STATE_DIR}"
if [[ -f "${project_root}/${STATE_FILE}" ]]; then
  prev_hash="$(jq -r '.staged_hash // empty' "${project_root}/${STATE_FILE}" 2>/dev/null || true)"
  if [[ "$prev_hash" == "$staged_hash" ]]; then
    emit_allow
    exit 0
  fi
fi

max_diff_chars="${REVISE_CLAUDE_MD_MAX_CHARS:-80000}"
if (( ${#staged_diff} > max_diff_chars )); then
  staged_diff="${staged_diff:0:max_diff_chars}

... [staged diff truncated at ${max_diff_chars} chars]"
fi

agent_instructions=""
if [[ -f "$AGENT_DEF" ]]; then
  agent_instructions="$(awk 'BEGIN{n=0} /^---$/ {n++; next} n>=2' "$AGENT_DEF")"
fi

skill_text=""
if [[ -f "$SKILL_FILE" ]]; then
  skill_text="$(cat "$SKILL_FILE")"
fi

review_log="$(mktemp)"
review_prompt_file="$(mktemp)"
trap 'rm -f "$review_log" "$review_prompt_file"' EXIT

{
  printf '%s\n\n' "$agent_instructions"
  if [[ -n "$skill_text" ]]; then
    printf '## revise-claude-md skill\n\n%s\n\n' "$skill_text"
  fi
  cat <<'PROMPT'
## 작업

staged diff와 이번 세션 맥락을 바탕으로 `revise-claude-md`를 수행하라.

- **우선** `AGENTS.md` §3.1 Gotchas 등 기존 섹션을 **제자리 수정** (한 줄·불릿, 중복·일회성 제외)
- `CLAUDE.md`는 이 저장소가 AGENTS.md로 위임하면 건드리지 않아도 됨
- 의미 있는 갱신이 없으면 파일을 수정하지 말 것
- `git commit` 등 shell 실행 금지

## 출력 (마지막 줄 필수)

```
REVISE_CLAUDE_MD_JSON={"updated":false}
```

또는

```
REVISE_CLAUDE_MD_JSON={"updated":true,"files":["AGENTS.md"]}
```

`files`에는 실제로 수정한 경로만 포함한다.

## STAGED GIT DIFF

PROMPT
  printf '%s\n' '```diff'
  printf '%s\n' "$staged_diff"
  printf '%s\n' '```'
} >"$review_prompt_file"

set +e
CURSOR_PRE_COMMIT_HOOKS_SKIP=1 REVISE_CLAUDE_MD_SKIP=1 \
  "$AGENT_BIN" --print --trust --workspace "$project_root" \
  "$(cat "$review_prompt_file")" >"$review_log" 2>&1
agent_exit=$?
set -e

json_line="$(grep -E '^REVISE_CLAUDE_MD_JSON=' "$review_log" | tail -1 | sed 's/^REVISE_CLAUDE_MD_JSON=//')"
if [[ -z "$json_line" ]]; then
  log_tail=$(tail -n 40 "$review_log")
  emit_deny \
    "Commit blocked: revise-claude-md hook did not return a valid result." \
    "revise-claude-md agent failed (exit ${agent_exit}) or returned unparseable output. Last log lines:\n${log_tail}"
  exit 2
fi

updated="$(echo "$json_line" | jq -r '.updated // false' 2>/dev/null || true)"
if [[ "$updated" == "true" ]]; then
  mapfile -t touched_files < <(echo "$json_line" | jq -r '.files[]? // empty' 2>/dev/null || true)
  for rel in "${touched_files[@]}"; do
    [[ -z "$rel" ]] && continue
    if [[ -f "${project_root}/${rel}" ]]; then
      git -C "$project_root" add -- "$rel"
    fi
  done
  # 에이전트가 files를 누락했을 때 워킹트리 변경 감지
  for candidate in AGENTS.md CLAUDE.md; do
    if git -C "$project_root" diff --name-only -- "$candidate" 2>/dev/null | grep -q .; then
      git -C "$project_root" add -- "$candidate"
    fi
  done
fi

printf '{"staged_hash":"%s","updated":%s,"at":"%s"}\n' \
  "$staged_hash" \
  "$( [[ "$updated" == "true" ]] && printf 'true' || printf 'false' )" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"${project_root}/${STATE_FILE}"

emit_allow
exit 0
