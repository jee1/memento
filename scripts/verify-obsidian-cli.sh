#!/usr/bin/env bash
# Obsidian CLI 동작 여부 확인 (https://obsidian.md/help/cli)
set -euo pipefail

OBSIDIAN="${OBSIDIAN_CMD:-obsidian}"

if ! command -v "$OBSIDIAN" >/dev/null 2>&1; then
  echo "obsidian CLI를 찾을 수 없습니다. PATH에 등록했는지 확인하세요."
  echo "  Linux: ~/.local/bin 이 PATH에 있는지, Obsidian 앱에서 Register the CLI를 완료했는지 확인합니다."
  exit 1
fi

OBSIDIAN_PATH="$(command -v "$OBSIDIAN")"
echo "Using: $OBSIDIAN_PATH"
echo "---"

# Best-effort diagnostics for common Linux installer setups.
if [[ "$OBSIDIAN_PATH" == "$HOME/.local/bin/obsidian" ]]; then
  TARGET="$(readlink -f "$OBSIDIAN_PATH" 2>/dev/null || true)"
  if [[ -n "${TARGET:-}" ]]; then
    echo "Resolved: $TARGET"
    if [[ "$TARGET" == */Obsidian/obsidian ]]; then
      INSTALL_DIR="${TARGET%/obsidian}"
      if [[ -f "$INSTALL_DIR/chrome-sandbox" ]]; then
        echo "chrome-sandbox: $(ls -la "$INSTALL_DIR/chrome-sandbox" | tr -s ' ')"
      fi
    fi
  fi
  echo "---"
fi

set +e
OUT=$("$OBSIDIAN" help 2>&1)
STATUS=$?
set -e

printf '%s\n' "$OUT"
echo "---"

if [[ $STATUS -ne 0 ]]; then
  if printf '%s' "$OUT" | grep -q 'FATAL:sandbox_host_linux.cc'; then
    echo "FAIL: Obsidian(Electron) 샌드박스 초기화에 실패했습니다."
    echo
    echo "대부분 다음 중 하나입니다."
    echo "1) Linux 설치(특히 /opt/Obsidian)에서 chrome-sandbox 권한(setuid)이 깨짐"
    echo "2) 컨테이너/제한된 환경에서 unprivileged user namespace가 금지됨"
    echo
    echo "로컬 머신에서 /opt/Obsidian 설치를 사용 중이라면(현재 환경처럼) 아래를 시도하세요:"
    echo "  sudo chown root:root /opt/Obsidian/chrome-sandbox"
    echo "  sudo chmod 4755 /opt/Obsidian/chrome-sandbox"
    echo
    echo "그래도 안 되면: Obsidian을 일반 데스크톱 환경(권한/GUI 정상)에서 실행해 CLI를 사용해야 합니다."
    exit 1
  fi

  echo "FAIL: obsidian help 가 비정상 종료했습니다. (exit=$STATUS)"
  exit 1
fi

if printf '%s' "$OUT" | grep -q 'Command line interface is not enabled'; then
  echo "FAIL: Obsidian 앱에서 CLI를 켜야 합니다. Settings → General → Advanced → Command line interface"
  echo "     가이드: docs/guides/ko/obsidian-cli-setup.md"
  exit 1
fi

if printf '%s' "$OUT" | grep -q 'installer is out of date'; then
  echo "WARN: 최신 인스톨러 설치를 권장합니다: https://obsidian.md/download"
fi

echo "OK: obsidian CLI가 사용 가능한 상태로 보입니다."
