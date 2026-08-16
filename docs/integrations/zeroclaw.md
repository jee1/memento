# ZeroClaw × Memento

ZeroClaw는 Rust로 작성된 단일 바이너리 개인 AI 비서입니다. config는 TOML이고, MCP 서버는 `[[mcp.servers]]` 블록으로 등록합니다. 이 문서는 ZeroClaw에 Memento를 *베어 MCP* 방식으로 붙이는 5분 셋업 가이드입니다.

전반적인 트랜스포트·인증·시스템 프롬프트 개념은 공통 문서에서 다룹니다. 이 페이지는 ZeroClaw 고유의 config 위치·블록 형식·식별자 매핑만 정리합니다.

- 트랜스포트 결정과 셋업: [`./_shared/transports.md`](./_shared/transports.md)
- 토큰 발급·저장·로테이션: [`./_shared/auth.md`](./_shared/auth.md)
- 권장 시스템 프롬프트: [`./_shared/system-prompt.md`](./_shared/system-prompt.md)
- 트러블슈팅: [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)
- 통합 가이드 허브: [`./README.md`](./README.md)

---

## 사전 조건

1. **ZeroClaw 빌드** — 소스에서 빌드한다면 agent 런타임이 필요하므로 Cargo feature flag `agent-runtime`을 켜고 빌드하세요.

   ```bash
   cargo build --release --features agent-runtime
   ```

   사전 빌드된 바이너리(릴리스 zip 등)를 쓴다면 해당 빌드가 이미 `agent-runtime`을 포함하는지 ZeroClaw 문서에서 확인하세요. agent 런타임이 없는 빌드는 MCP 서버 호출을 수행하지 못합니다.

2. **Memento 설치** — stdio 트랙은 `npx memento-mcp-server@latest setup` 한 줄로 끝납니다. HTTP 트랙은 호스트에 Memento 서버가 떠 있어야 합니다 ([`./_shared/transports.md`](./_shared/transports.md) 참조).

3. **Node.js 런타임** (stdio 트랙 한정) — ZeroClaw가 자식 프로세스로 `npx`를 부를 수 있어야 합니다. ZeroClaw 호스트에 Node 18+ 가 설치돼 있는지 확인하세요.

4. **ZeroClaw 가동 확인** — 평소 쓰던 방식대로 ZeroClaw가 한 번이라도 정상 부팅하는 상태여야 합니다.

> ZeroClaw의 정확한 빌드·실행 절차는 본 문서 범위가 아닙니다. ZeroClaw 자체 문서를 우선 따르세요.

---

## stdio 트랙 셋업

비서 호스트(노트북·홈서버)에 Memento SQLite 파일이 함께 있으면 stdio가 가장 단순합니다. ZeroClaw가 `memento-mcp-server`를 자식 프로세스로 spawn해 stdin/stdout으로 MCP JSON-RPC를 주고받습니다.

ZeroClaw config 파일에 다음 블록을 추가하세요. config 파일은 ZeroClaw 빌드에 따라 `~/.config/zeroclaw/config.toml`(글로벌)이거나 워크스페이스 루트의 `config.toml`일 수 있습니다 — 정확한 위치는 ZeroClaw 문서 참조.

```toml
# ~/.config/zeroclaw/config.toml 또는 워크스페이스 config.toml
[[mcp.servers]]
name    = "memento"
command = "npx"
args    = ["-y", "memento-mcp-server@latest", "start", "--stdio"]
```

저장 후 ZeroClaw를 재시작하면 `memento` 서버가 등록됩니다. 첫 실행은 `npx`가 패키지를 다운로드하느라 몇 초 늦을 수 있습니다.

핵심 환경변수(`DB_PATH`, `OPENAI_API_KEY` 등)는 ZeroClaw가 자식 프로세스로 spawn할 때 상속됩니다. 일부 ZeroClaw 빌드는 `[[mcp.servers]]` 블록 안에서 `env` 키로 명시적 주입을 지원합니다 — 자세한 키 이름은 ZeroClaw 문서 참조.

---

## HTTP 트랙 셋업

24/7 봇이거나 ZeroClaw가 여러 디바이스에 흩어져 있다면 HTTP 트랙으로 중앙 Memento 한 대를 공유하세요. ZeroClaw는 base URL과 Bearer 토큰만 알면 됩니다.

```toml
[[mcp.servers]]
name      = "memento"
transport = "http"
url       = "http://your-home-server:9001/mcp"

[mcp.servers.headers]
authorization = "Bearer ${MEMENTO_TOKEN}"
```

토큰은 config에 평문으로 박지 말고 환경변수(`MEMENTO_TOKEN`) 또는 OS keychain에서 주입하세요. 발급·저장·로테이션 절차는 [`./_shared/auth.md`](./_shared/auth.md)에서 다룹니다. ZeroClaw가 어느 secret backend를 지원하는지(env, keychain, Vault 등)는 ZeroClaw 문서 참조.

집 밖에서 접속한다면 reverse proxy(nginx, Caddy, Cloudflare Tunnel)에서 TLS를 종단하고 `url`을 `https://memory.example.com/mcp` 형태로 바꾸세요.

---

## 식별자 매핑

ZeroClaw는 채널마다 들어오는 메시지를 `actor` 객체로 정규화하고, 채널은 `kind`(예: `telegram`, `discord`, `imessage`)로 구분합니다. Memento와의 매핑은 다음과 같이 두는 것을 권장합니다.

| ZeroClaw 측 | Memento 측 | 비고 |
|---|---|---|
| `actor.id` | `owner_id` | 같은 사람이 여러 채널에서 말해도 동일 owner로 묶입니다. ZeroClaw가 채널 간 actor를 통합하는 방식을 따르세요. |
| 채널 `kind` | `tags`의 `channel:<kind>` | `recall`에서 채널별 필터링이 필요할 때 사용합니다. |

베어 MCP에서는 위 매핑을 **시스템 프롬프트가 강제**합니다. ZeroClaw 어댑터는 메시지마다 `<현재_채널>`·`<현재_사용자>` 자리에 `actor` 정보를 동적으로 렌더링해야 합니다. 24/7 봇은 메시지마다 채널이 바뀌므로 정적 문자열로 두면 안 됩니다 ([`./_shared/system-prompt.md`](./_shared/system-prompt.md#채널사용자-태그-치환)).

---

## 시스템 프롬프트 적용

[`./_shared/system-prompt.md`](./_shared/system-prompt.md)의 "권장 시스템 프롬프트 블록"을 그대로 복사해 ZeroClaw의 system prompt 슬롯에 붙여넣으세요. ZeroClaw 빌드에 따라 system prompt는 config의 `[agent]` 섹션이거나 별도 prompt 파일일 수 있습니다 — 정확한 슬롯 위치는 ZeroClaw 문서 참조.

붙여넣은 뒤 다음 두 토큰을 ZeroClaw 어댑터의 메시지 렌더링 단계에서 동적으로 치환하도록 만드세요.

- `<현재_채널>` → ZeroClaw 채널 `kind` (예: `telegram`, `discord:guild123`)
- `<현재_사용자>` → ZeroClaw `actor.id` 또는 그에 대응하는 안정적 식별자

이 블록은 페르소나·말투 같은 ZeroClaw 자체의 system prompt와 결합되도록 설계돼 있으므로, 별도 섹션으로 보존하면서 위·아래에 다른 정책을 자유롭게 둘 수 있습니다.

---

## 검증

ZeroClaw를 재시작한 뒤 다음 두 가지를 차례로 확인하세요.

1. **MCP 도구가 노출됐는가** — ZeroClaw의 도구 목록 명령(빌드에 따라 `/list-tools`, `/tools`, 또는 디버그 패널 등 — ZeroClaw 문서 참조)으로 `memento.recall`·`memento.remember`가 보이는지 확인합니다.

2. **회상이 동작하는가** — 한 메시지에서 사용자 사실을 하나 알려준 뒤("내 형 이름은 진우야"), 새 세션을 열어 같은 주제를 물어 봅니다. ZeroClaw가 내부적으로 `memento.recall`을 호출해 그 사실을 답변에 녹여 내야 합니다.

HTTP 트랙은 추가로 토큰 검증을 한 번 돌려 두면 안전합니다.

```bash
curl -i -H "Authorization: Bearer $MEMENTO_TOKEN" \
  http://your-home-server:9001/api/v1/quality/snapshot
```

`200 OK`가 나오면 ZeroClaw가 같은 헤더로 보낼 때도 통과합니다. `401`이 나오면 [`./_shared/auth.md`](./_shared/auth.md)와 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md#401-unauthorized)를 참조하세요.

---

## 트러블슈팅

연결 실패, 401, 회상 결과가 비어 있음 등 흔한 이슈는 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)에 정리돼 있습니다. ZeroClaw 호스트의 로그 위치(systemd journal, PM2, Windows Event Viewer 등)는 ZeroClaw 문서를 따르고, 거기서 `memento-mcp-server` 자식 프로세스의 stderr를 함께 추적하세요.

---

## SDK 사용에 관해

ZeroClaw는 Rust 바이너리이므로 Node.js 기반 `@jee1/memento-assistant`를 직접 import 할 수 없습니다.
v0.1에서는 베어 MCP 등록(stdio 또는 HTTP) + 권장 시스템 프롬프트 패턴으로 자동 회상/저장의 약 80%를 얻을 수 있습니다 ([`./_shared/system-prompt.md`](./_shared/system-prompt.md)).

Rust 측 포팅(예: `memento-assistant-rs`)은 v0.2+ 로드맵 항목입니다. 트래킹 이슈가 열리면 여기에 링크합니다.

---

## 다음 단계

- [`./_shared/transports.md`](./_shared/transports.md) — stdio·HTTP 트랙 결정과 마이그레이션
- [`./_shared/auth.md`](./_shared/auth.md) — Bearer 토큰 발급·저장·로테이션
- [`./_shared/system-prompt.md`](./_shared/system-prompt.md) — recall/remember 호출을 유도하는 권장 프롬프트
- [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md) — 연결 실패, 401, 회상 결과 비어 있음 등
- [`./README.md`](./README.md) — 통합 가이드 허브로 돌아가기
