# Obsidian CLI 설정

공식 문서: [Obsidian CLI](https://obsidian.md/help/cli)

터미널에서 볼트를 열고, 검색·데일리 노트·태스크 등을 자동화할 수 있다. **Obsidian 데스크톱 앱이 실행 중**이어야 CLI가 동작한다.

## 1. Obsidian 최신 설치

최신 설치 프로그램을 받는다: [Download Obsidian](https://obsidian.md/download)

CLI는 **Obsidian 1.12 installer 버전(1.12.7+ 권장)** 이 필요하다. (Obsidian 앱 버전만 올리고 installer가 구버전이면 CLI가 막힐 수 있다.)

## 2. 앱에서 CLI 활성화

1. Obsidian 실행
2. **설정(Settings) → General**
3. **Command line interface** 를 켠다

## 3. CLI 등록(PATH)

Obsidian이 안내하는 **Register the CLI** 절차를 따른다.

- **Linux**: 등록 시 보통 `/usr/local/bin/obsidian` 심볼릭 링크를 만들며(sudo 필요), 실패하면 `~/.local/bin/obsidian` 로 fallback 된다.
  - `~/.local/bin` 이 `PATH` 에 포함되어 있는지 확인한다.

## 4. 동작 확인

터미널을 **다시 연 뒤**:

```bash
type -a obsidian   # ~/.local/bin/obsidian 이 먼저 오는지 확인 (등록 후)
obsidian version
obsidian help
```

또는 저장소 스크립트:

```bash
./scripts/verify-obsidian-cli.sh
```

Linux에서 `/usr/bin/obsidian` 과 `~/.local/bin/obsidian` 이 **둘 다** 있을 수 있다. 공식 등록으로 설치된 CLI는 보통 `~/.local/bin` 쪽이므로, `PATH` 에서 **`~/.local/bin` 이 `/usr/bin` 보다 앞**에 오게 한다 (이 저장소 사용자 환경의 `~/.local/bin/env` 로 이미 앞에 두는 경우가 많다).

## 자주 나오는 메시지

| 메시지 | 조치 |
|--------|------|
| `Command line interface is not enabled` | 앱 설정에서 CLI 켜기 (위 2번) |
| `installer is out of date` | 최신 인스톨러로 재설치 ([Download](https://obsidian.md/download)) |
| `command not found` | CLI 등록 다시 수행, `~/.local/bin` 이 `PATH` 인지 확인 |
| `FATAL:sandbox_host_linux.cc(41) ... Operation not permitted` | Linux에서 Electron 샌드박스 권한/환경 문제. `/opt/Obsidian` 설치라면 `sudo chown root:root /opt/Obsidian/chrome-sandbox && sudo chmod 4755 /opt/Obsidian/chrome-sandbox` 를 먼저 시도. 컨테이너/제한 환경이면 데스크톱 환경에서 실행 필요. |

## 예시 (공식 문서)

```bash
obsidian daily
obsidian search query="meeting notes"
obsidian daily:append content="- [ ] Buy groceries"
```

자세한 서브커맨드는 `obsidian help` 및 [Obsidian CLI](https://obsidian.md/help/cli) 를 참고한다.
