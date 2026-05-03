# Log Issue Monitor 운영 가이드

Log Issue Monitor는 Memento 운영 로그와 Docker diagnostics 파일을 주기적으로 검사해 오류 또는 이상 증상을 로컬에 기록하고, 심각하거나 반복되는 fingerprint를 GitHub Issue로 등록하거나 갱신하는 opt-in 프로세스입니다.

## 실행

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

## Local-only 모드

`GITHUB_TOKEN`을 설정하지 않으면 monitor는 GitHub에 쓰지 않고 `${HOME}/.memento/logs/log-issue-monitor` 아래에만 기록합니다. 이 모드는 정상 운영 모드입니다.

명시적으로 GitHub 동기화를 끄려면 다음 값을 설정합니다.

```bash
LOG_ISSUE_MONITOR_DRY_RUN=true docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

## GitHub 동기화

GitHub Issue 생성을 켜려면 Issues write 권한이 있는 token을 `GITHUB_TOKEN`으로 주입합니다.

```bash
GITHUB_TOKEN=... docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

동일 fingerprint가 이미 열린 이슈에 있으면 새 이슈를 만들지 않고 monitor가 관리하는 본문 블록만 갱신합니다. 본문에는 발생 횟수, 최초/최근 감지 시각, 최근 로그 excerpt가 포함됩니다.

## 주요 설정

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GITHUB_REPOSITORY` | `jee1lee/memento` | 이슈를 생성할 저장소 |
| `LOG_ISSUE_MONITOR_CONTAINER_NAME` | `memento-mcp-server` | `docker logs`를 읽을 컨테이너 이름 |
| `LOG_ISSUE_MONITOR_INTERVAL_SECONDS` | `30` | 주기 실행 간격 |
| `LOG_ISSUE_MONITOR_WARN_THRESHOLD` | `3` | warning/anomaly를 이슈로 승격할 반복 횟수 |
| `LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS` | `600` | 반복 횟수 판정 시간 창 |
| `LOG_ISSUE_MONITOR_LABELS` | `bug,needs-triage,memento-log-monitor` | 생성/검색에 사용할 GitHub label |
| `LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES` | `6000` | 저장/전송할 excerpt 최대 길이 |

`critical`과 `error`는 즉시 GitHub 동기화 대상입니다. `warn`과 `anomaly`는 시간 창 안에서 threshold를 넘을 때만 동기화됩니다.

## 출력 파일

- `state.json`: fingerprint별 count, last seen, GitHub issue number
- `occurrences.jsonl`: append-only 발생 이력
- `monitor-errors.jsonl`: monitor 자체 오류

출력 경로는 기본적으로 `${HOME}/.memento/logs/log-issue-monitor`입니다.

## 보안

이 오버레이는 Docker socket을 마운트하므로 신뢰할 수 있는 운영/진단 환경에서만 사용합니다. GitHub로 전송되는 로그 excerpt는 민감정보 마스킹과 길이 제한을 거칩니다.

