#!/usr/bin/env bash
# Claude Code PreToolUse(Bash) 훅 — 에이전트가 PR 을 머지 게이트 없이 머지하지 못하게 막는다.
# 머지는 `node scripts/pr-merge-gate.ts <PR> --merge` 로만 한다 (risk 라벨별 규칙은 그 스크립트에).
# 사용자 승인 라벨(approved:human)은 사용자만 단다 — 에이전트 명령에 그 이름이 들어가면 막는다.
# 사용자가 직접 실행하는 `! <command>` 는 도구 호출이 아니라 이 훅을 거치지 않는다.
set -euo pipefail

# 명령 문자열을 못 읽으면(깨진 JSON, 빈 입력, 필드 없음, jq 없음) 통과시키지 않고 막는다. 종료 2 만 도구 호출을 막는다.
# jq 1.6 은 빈 입력에 종료 0 을 내므로 빈 결과도 본다.
if ! cmd=$(jq -r '.tool_input.command | strings' 2>/dev/null) || [[ -z $cmd ]]; then
  echo "훅이 입력을 읽지 못해 이 명령을 막는다. jq 설치와 훅 입력을 확인할 것: $0" >&2
  exit 2
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

if grep -qE 'approved:human' <<<"$cmd"; then
  deny "approved:human 라벨은 사용자만 단다. high PR 은 다른 Claude 모델 리뷰, explain-diff 요약을 보여주고 사용자 승인을 요청할 것."
fi
if grep -qF -e '--allow-review-overflow' <<<"$cmd"; then
  deny "3회 상한 넘기기는 사용자만 한다. 사용자에게 '! node scripts/pr-merge-gate.ts <번호> --merge --allow-review-overflow' 실행을 요청할 것."
fi
if grep -qE 'gh[[:space:]]+pr[[:space:]]+merge|pulls/[0-9]+/merge' <<<"$cmd"; then
  deny "PR 을 직접 머지하지 말고 'node scripts/pr-merge-gate.ts <PR> --merge' 를 쓸 것 (risk 라벨별 머지 규칙 — docs/agents/commands.md)."
fi
exit 0
