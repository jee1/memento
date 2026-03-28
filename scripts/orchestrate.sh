#!/usr/bin/env bash
# scripts/orchestrate.sh
#
# 자동화 개발 루프:
#   Phase 1: 계획 (claude + speckit)
#     1a. [헌법 없으면] speckit.constitution
#     1b. speckit.specify → speckit.clarify (명확해질 때까지 반복)
#     1c. speckit.plan → speckit.tasks → speckit.analyze (이슈 없을 때까지 반복)
#   Phase 2-3: 구현+리뷰 루프 (agent + codex)
#     2. agent  — 구현/수정
#     3. codex  — 리뷰 → 이슈 있으면 2로, 없으면 다음
#   Phase 4: 스펙 정합성 검증 (claude)
#     이슈 있으면 Phase 2-3 재진입, 없으면 종료
#
# 사용법:
#   ./scripts/orchestrate.sh "feature description"
#   SKIP_PLAN=1 ./scripts/orchestrate.sh      # 계획 단계 건너뜀
#   MAX_REVIEW_ITER=3 ./scripts/orchestrate.sh "..."

set -euo pipefail

# ── 도움말 ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
사용법: $(basename "$0") [OPTIONS] "feature description"

세 개의 AI CLI를 조합한 자동화 개발 루프입니다.
  claude (계획·검증)  →  agent/Cursor (구현·수정)  →  codex (리뷰)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
전체 흐름
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Phase 1 — 계획 (claude + speckit)
    1a. 헌법 확인
          .specify/memory/constitution.md 가 없으면 speckit.constitution 실행
          헌법은 이후 모든 spec/plan/tasks 의 품질 기준이 됩니다

    1b. 사양 명확화 루프  [최대 MAX_CLARIFY_ITER 회]
          speckit.specify  → spec.md 초안 생성
          speckit.clarify  → 모호한 부분에 대해 최대 5개 질문 생성
            └─ 질문이 있으면 답변 입력 후 재clarify (타임아웃 30초)
            └─ 질문 없으면(CLARIFY_DONE) 다음 단계로

    1c. 계획 확정 루프  [최대 MAX_ANALYZE_ITER 회]
          speckit.plan     → plan.md 생성 (아키텍처·의존성·구현 순서)
          speckit.tasks    → tasks.md 생성 (ID별 실행 가능한 태스크 목록)
          speckit.analyze  → spec/plan/tasks 간 일관성 분석
            └─ CRITICAL·HIGH 이슈 있으면 spec/plan 수정 후 재반복
            └─ 이슈 없으면(ANALYZE_CLEAN) Phase 2로

  Phase 2-3 — 구현·리뷰 루프 (agent + codex)  [최대 MAX_REVIEW_ITER 회]
    agent (Cursor)  → tasks.md 기반으로 코드 구현 또는 이슈 수정
    codex           → uncommitted 변경사항 코드 리뷰 (JSON 출력)
      └─ 이슈 있으면 이슈 목록을 agent에 전달하고 재반복
      └─ 이슈 없으면 Phase 4로

  Phase 4 — 스펙 정합성 검증 (claude)  [최대 MAX_SPEC_ITER 회]
    claude(speckit.analyze) → 구현 코드가 spec과 일치하는지 확인
      └─ 이슈 있으면 Phase 2-3 루프 재진입
      └─ 이슈 없으면 완료 🎉

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  -h, --help           이 도움말 출력
  --from-phase N       N 단계부터 재시작 (1~4, 기본: 1)
                         1 = 처음부터 (계획 → 구현 → 검증)
                         2 = 구현부터  (spec/plan/tasks 이미 있을 때)
                         3 = 리뷰부터  (코드는 작성됐으나 리뷰 안 됨)
                         4 = 검증부터  (구현·리뷰 완료, 스펙 정합성만 확인)
  --skip-plan          --from-phase 2 와 동일 (하위 호환)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENVIRONMENT (루프 횟수 제어)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MAX_CLARIFY_ITER=N   specify→clarify 루프 최대 횟수 (기본: 5)
                       0 으로 설정하면 clarify 없이 specify 만 실행
  MAX_ANALYZE_ITER=N   plan→tasks→analyze 루프 최대 횟수 (기본: 3)
  MAX_REVIEW_ITER=N    agent→codex 리뷰 루프 최대 횟수 (기본: 5)
  MAX_SPEC_ITER=N      스펙 정합성 재검증 최대 횟수 (기본: 3)
  SKIP_PLAN=1          --skip-plan 과 동일

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
예시
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # 처음부터 전체 실행
  $(basename "$0") "recall quality feedback loop"

  # 이미 spec/plan/tasks 가 있을 때 구현부터 시작
  $(basename "$0") --from-phase 2

  # 코드는 있는데 리뷰부터 다시 하고 싶을 때
  $(basename "$0") --from-phase 3

  # 구현·리뷰는 완료, 스펙 정합성 검증만 다시 할 때
  $(basename "$0") --from-phase 4

  # clarify 없이 빠르게 진행 (질문 생략)
  MAX_CLARIFY_ITER=0 $(basename "$0") "simple bug fix"

  # 리뷰 루프를 최대 3회로 제한
  MAX_REVIEW_ITER=3 $(basename "$0") "new feature"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
로그
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  실행 로그는 logs/orchestrate-YYYYMMDD-HHMMSS.log 에 저장됩니다.
EOF
  exit 0
}

# ── 인자 파싱 ─────────────────────────────────────────────────────────────────
FROM_PHASE="${FROM_PHASE:-1}"  # 기본: Phase 1부터
FEATURE=""

_prev=""
for arg in "$@"; do
  case "$arg" in
    -h|--help)       usage ;;
    --skip-plan)     FROM_PHASE=2 ;;
    --from-phase)    _prev="from-phase" ;;
    --from-phase=*)  FROM_PHASE="${arg#*=}" ;;
    *)
      if [ "$_prev" = "from-phase" ]; then
        FROM_PHASE="$arg"; _prev=""
      else
        # 옵션이 아닌 첫 번째 인자를 feature로 사용
        [ -z "$FEATURE" ] && FEATURE="$arg"
      fi
      ;;
  esac
done

[[ "$FROM_PHASE" =~ ^[1-4]$ ]] || { echo "오류: --from-phase 는 1~4 사이 숫자여야 합니다."; exit 1; }

# ── 설정 ─────────────────────────────────────────────────────────────────────
MAX_REVIEW_ITER="${MAX_REVIEW_ITER:-5}"    # implement-review 루프 최대 횟수
MAX_SPEC_ITER="${MAX_SPEC_ITER:-3}"        # 스펙 재검증 최대 횟수
MAX_CLARIFY_ITER="${MAX_CLARIFY_ITER:-5}"  # specify-clarify 루프 최대 횟수
MAX_ANALYZE_ITER="${MAX_ANALYZE_ITER:-3}"  # plan-tasks-analyze 루프 최대 횟수
SKIP_PLAN="${SKIP_PLAN:-0}"               # 하위 호환
CONSTITUTION_FILE=".specify/memory/constitution.md"
REVIEW_TMP="/tmp/orchestrate_review_$$.txt"
SPEC_TMP="/tmp/orchestrate_spec_$$.txt"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/orchestrate-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"

# ── 유틸 ─────────────────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
die()  { log "ERROR: $*"; exit 1; }
hr()   { log "$(printf '─%.0s' {1..60})"; }

require() {
  command -v "$1" &>/dev/null || die "'$1' 명령어를 찾을 수 없습니다. 설치 후 재시도하세요."
}

require claude
require agent
require codex

# ── Phase 1: 계획 (speckit 워크플로우) ────────────────────────────────────────

# 1a. 헌법 생성 (없을 때만)
phase_constitution() {
  if [ -f "$CONSTITUTION_FILE" ]; then
    log "헌법 존재 확인: $CONSTITUTION_FILE — 건너뜀"
    return 0
  fi
  hr
  log "Phase 1a: Constitution 생성 (speckit.constitution)"
  hr
  claude --print "/speckit.constitution" | tee -a "$LOG_FILE"
  [ -f "$CONSTITUTION_FILE" ] || die "speckit.constitution 실행 후에도 $CONSTITUTION_FILE 없음"
  log "✅ Constitution 생성 완료"
}

# 1b. specify → clarify 반복 (명확해질 때까지)
phase_specify_clarify() {
  hr
  log "Phase 1b: Specify (speckit.specify)"
  hr
  claude --print "/speckit.specify $FEATURE" | tee -a "$LOG_FILE"

  for iter in $(seq 1 "$MAX_CLARIFY_ITER"); do
    hr
    log "Phase 1b: Clarify iteration $iter/$MAX_CLARIFY_ITER (speckit.clarify)"
    hr

    local clarify_out
    clarify_out=$(claude --print "
/speckit.clarify

After running clarify, respond with ONLY one of:
- CLARIFY_NEEDED if you asked questions and are waiting for answers
- CLARIFY_DONE if the spec is already clear and no questions were needed
" 2>&1 | tee -a "$LOG_FILE")

    if echo "$clarify_out" | grep -q "CLARIFY_DONE"; then
      log "✅ Spec 명확화 완료 ($iter번째 clarify에서 완료)"
      return 0
    fi

    log "clarify 질문이 있습니다 — 답변을 입력하세요 (비워두면 'no additional info' 사용):"
    local answer
    read -r -t 30 answer || answer=""
    [ -z "$answer" ] && answer="No additional information. Please make reasonable assumptions."

    claude --print "
Clarification answers: $answer

Apply these answers to spec.md and continue.
" | tee -a "$LOG_FILE"
  done

  log "WARNING: max clarify iterations ($MAX_CLARIFY_ITER) 도달 — 현재 spec으로 진행"
}

# 1c. plan → tasks → analyze 반복 (이슈 없을 때까지)
phase_plan_tasks_analyze() {
  for iter in $(seq 1 "$MAX_ANALYZE_ITER"); do
    hr
    log "Phase 1c: Plan iteration $iter/$MAX_ANALYZE_ITER"
    hr

    log "speckit.plan 실행..."
    claude --print "/speckit.plan" | tee -a "$LOG_FILE"

    log "speckit.tasks 실행..."
    claude --print "/speckit.tasks" | tee -a "$LOG_FILE"

    log "speckit.analyze 실행..."
    local analyze_out
    analyze_out=$(claude --print "
/speckit.analyze

After the analysis, respond with ONLY one of:
- ANALYZE_CLEAN if there are zero CRITICAL or HIGH severity issues
- ANALYZE_ISSUES: <comma-separated list of issue IDs> if CRITICAL or HIGH issues exist
" 2>&1 | tee -a "$LOG_FILE")

    if echo "$analyze_out" | grep -q "ANALYZE_CLEAN"; then
      log "✅ Plan/Tasks 분석 완료 — CRITICAL·HIGH 이슈 없음"
      return 0
    fi

    local issue_ids
    issue_ids=$(echo "$analyze_out" | grep "ANALYZE_ISSUES:" | sed 's/ANALYZE_ISSUES://' | tr -d ' ')
    log "CRITICAL/HIGH 이슈 발견: $issue_ids — plan/tasks 재생성"

    if [ "$iter" -eq "$MAX_ANALYZE_ITER" ]; then
      log "WARNING: max analyze iterations ($MAX_ANALYZE_ITER) 도달 — 현재 plan/tasks로 진행"
      return 0
    fi

    claude --print "
speckit.analyze에서 다음 이슈가 발견됐습니다: $issue_ids
spec.md와 plan.md를 수정해 이슈를 해소한 뒤 계속 진행하세요.
" | tee -a "$LOG_FILE"
  done
}

# Phase 1 진입점
phase_plan() {
  if [ "$SKIP_PLAN" = "1" ]; then
    log "SKIP_PLAN=1 — 계획 단계(Phase 1) 건너뜀"
    return 0
  fi

  [ -z "$FEATURE" ] && die "feature 설명을 인자로 전달하세요. 예: $0 'recall quality feedback loop'"

  phase_constitution
  phase_specify_clarify
  phase_plan_tasks_analyze
  log "✅ Phase 1 완료 — spec/plan/tasks 준비됨"
}

# ── Phase 2: 구현 (Cursor Agent) ──────────────────────────────────────────────
phase_implement() {
  local prompt="$1"
  hr
  log "Phase 2: Implementing with Cursor Agent"
  log "Prompt: $prompt"
  hr

  agent --print --trust --yolo "$prompt" | tee -a "$LOG_FILE"
}

# ── Phase 3: 리뷰 (Codex) ─────────────────────────────────────────────────────
# 반환값: 0 = clean, 1 = 이슈 있음
# $REVIEW_TMP 에 리뷰 전문 저장
phase_review() {
  hr
  log "Phase 3: Code review with Codex"
  hr

  # codex review는 uncommitted 변경사항을 리뷰
  # --output-last-message 로 결과 캡처
  codex exec \
    --full-auto \
    --ephemeral \
    --output-last-message "$REVIEW_TMP" \
    "
Review the current git diff (uncommitted changes).
Be strict and thorough.

Respond ONLY in this exact JSON format (no markdown, no explanation outside JSON):
{
  \"clean\": <true if there are zero issues, false otherwise>,
  \"issues\": [
    \"<concise description of issue 1>\",
    \"<concise description of issue 2>\"
  ],
  \"summary\": \"<one-line overall verdict>\"
}
" 2>&1 | tee -a "$LOG_FILE" || true

  if [ ! -f "$REVIEW_TMP" ]; then
    log "WARNING: codex 리뷰 출력 파일 없음 — clean으로 처리"
    echo '{"clean": true, "issues": [], "summary": "no output"}' > "$REVIEW_TMP"
  fi

  local review_content
  review_content=$(cat "$REVIEW_TMP")
  log "Review output: $review_content"

  # JSON에서 clean 여부 추출 — 파일에서 읽어 특수문자 안전하게 처리
  local clean
  clean=$(python3 - <<'PYEOF' "$REVIEW_TMP" 2>/dev/null || echo 'false'
import sys, json, re
text = open(sys.argv[1]).read()
m = re.search(r'\{.*?"clean".*?\}', text, re.DOTALL)
if m:
    try:
        d = json.loads(m.group())
        print('true' if d.get('clean') else 'false')
        sys.exit(0)
    except: pass
print('false')
PYEOF
)

  if [ "$clean" = "true" ]; then
    log "✅ Review PASSED: no issues"
    return 0
  else
    log "❌ Review FAILED: issues found"
    return 1
  fi
}

# 리뷰 결과에서 이슈 목록 추출
extract_issues() {
  python3 - <<'PYEOF' "$REVIEW_TMP" 2>/dev/null || cat "$REVIEW_TMP"
import sys, json, re
text = open(sys.argv[1]).read()
m = re.search(r'\{.*?"clean".*?\}', text, re.DOTALL)
if m:
    try:
        d = json.loads(m.group())
        for i, issue in enumerate(d.get('issues', []), 1):
            print(f'{i}. {issue}')
        sys.exit(0)
    except: pass
print(text)
PYEOF
}

# ── Phase 4: 스펙 정합성 검증 (Claude Code) ───────────────────────────────────
# 반환값: 0 = aligned, 1 = 이슈 있음
# 이슈 목록은 $SPEC_TMP 에 저장 (로그 오염 없이 호출부에서 읽음)
phase_spec_check() {
  hr >&2
  log "Phase 4: Spec alignment check with Claude Code" >&2
  hr >&2

  # claude 응답을 파일에 저장 — 변수 인터폴레이션 시 작은따옴표/특수문자 깨짐 방지
  claude --print "
코드가 수정되었어. 스팩과 ALIGN 이 맞는지 확인해줘.

분석 후 반드시 아래 JSON 형식으로만 응답해 (마크다운 없이):
{
  \"aligned\": <true if fully aligned, false otherwise>,
  \"issues\": [\"<issue 1>\", \"<issue 2>\"],
  \"summary\": \"<one-line verdict>\"
}
" 2>&1 | tee -a "$LOG_FILE" > "$SPEC_TMP"

  # 파일에서 JSON 파싱 — 특수문자 안전
  local aligned
  aligned=$(python3 - <<'PYEOF'
import sys, json, re
text = open(sys.argv[1]).read()
m = re.search(r'\{.*?"aligned".*?\}', text, re.DOTALL)
if m:
    try:
        d = json.loads(m.group())
        print('true' if d.get('aligned') else 'false')
        sys.exit(0)
    except: pass
print('false')
PYEOF
"$SPEC_TMP" 2>/dev/null || echo 'false')

  if [ "$aligned" = "true" ]; then
    log "✅ Spec alignment PASSED" >&2
    return 0
  fi

  log "❌ Spec alignment FAILED" >&2
  # 이슈 목록을 stdout으로 출력 (호출부에서 캡처)
  python3 - <<'PYEOF' "$SPEC_TMP" 2>/dev/null || cat "$SPEC_TMP"
import sys, json, re
text = open(sys.argv[1]).read()
m = re.search(r'\{.*?"aligned".*?\}', text, re.DOTALL)
if m:
    try:
        d = json.loads(m.group())
        for i, issue in enumerate(d.get('issues', []), 1):
            print(f'{i}. {issue}')
        sys.exit(0)
    except: pass
print(text)
PYEOF
  return 1
}

# ── implement-review 루프 ─────────────────────────────────────────────────────
run_implement_review_loop() {
  local initial_prompt="$1"
  local current_prompt="$initial_prompt"

  for iter in $(seq 1 "$MAX_REVIEW_ITER"); do
    log "=== Implement-Review iteration $iter/$MAX_REVIEW_ITER ==="

    phase_implement "$current_prompt"

    if phase_review; then
      return 0
    fi

    if [ "$iter" -eq "$MAX_REVIEW_ITER" ]; then
      log "WARNING: max review iterations ($MAX_REVIEW_ITER) reached"
      return 1
    fi

    local issues
    issues=$(extract_issues)
    log "Issues to fix:\n$issues"

    current_prompt="Fix the following code review issues. Do not introduce new problems.

Issues:
$issues

Original task context: $initial_prompt"
  done
}

# ── 메인 ─────────────────────────────────────────────────────────────────────
main() {
  log "=== Orchestration started ==="
  log "Feature: ${FEATURE:-<using existing tasks.md>}"
  log "FROM_PHASE=$FROM_PHASE  MAX_REVIEW_ITER=$MAX_REVIEW_ITER  MAX_SPEC_ITER=$MAX_SPEC_ITER"

  # ── Phase 1: 계획 ──────────────────────────────────────────────────────────
  if [ "$FROM_PHASE" -le 1 ]; then
    [ -z "$FEATURE" ] && die "feature 설명을 인자로 전달하세요. 예: $0 'recall quality feedback loop'"
    phase_constitution
    phase_specify_clarify
    phase_plan_tasks_analyze
    log "✅ Phase 1 완료"
  else
    log "Phase 1 건너뜀 (--from-phase $FROM_PHASE)"
  fi

  # tasks.md 존재 확인 (Phase 2 이상 진입 전)
  TASKS_FILE=$(find specs/ -name "tasks.md" 2>/dev/null | head -1 || true)
  [ -z "$TASKS_FILE" ] && die "tasks.md를 찾을 수 없습니다. --from-phase 1 로 전체 실행하세요."
  log "Using tasks: $TASKS_FILE"

  local initial_implement_prompt
  initial_implement_prompt="Implement all tasks defined in $TASKS_FILE.
Follow the plan in $(dirname "$TASKS_FILE")/plan.md.
Mark each task as [X] when done."

  # ── Phase 2-3: 첫 진입 처리 ────────────────────────────────────────────────
  # FROM_PHASE=4 : 구현·리뷰 건너뜀, spec check 루프로 바로 낙하
  # FROM_PHASE=3 : 구현 없이 리뷰부터 시작, 이슈 있으면 implement-review 루프
  # FROM_PHASE=2 : implement-review 루프 전체 실행
  # FROM_PHASE=1 : 위와 동일 (Phase 1 완료 후)

  if [ "$FROM_PHASE" -le 2 ]; then
    run_implement_review_loop "$initial_implement_prompt" || true

  elif [ "$FROM_PHASE" -eq 3 ]; then
    log "Phase 2 건너뜀 — Phase 3(리뷰)부터 시작"
    if phase_review; then
      log "✅ 초기 리뷰 통과 — Phase 4로 이동"
    else
      local issues
      issues=$(extract_issues)
      log "리뷰 이슈 발견:\n$issues"
      run_implement_review_loop "Fix the following code review issues:
$issues

Context: $initial_implement_prompt"
    fi

  else
    log "Phase 2-3 건너뜀 (--from-phase 4) — 스펙 정합성 검증부터 시작"
  fi

  for spec_iter in $(seq 1 "$MAX_SPEC_ITER"); do
    log "=== Spec iteration $spec_iter/$MAX_SPEC_ITER ==="

    local spec_issues
    if spec_issues=$(phase_spec_check); then
      hr
      log "🎉 ALL DONE — code implemented, reviewed, and spec-aligned"
      log "Log: $LOG_FILE"
      hr
      rm -f "$REVIEW_TMP"
      exit 0
    fi

    log "Spec issues to fix:\n$spec_issues"

    run_implement_review_loop "Fix these spec alignment issues and ensure all tasks in $TASKS_FILE are correctly implemented.

Spec issues:
$spec_issues" || true
  done

  die "max spec iterations ($MAX_SPEC_ITER) reached without full alignment. Check $LOG_FILE"
}

trap 'rm -f "$REVIEW_TMP" "$SPEC_TMP"' EXIT
main "$@"
