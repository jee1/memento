#!/usr/bin/env bash
# PR 전에 로컬에서 돌리는 CI 정적 검사 묶음 (npm run ci:local).
#
# 명령 목록은 워크플로에서 읽는다(손으로 베끼지 않는다).
#   - .github/workflows/ci.yml 의 lint-typecheck job: `npm ci` 를 뺀 모든 run 단계
#   - .github/workflows/security-check.yml: `npx tsx scripts/check-*.ts` 정적 검사 단계
#     (npm audit 은 네트워크가 필요하고 type-check, lint 는 위 job 과 겹쳐 뺀다)
# 한 줄짜리 run 은 그대로 돌린다. 여러 줄 run 은 check-version-sync 만 로컬용으로 바꿔 돌리고,
# 모르는 여러 줄 단계가 생기면 실패해 이 스크립트를 고치게 한다(워크플로와 어긋남 감지).
# 끝에 scripts/check-removed-names.ts (지운 이름의 남은 언급)를 부른다.
# 테스트는 포함하지 않는다. 바꾼 범위의 테스트를 따로 돌린다.
#
# usage: scripts/ci-local.sh [--list]   (--list: 돌릴 명령만 출력)
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
CI_YML=${CI_LOCAL_CI_YML:-.github/workflows/ci.yml}
SEC_YML=${CI_LOCAL_SECURITY_YML:-.github/workflows/security-check.yml}
BASE=${CI_LOCAL_BASE:-$(git merge-base origin/main HEAD)}

# job 블록(2칸 들여쓰기 키)에서 run 단계를 한 줄에 하나씩 뽑는다. 여러 줄 run 은 MULTI<TAB>본문(줄은 공백으로 이음).
extract_runs() { # <file> <job-key-or-*>
  awk -v job="$2" '
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { injob = (job == "*" || $1 == job ":") ; multi = 0 }
    !injob { next }
    multi {
      match($0, /^ */); ind = RLENGTH
      if ($0 ~ /^[[:space:]]*$/) next
      if (ind > mind) { sub(/^ +/, ""); body = body " " $0; next }
      print "MULTI\t" body; multi = 0
    }
    match($0, /^ +(- )?run:[[:space:]]*/) {
      rest = substr($0, RLENGTH + 1)
      if (rest ~ /^[|>][+-]?$/) { multi = 1; body = ""; match($0, /^ */); mind = RLENGTH; next }
      print "ONE\t" rest
    }
    END { if (multi) print "MULTI\t" body }
  ' "$1"
}

declare -a CMDS=()
add_cmd() { CMDS+=("$1"); }

while IFS=$'\t' read -r kind body; do
  case "$kind" in
    ONE)
      [ "$body" = "npm ci" ] && continue
      add_cmd "$body" ;;
    MULTI)
      case "$body" in
        *check-version-sync.ts*) add_cmd "npx tsx scripts/check-version-sync.ts --ci --base $BASE --head HEAD" ;;
        *) echo "ci-local: ci.yml lint-typecheck 에 처리하지 못하는 여러 줄 단계가 있다. scripts/ci-local.sh 를 고쳐라: $body" >&2; exit 2 ;;
      esac ;;
  esac
done < <(extract_runs "$CI_YML" lint-typecheck)

while IFS=$'\t' read -r kind body; do
  [ "$kind" = ONE ] && case "$body" in "npx tsx scripts/check-"*) add_cmd "$body" ;; esac
done < <(extract_runs "$SEC_YML" '*')

add_cmd "npx tsx scripts/check-removed-names.ts --base=$BASE"

if [ "${#CMDS[@]}" -lt 12 ]; then
  echo "ci-local: 워크플로에서 명령 ${#CMDS[@]}개만 읽었다. ci.yml 구조가 바뀌었는지 확인해라." >&2
  exit 2
fi

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${CMDS[@]}"
  exit 0
fi

FAILED=()
for cmd in "${CMDS[@]}"; do
  echo "::: $cmd"
  if bash -c "$cmd"; then :; else
    echo "::: 실패: $cmd" >&2
    FAILED+=("$cmd")
  fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo >&2
  echo "ci-local: ${#FAILED[@]}개 실패" >&2
  printf '  - %s\n' "${FAILED[@]}" >&2
  exit 1
fi
echo "ci-local: ${#CMDS[@]}개 모두 통과"
