# Log Issue Monitor 설계

## 배경

Memento에는 이미 opt-in Docker 진단 스택이 있다.

- `memento-mcp-server`는 애플리케이션 로그를 stdout/stderr로 남기고, 진단 모드가 켜져 있으면 `/app/logs/diagnostics` 아래에 런타임 JSONL 파일을 기록한다.
- `docker-diagnostics`는 별도 컨테이너로 동작하며 `/var/run/docker.sock`을 통해 Docker 상태를 읽고 `${HOME}/.memento/logs/docker-diagnostics` 아래에 호스트 관점의 진단 파일을 남긴다.
- Docker socket 접근은 권한이 강하므로 기본 실행 경로가 아니라 명시적 진단 오버레이에서만 사용한다.

새 프로세스는 운영 중인 로그와 진단 파일을 주기적으로 확인하고, 오류 또는 이상 증상이 발견되면 근거 로그를 로컬에 보존한 뒤 심각도나 반복 기준에 따라 GitHub Issues를 생성하거나 기존 이슈를 갱신한다.

## 목표

1. 애플리케이션 컨테이너와 분리된 Docker 프로세스로 실행한다.
2. 앱 로그와 기존 diagnostics 파일을 주기적으로 검사한다.
3. 오류와 이상 증상을 안정적인 fingerprint로 정규화한다.
4. GitHub API 사용 가능 여부와 관계없이 모든 발생 내역을 로컬에 영구 기록한다.
5. 심각한 새 fingerprint는 GitHub Issue로 등록한다.
6. 이미 등록된 fingerprint는 새 이슈를 만들지 않고 발생 횟수와 최근 로그를 갱신한다.
7. `warn` 또는 리소스 이상은 반복 기준을 넘을 때만 GitHub Issue로 승격한다.
8. GitHub로 전송되는 로그 excerpt는 민감정보를 마스킹한다.

## 비목표

- 기본 `docker-compose.yml`에 monitor를 상시 포함하지 않는다.
- 이번 범위에서 웹 대시보드를 만들지 않는다.
- Slack, email, GitHub Projects, assignee, milestone 자동화는 제외한다.
- 로그 분류에 LLM을 사용하지 않는다.
- 닫힌 GitHub Issue를 자동 reopen하지 않는다.
- 기존 앱 로깅이나 diagnostics 수집 책임을 monitor로 옮기지 않는다.

## 권장 접근

별도 `log-issue-monitor` Docker 서비스를 추가하고, 로컬 영구 상태 저장 위에 조건부 GitHub 동기화를 얹는다.

Monitor는 감지한 모든 발생을 `${HOME}/.memento/logs/log-issue-monitor/`에 기록한다. GitHub 동기화는 로컬 상태 위에서 수행되는 best-effort 단계다. `GITHUB_TOKEN`이 없거나 GitHub API가 실패해도 monitor는 계속 수집하고 해당 fingerprint를 `local_only` 또는 `sync_failed`로 표시한다.

이 방식은 운영 증거를 잃지 않고, GitHub 이슈 노이즈를 줄이며, 기존 Docker diagnostics 오버레이 패턴과 잘 맞는다.

## 실행 구조

예상 opt-in 실행 명령은 다음과 같다.

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

서비스 구성:

- `memento-mcp-server`: 기존 애플리케이션 컨테이너
- `docker-diagnostics`: 기존 Docker 메트릭/상태 수집기
- `log-issue-monitor`: 새 주기 스캐너와 GitHub Issue 동기화기

새 compose 오버레이는 다음을 마운트한다.

- `/var/run/docker.sock:/var/run/docker.sock`
- `${HOME}/.memento/logs:/logs`

Monitor는 `/logs`를 읽고 자체 상태는 `/logs/log-issue-monitor` 아래에 쓴다.

## 구성 요소

### 로그 소스

Monitor는 세 가지 소스 그룹을 읽는다.

1. `docker logs --since <cursor> memento-mcp-server`로 읽는 애플리케이션 컨테이너 로그
2. 애플리케이션 diagnostics 파일
   - `/logs/diagnostics/app-events.jsonl`
   - `/logs/diagnostics/app-runtime.jsonl`
3. Docker diagnostics 파일
   - `/logs/docker-diagnostics/docker-stats.jsonl`
   - `/logs/docker-diagnostics/docker-inspect.jsonl`
   - `/logs/docker-diagnostics/docker-log-size.jsonl`

각 소스는 cursor를 가진다. Docker logs는 timestamp cursor를 사용한다. 파일 소스는 byte offset과 inode 또는 파일 식별 정보를 함께 저장해 log rotation을 감지한다.

### 파서와 감지기

파서와 감지기는 작고 독립적으로 테스트 가능한 단위로 둔다.

- `parseAppLogLine`: Memento 표준 로그 형식인 `timestamp | LEVEL | message | JSON metadata`를 파싱하고, 실패하면 raw text fallback을 반환한다.
- `parseJsonlRecord`: diagnostics JSONL 레코드를 파싱하고, 성공한 typed record 또는 복구 가능한 parse error를 반환한다.
- `detectAppLogEvent`: `error`, `critical`, `warn`, stack trace, uncaught exception, unhandled rejection, process crash 패턴을 감지한다.
- `detectRuntimeAnomaly`: 메모리 증가, scheduler error count 증가, uptime reset, diagnostics 기록 실패 반복을 감지한다.
- `detectDockerAnomaly`: restart count 증가, `OOMKilled`, unhealthy 상태, 높은 CPU/메모리 사용량, 빠른 로그 크기 증가를 감지한다.

파싱 실패는 `monitor-errors.jsonl`에 남기고 루프를 중단하지 않는다.

### 정규화와 Fingerprint

감지된 이벤트는 다음 형태의 정규화된 occurrence가 된다.

```typescript
interface LogIssueOccurrence {
  fingerprint: string;
  source: 'app-log' | 'app-diagnostics' | 'docker-diagnostics';
  severity: 'critical' | 'error' | 'warn' | 'anomaly';
  title: string;
  normalizedMessage: string;
  excerpt: string;
  observedAt: string;
  context: Record<string, unknown>;
}
```

Fingerprint는 다음 값을 조합해 만든다.

- source
- severity
- normalized message
- stack trace가 있으면 top frame
- component, tool, job name, container state 등 안정적인 context

정규화 과정에서는 다음처럼 매번 달라지는 값을 제거한다.

- timestamp
- UUID
- request ID
- memory ID
- 우발적인 port 값
- duration
- byte count
- counter

Fingerprint는 정규화 key의 SHA-256 해시 앞 12~16 hex 문자처럼 짧고 안정적인 값으로 저장한다.

## 로컬 상태

MVP는 atomic write를 보장하는 `state.json`을 사용한다. 동시 쓰기나 큰 히스토리가 문제가 되면 후속 작업에서 SQLite로 옮긴다. 초기 상태 모델은 다음과 같다.

```typescript
interface LogIssueState {
  version: 1;
  cursors: Record<string, unknown>;
  fingerprints: Record<string, LogIssueFingerprintState>;
}

interface LogIssueFingerprintState {
  fingerprint: string;
  source: string;
  severity: string;
  normalizedTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  recentOccurrences: Array<{
    observedAt: string;
    excerpt: string;
    context: Record<string, unknown>;
  }>;
  githubIssueNumber?: number;
  status: 'local_only' | 'opened' | 'closed_remote' | 'sync_failed' | 'suppressed';
  lastSyncError?: string;
}
```

`recentOccurrences`는 fingerprint당 최근 10개 정도로 제한한다. 전체 발생 이력은 감사와 재처리를 위해 `occurrences.jsonl`에 append-only로 남긴다.

## Issue 생성 기준

즉시 GitHub Issue를 생성하는 경우:

- `critical`
- `error`
- uncaught exception
- unhandled rejection
- process crash
- Docker `OOMKilled`
- 지속되는 unhealthy container 상태

반복 기준을 넘을 때 GitHub Issue를 생성하는 경우:

- `warn`
- CPU anomaly
- memory anomaly
- log-size growth anomaly
- scheduler error count growth

기본 반복 기준:

- 10분 안에 3회 이상 발생

반복 기준과 window는 환경 변수로 조정할 수 있다.

## GitHub 동기화

GitHub 동기화는 fingerprint 단위로 수행한다.

1. 로컬 상태에 `githubIssueNumber`가 있으면 해당 이슈를 조회한다.
2. 이슈가 열려 있으면 본문의 machine-managed block을 현재 count와 최근 excerpt로 갱신한다.
3. 이슈가 닫혀 있으면 reopen하지 않고 로컬 상태를 `closed_remote`로 표시한다.
4. 로컬 상태에 이슈 번호가 없으면 label과 fingerprint marker로 열린 이슈를 검색한다.
5. 열린 이슈를 찾으면 로컬 상태에 연결하고 본문 block을 갱신한다.
6. 열린 이슈가 없고 생성 기준을 만족하면 새 이슈를 만든다.

각 이슈 본문에는 다음 marker를 포함한다.

```md
<!-- memento-log-monitor:fingerprint=<hash> -->
```

본문의 managed block에는 다음을 포함한다.

- 발생 횟수
- 최초 발견 시각
- 마지막 발견 시각
- severity
- source
- normalized message
- 최근 마스킹된 로그 excerpt
- 전체 원본 로그는 로컬에만 있다는 안내

Monitor는 자기 marker가 있는 section만 교체한다. 사람이 작성한 설명이나 코멘트는 보존한다.

댓글은 긴 침묵 후 급격한 재발 같은 중요한 상태 변화에만 남긴다. 일반적인 count 증가는 이슈 본문 갱신으로 처리한다.

## 설정

권장 환경 변수:

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 빈 값 | 설정된 경우 GitHub 쓰기 활성화 |
| `GITHUB_REPOSITORY` | `jee1lee/memento` | 대상 저장소 |
| `LOG_ISSUE_MONITOR_INTERVAL_SECONDS` | `30` | 스캔 주기 |
| `LOG_ISSUE_MONITOR_WARN_THRESHOLD` | `3` | warning/anomaly 이슈 승격 발생 횟수 |
| `LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS` | `600` | warning/anomaly 반복 window |
| `LOG_ISSUE_MONITOR_DRY_RUN` | `false` | GitHub 쓰기 없이 로컬 기록만 수행 |
| `LOG_ISSUE_MONITOR_LABELS` | `bug,needs-triage,memento-log-monitor` | 생성 이슈 label |
| `LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES` | `6000` | GitHub로 전송할 excerpt 최대 크기 |
| `LOG_ISSUE_MONITOR_INCLUDE_STACK` | `true` | stack excerpt 포함 여부 |

`GITHUB_TOKEN`이 없으면 monitor는 local-only 모드로 동작한다. 이는 오류가 아니라 정상 운영 모드다.

## 보안

- Docker socket 접근은 issue monitor opt-in 오버레이에서만 허용한다.
- GitHub token 값은 로그나 이슈 본문에 절대 포함하지 않는다.
- GitHub로 전송되는 excerpt는 email, phone, bearer token, API key, password, secret, credential 패턴을 마스킹한다.
- Excerpt는 업로드 전에 길이를 제한한다.
- 전체 원본 로그는 로컬에만 보존한다.
- Monitor 자체 오류는 `monitor-errors.jsonl`에 기록하고 GitHub Issue를 만들지 않는다. 이렇게 해서 monitor 오류가 다시 issue 생성 루프를 만드는 일을 막는다.

## 실패 처리

- Docker API 실패: monitor error로 기록하고 이전 cursor를 유지한 뒤 다음 주기에 재시도한다.
- 잘못된 JSONL: line 위치를 기록하고 다음 레코드로 진행한다.
- 상태 저장 실패: stderr에 남기고 cursor를 전진하지 않은 채 다음 주기에 재시도한다.
- GitHub rate limit: `sync_failed`로 표시하고 로컬 상태를 유지하며 backoff 후 재시도한다.
- GitHub 인증 실패: 설정이 바뀔 때까지 local-only 방식으로 동작한다.
- 원격 이슈가 닫힌 경우: `closed_remote`로 표시하고 로컬 count는 계속 증가시킨다.

## 테스트 계획

단위 테스트:

- 구조화된 앱 로그 파싱
- raw fallback 파싱
- diagnostics JSONL 파싱
- anomaly 감지 규칙
- fingerprint 정규화
- threshold 승격
- GitHub 본문 생성 전 PII 마스킹
- 사람이 작성한 내용을 보존하는 managed issue body 갱신

상태 저장 테스트:

- cursor 유지
- occurrence count 증가
- recent occurrence cap
- local-only 모드
- sync failure 상태

GitHub client 테스트:

- label과 fingerprint marker 기반 검색
- issue 생성
- issue 본문 갱신
- 닫힌 issue 처리
- rate limit과 인증 실패 처리

Compose 검증:

- `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.issue-monitor.yml config`

E2E smoke test:

- monitor를 dry-run 모드로 실행한다.
- 샘플 앱 로그와 diagnostics 레코드를 주입한다.
- 로컬 `state.json`과 `occurrences.jsonl`이 갱신되는지 확인한다.
- GitHub 쓰기가 발생하지 않는지 확인한다.

## Rollout

1. Dry-run 가능한 monitor를 구현한다.
2. Compose 오버레이와 운영 문서를 추가한다.
3. 샘플 로그로 로컬 dry-run을 검증한다.
4. `GITHUB_TOKEN` 없이 diagnostics stack에 붙여 local-only 수집을 확인한다.
5. 제한된 환경에서 `GITHUB_TOKEN`을 주입해 GitHub 동기화를 켠다.
6. 실제 노이즈를 보고 threshold를 조정한다.

## 구현 범위

초기 구현에 포함한다.

- monitor entrypoint
- parser와 detector
- fingerprint 생성
- 로컬 상태 저장
- GitHub search/create/update client
- Dockerfile
- compose overlay
- 집중 테스트
- 운영 문서

후속 후보로 남긴다.

- SQLite 상태 저장소
- dashboard view
- Slack 또는 email 알림
- issue reopen 정책
- fingerprint별 suppression 설정
- 긴 기간의 diagnostics window를 활용한 더 정교한 anomaly 규칙
