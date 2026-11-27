#!/usr/bin/env bash
# Memento 저장 스키마 훅 — 프롬프트 제출 시 조회·저장 지시를 컨텍스트에 주입한다.
#
# 하나의 스크립트를 세 호스트가 공유한다 (지시문 원본을 한 곳에만 둔다).
#   memento-recall.sh          → Claude Code (~/.claude/settings.json  : UserPromptSubmit)
#   memento-recall.sh cursor   → Cursor      (~/.cursor/hooks.json     : beforeSubmitPrompt)
#   memento-recall.sh codex    → Codex       (~/.codex/hooks.json      : UserPromptSubmit)
#
# 두 번째 인자 session → 세션 시작·compact 직후용 프로젝트 브리프 주입 지시 (#1271)
#   memento-recall.sh claude session → Claude Code (SessionStart, compact 포함)
#   memento-recall.sh codex session  → Codex       (SessionStart)
#
# Claude Code 의 질문마다 모드는 stdin 의 prompt 가 기계 알림이면 아무것도 출력하지 않는다 (#1770)

HOST="${1:-claude}"
MODE="${2:-prompt}"

# stdin 이 닫혔거나 터미널이면 읽을 입력이 없다. 닫힌 채 3<&0 하면 훅이 실패하고, 터미널이면 EOF 를 기다리며 멈춘다.
{ [ -e /dev/fd/0 ] && [ ! -t 0 ]; } || exec </dev/null

# heredoc 이 stdin(프로그램)을 쓰므로 훅 입력 JSON 은 fd 3 으로 넘긴다. 인자나 env 는 큰 알림에서 길이 제한에 걸린다.
python3 - "$HOST" "$MODE" 3<&0 <<'EOF'
import json, re, sys

host = sys.argv[1] if len(sys.argv) > 1 else "claude"
mode = sys.argv[2] if len(sys.argv) > 2 else "prompt"

msg = (
    "[Memento 자동 훅] 이번 요청을 처리하기 전에 반드시 아래 순서를 따르세요.\n\n"
    "1. 작업 시작 전: mcp__memento__memory_injection 도구를 호출해 "
    "이전 세션의 관련 기억을 로드하세요. "
    "호출 시 query 에 지금 일의 주제와 찾을 것을 핵심 낱말로 담으세요. 이슈 번호, 기능 이름, 파일을 앞에 둡니다. 조사와 어미는 빼도 됩니다. 발화에 주제가 없으면(「진행해줘」) 앞 대화의 주제를 넣습니다.\n\n"
    "2. 작업 완료 후: mcp__memento__remember 로 저장하세요. 타입마다 기준이 다릅니다.\n"
    "   - episodic (태그 completed): 완료 작업. content 에 라벨을 넣지 말고 record 필드로 저장하세요.\n"
    "     record.decision: 무엇을 하기로 했는가\n"
    "     record.rationale: 측정값, 에러 원문, file:line. 비어 있으면 저장하지 마세요.\n"
    "     record.rejected: 검토했지만 고르지 않은 것과 이유\n"
    "     record.failed: 실패한 시도와 원인. 없으면 빈 문자열\n"
    "     record.next_blocker: 다음 세션이 막힐 지점\n"
    "     type 은 episodic. failed 만 빈 문자열을 허용합니다.\n"
    "   - semantic (태그 knowledge) / procedural (태그 procedure): 세 조건을 모두 만족할 때만 저장합니다. "
    "문제가 반복된다. 내용이 결정 근거, 여러 단계의 우회, 다시 쓰는 절차다. "
    "다음 에이전트가 검색 결과를 그대로 쓴다. 5줄 라벨 없이 지식이나 절차 자체를 씁니다.\n"
    "   - 공통: 코드를 붙여 넣지 마세요. 저장소 상대 경로, 함수나 클래스 이름, 바뀐 시그니처, 확정한 상수만 적습니다.\n\n"
    "저장 전에 중복 기억이 있는지 mcp__memento__recall 로 검색하세요. "
    "갱신할 대상이 있으면 recall 결과의 memory_id 를 mcp__memento__remember 의 "
    "memory_id 파라미터에 그대로 넣고 update_mode "
    "(replace | incremental | versioned) 를 함께 주세요. "
    "memory_id 없이 update_mode 만 주면 새 기억이 저장됩니다 (#1000). "
    "대상의 type·owner_id·project_id 가 요청과 일치해야 하며, "
    "응답에 updated: true 가 있어야 실제로 갱신된 것입니다."
)

# 백그라운드 작업 알림은 태그로 시작한다. 태그 앞에 다른 글이 있는 prompt 는 알림이 아니다.
NOTIFICATION = re.compile(r"\s*(?:<system-reminder>\s*)?\[SYSTEM NOTIFICATION|\s*<task-notification>")

event = "UserPromptSubmit"
full_msg = msg
if host == "claude" and mode != "session":
    try:
        with open(3, encoding="utf-8") as hook_input:
            is_notification = bool(NOTIFICATION.match(json.load(hook_input)["prompt"]))
    except Exception:  # 입력을 못 읽으면 안내를 빼지 않는다
        is_notification = False
    if is_notification:
        sys.exit(0)
    # #1770: 저장 형식 전문(약 1,000자)은 세션 시작과 compact 직후에만 싣고, 질문마다는 한 줄만 싣는다.
    # Cursor, Codex 는 세션 시작 훅이 없어 그대로 전문을 싣는다.
    msg = (
        "[Memento 자동 훅] 작업 전 mcp__memento__memory_injection(query=지금 일의 주제와 찾을 것의 핵심 낱말, "
        "이슈 번호, 기능 이름, 파일을 앞에), 실질 작업 뒤 mcp__memento__remember. "
        "저장 형식(record 필드, 중복 검색, memory_id 갱신)은 세션 시작 때 받은 안내와 CLAUDE.md 를 따른다."
    )
if mode == "session":
    # 매 턴 호출은 브리프 전문을 싣지 않는다 — 세션 시작·compact 직후에만 전문을 받는다 (#1271)
    event = "SessionStart"
    msg = (
        "[Memento 세션 시작 훅] 첫 작업 전에 mcp__memento__memory_injection 을 "
        "include_project_brief: true 로 한 번 호출해 이 프로젝트의 브리프"
        "(기획·결정·다음 할 일)를 읽으세요. query 에는 첫 요청의 주제를 핵심 낱말로 담습니다(이슈 번호, 기능 이름을 앞에). "
        "브리프는 결과 맨 앞에 붙고, 없으면 일반 결과만 옵니다. "
        "이후 턴의 memory_injection 호출에는 include_project_brief 를 넣지 마세요."
    )
    if host == "claude":
        msg += "\n\n" + full_msg.replace("이번 요청을 처리하기 전에", "이 세션의 모든 요청에서")

if host == "cursor":
    # Cursor 네이티브 스키마 (~/.cursor/hooks/session-start.sh 와 동일한 필드명)
    out = {"additional_context": msg, "continue": True}
else:
    # Claude Code와 Codex는 hookSpecificOutput 스키마를 사용한다.
    out = {
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": msg,
        }
    }

print(json.dumps(out, ensure_ascii=False))
EOF
