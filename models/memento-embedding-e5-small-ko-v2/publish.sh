#!/usr/bin/env bash
# 모델 패키지를 만들고 sha256 을 대조한 뒤 npm 에 게시한다 (#1729). 주인만 실행한다.
# 처음 게시는 npm OIDC 로 할 수 없어 주인의 npm 로그인(OTP 포함)이 필요하다.
#
# usage: ./publish.sh            # 가상환경 준비, 변환, 대조, dry-run 크기 확인, 확인 뒤 게시
#        ./publish.sh --dry-run  # 게시 직전에 멈춘다
# PYTHON=<python> 을 주면 가상환경을 만들지 않고 그 python 을 쓴다(requirements.txt 와 같은 버전이어야 한다).
set -euo pipefail
cd "$(dirname "$0")"

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

python="${PYTHON:-}"
if [ -z "$python" ]; then
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/pip install --quiet -r requirements.txt
  python=.venv/bin/python
fi

"$python" build.py

npm publish --dry-run

spec="$(node -p "const p = require('./package.json'); p.name + '@' + p.version")"
if [ "$dry_run" = 1 ]; then
  echo "dry-run: $spec 를 게시하지 않았다"
  exit 0
fi

read -r -p "$spec 를 위 파일로 게시할까요? [y/N] " answer
[ "$answer" = "y" ] || { echo "취소했다"; exit 1; }
npm publish --access public
npm view "$spec" dist.integrity
