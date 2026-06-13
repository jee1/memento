# Research: Agent Operations CLI

## Existing Surfaces

- CLI 진입점은 `packages/memento-server/src/cli.ts`이며 기능별 dynamic import를 사용한다.
- server discovery는 `server-info.ts`의 port/PID/health 경계를 재사용할 수 있다.
- `/health`는 인증 없이 server version과 DB 연결 상태를 반환한다.
- `/api/v1/agent/capabilities`는 programmatic auth 아래 contract, event, limit,
  schema readiness를 반환한다.
- lifecycle API는 start/ingest/stop/export/delete와 initial injection을 이미 제공한다.
- client package에는 agent capability/lifecycle/export/delete transport가 있다.

## Decisions

### 하나의 운영 CLI 모듈

`agent-ops.ts`가 option parsing, HTTP shell, doctor/status/demo orchestration, safe rendering을
소유한다. 세 command가 endpoint/auth/guidance/compatibility를 공유하므로 파일을
분리해 중복 transport를 만들지 않는다.

### Payload-free status endpoint

CLI가 DB 또는 export를 직접 순회하지 않는다. `/api/v1/agent/operations/status`를
추가하고 server가 aggregate와 제한된 event metadata만 반환한다. observation
`payload_json`, `redaction_metadata_json`, telemetry `extra_data` 원문은 응답하지 않는다.

### Doctor redaction probe

실제 secret 대신 고정 synthetic marker를 `password` 필드에 넣는다. lifecycle pipeline을
통과한 export에서 marker 부재, `[REDACTED:` placeholder, observation status
`REDACTED`를 검사한다. 결과에는 boolean과 reason code만 남기며 marker와 payload는
절대 render하지 않는다. 생성한 session은 `finally`에서 삭제한다.

### Demo semantics

첫 session은 명시적인 coding decision과 successful tool result를 수집한 뒤 STOP한다.
기존 summary service가 episodic memory와 provenance를 만든다. 같은 owner/project/process
scope의 두 번째 SESSION_START가 첫 summary memory를 initial injection item으로 선택하면
end-to-end 성공이다. 고유 scope로 기존 사용자 memory의 간섭을 줄이고 두 session을 정리한다.

### Authentication and endpoint precedence

1. `--endpoint`
2. `MEMENTO_ENDPOINT`
3. server-info의 loopback port

API key:

1. `--api-key`
2. `ADMIN_API_KEY`
3. `MEMENTO_API_KEY`

모든 출력은 endpoint origin만 포함하고 header/config 값을 포함하지 않는다.

### Compatibility matrix

server contract version 1을 기준으로 다음 adapter를 표시한다.

| Adapter | Baseline | Required contract | Lifecycle |
| --- | --- | --- | --- |
| Claude Code | adapter implementation 0.1.x | 1 | start, prompt, tool, pre-compact, stop |
| Codex | adapter implementation 0.1.x | 1 | start, prompt, tool, pre-compact, stop |

CLI는 server capability의 contract/event set과 비교해 `compatible`, `degraded`,
`incompatible`을 계산한다. upstream binary의 상세 capability는 기존 `connect` 진단 범위다.

### Reason guidance

안정된 capture reason을 category와 조치 문장에 매핑한다. unknown reason은 payload를
붙이지 않고 generic server/CLI version 확인 지침을 반환한다.

## Rejected Alternatives

- client package만으로 구현: CLI가 server-info와 rendering을 소유하므로 불필요한 결합이다.
- export를 status에 재사용: payload를 운영 진단 경로로 가져와 노출 위험과 비용이 커진다.
- 실제 환경변수 secret redaction: 진단 자체가 secret을 전송하므로 기각한다.
- 신규 DB table/telemetry: 기존 observation/session/telemetry가 필요한 신호를 보유한다.
- external CLI framework: 신규 dependency 금지와 기존 parser 패턴에 맞지 않는다.
