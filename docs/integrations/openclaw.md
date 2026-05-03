# OpenClaw × Memento

OpenClaw는 Node.js로 작성된 멀티채널 개인 AI 비서 게이트웨이입니다(참고: <https://github.com/openclaw/openclaw>). 게이트웨이가 channel adapter(telegram, slack, web 등)와 skill 시스템을 동시에 들고 있고, MCP 서버는 게이트웨이 config 또는 개별 skill의 manifest에 등록됩니다. 이 문서는 OpenClaw 사용자가 Memento를 *베어 MCP* 방식으로 붙이는 5분 셋업 가이드입니다.

전반적인 트랜스포트·인증·시스템 프롬프트 개념은 공통 문서에서 다룹니다. 이 페이지는 OpenClaw 고유의 게이트웨이/skill 토폴로지·channel 매핑·시스템 프롬프트 슬롯 위치만 정리합니다.

- 트랜스포트 결정과 셋업: [`./_shared/transports.md`](./_shared/transports.md)
- 토큰 발급·저장·로테이션: [`./_shared/auth.md`](./_shared/auth.md)
- 권장 시스템 프롬프트: [`./_shared/system-prompt.md`](./_shared/system-prompt.md)
- 트러블슈팅: [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)
- 통합 가이드 허브: [`./README.md`](./README.md)

---

## 사전 조건

1. **OpenClaw 가동 확인** — 평소 쓰던 channel adapter(예: telegram, slack, discord, web) 중 하나라도 게이트웨이에서 메시지를 받아 응답하는 상태여야 합니다. MCP 등록은 그 위에 얹는 단계입니다.

2. **Node.js 런타임** — OpenClaw 자체가 Node.js이므로 호스트에는 이미 Node 18+ 가 깔려 있을 것입니다. stdio 트랙이라면 게이트웨이가 `npx`로 `memento-mcp-server`를 자식 프로세스로 띄울 수 있어야 하므로 같은 Node 환경에서 `npx`가 동작해야 합니다.

3. **Memento 설치** — stdio 트랙은 `npx memento-mcp-server@latest setup` 한 줄로 끝납니다. HTTP 트랙은 호스트(또는 홈서버)에 Memento 서버가 떠 있어야 합니다 ([`./_shared/transports.md`](./_shared/transports.md) 참조).

4. **채널 어댑터 식별자 확인** — 각 channel adapter가 게이트웨이에 어떤 이름(`telegram`, `slack`, `web` 등)으로 등록돼 있는지, 그리고 사용자별 안정적 식별자(telegram chat_id, slack user id 등)가 어디서 노출되는지 확인해 두세요. 이 두 값이 뒤에서 `owner_id`·`tag`로 들어갑니다.

> OpenClaw의 정확한 빌드·실행 절차와 channel adapter 활성화 방법은 본 문서 범위가 아닙니다. OpenClaw 자체 문서를 우선 따르세요.

---

## stdio 트랙 셋업

게이트웨이 호스트(노트북·홈서버)에 Memento SQLite 파일이 함께 있으면 stdio가 가장 단순합니다. OpenClaw 게이트웨이가 `memento-mcp-server`를 자식 프로세스로 spawn해 stdin/stdout으로 MCP JSON-RPC를 주고받습니다.

OpenClaw 게이트웨이 config에 다음 블록을 추가하세요. 정확한 파일 경로는 OpenClaw 빌드에 따라 게이트웨이 루트의 `config/mcp.json`, `openclaw.config.js`, 또는 워크스페이스 단위 설정 파일일 수 있습니다 — OpenClaw 문서 참조.

```json
{
  "mcp": {
    "memento": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest", "start", "--stdio"]
    }
  }
}
```

저장 후 OpenClaw 게이트웨이를 재시작하면 `memento` 서버가 등록됩니다. 첫 실행은 `npx`가 패키지를 다운로드하느라 몇 초 늦을 수 있습니다.

핵심 환경변수(`DB_PATH`, `OPENAI_API_KEY` 등)는 게이트웨이가 자식 프로세스로 spawn할 때 상속됩니다. 일부 OpenClaw 빌드는 MCP 블록 안에서 `env` 키로 명시적 주입을 지원합니다 — 자세한 키 이름은 OpenClaw 문서 참조.

---

## HTTP 트랙 셋업

여러 디바이스에 OpenClaw 인스턴스가 흩어져 있거나, 게이트웨이 호스트와 Memento를 별도 서버에 두고 싶다면 HTTP 트랙으로 중앙 Memento 한 대를 공유하세요. 게이트웨이는 base URL과 Bearer 토큰만 알면 됩니다.

```json
{
  "mcp": {
    "memento": {
      "transport": "http",
      "url": "https://memory.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MEMENTO_TOKEN}"
      }
    }
  }
}
```

토큰은 config에 평문으로 박지 말고 환경변수(`MEMENTO_TOKEN`)에서 주입하세요. OpenClaw 게이트웨이는 보통 `.env` / `.env.local`을 읽으므로 거기에 `MEMENTO_TOKEN=…`을 두고 위 `${MEMENTO_TOKEN}` 자리에서 치환되도록 두면 됩니다. 발급·저장·로테이션 절차는 [`./_shared/auth.md`](./_shared/auth.md)에서 다룹니다.

집 밖에서 접속한다면 reverse proxy(nginx, Caddy, Cloudflare Tunnel)에서 TLS를 종단하고 `url`을 `https://memory.example.com/mcp` 형태로 두세요. 자체 서명 인증서를 쓰는 개발 환경의 예외 처리는 [`./_shared/auth.md`](./_shared/auth.md#tls-검증)를 참조하세요.

---

## skill 맥락에서 등록

OpenClaw에서는 MCP 서버를 두 곳 중 하나에 등록할 수 있습니다.

1. **게이트웨이 레벨(권장)** — 위 두 스니펫처럼 게이트웨이 전역 config에 `memento` 블록을 두면, 게이트웨이가 라우팅하는 모든 skill·channel이 같은 Memento 인스턴스를 공유합니다. 같은 사람이 telegram에서 알려준 사실을 slack skill에서도 회상할 수 있어야 한다면 이쪽이 정답입니다.

2. **skill 레벨(특수 케이스)** — 특정 skill manifest의 MCP 섹션에만 `memento`를 노출하는 방식입니다. 그 skill 안에서만 기억을 남기고, 다른 skill은 Memento를 아예 보지 못하게 만들고 싶을 때 씁니다(예: 민감한 의료 노트 skill). skill manifest의 MCP 등록 키 이름은 OpenClaw 문서 참조.

특별한 격리 요구가 없다면 **게이트웨이 레벨**을 고르세요. 베어 MCP의 핵심 가치는 한 사람이 어디서 말하든 같은 기억을 공유하는 것이고, 그 가치를 살리는 가장 단순한 토폴로지가 게이트웨이 레벨 등록입니다.

---

## 식별자 매핑

OpenClaw는 채널마다 서로 다른 사용자 식별 모델을 씁니다(telegram의 `chat_id`, slack의 `user`, discord의 `user_id`, web의 세션 sub 등). Memento와의 매핑은 다음과 같이 두는 것을 권장합니다.

| OpenClaw 측 | Memento 측 | 비고 |
|---|---|---|
| 게이트웨이 user (채널 통합 후의 안정적 user id) | `owner_id` | 같은 사람이 telegram·slack에서 모두 말해도 동일 owner로 묶입니다. OpenClaw가 채널 간 user를 통합하는 방식을 따르세요. 통합이 없다면 채널별 raw id를 사용하되, 그 결정은 회상 범위에 영구적인 영향을 줍니다. |
| channel adapter 이름 | `tags`의 `channel:<adapter>` | 예: `channel:telegram`, `channel:slack`. `recall`에서 채널별 필터링이 필요할 때 사용합니다. |
| 채널 측 raw id (chat_id 등) | `tags`의 `user:<id>` | 멀티유저 채널에서 발화자를 구분하거나, 게이트웨이의 user 통합이 깨졌을 때 디버깅용으로 함께 부여합니다. |

베어 MCP에서는 위 매핑을 **시스템 프롬프트가 강제**합니다. OpenClaw 게이트웨이 또는 channel adapter는 메시지마다 `<현재_채널>`·`<현재_사용자>` 자리에 adapter 이름·user 정보를 동적으로 렌더링해야 합니다. 멀티채널 게이트웨이에서 정적 문자열로 두면 모든 기억이 같은 태그로 뭉쳐 나중에 필터링이 깨집니다 ([`./_shared/system-prompt.md`](./_shared/system-prompt.md#채널사용자-태그-치환)).

---

## 시스템 프롬프트 적용

[`./_shared/system-prompt.md`](./_shared/system-prompt.md)의 "권장 시스템 프롬프트 블록"을 그대로 복사해 OpenClaw의 system prompt 슬롯에 붙여넣으세요. OpenClaw 빌드에 따라 system prompt는 게이트웨이 전역 prompt 파일이거나 각 skill manifest 안의 `systemPrompt` 항목일 수 있습니다 — 정확한 슬롯 위치는 OpenClaw 문서 참조.

붙여넣은 뒤 다음 두 토큰을 OpenClaw의 메시지 렌더링 단계에서 동적으로 치환하도록 만드세요. 정확한 템플릿 변수 문법(예: `{{channel}}`·`{{user.id}}` vs `${channel}` vs Handlebars 등)은 OpenClaw 빌드마다 다릅니다 — OpenClaw 템플릿 변수 문법을 참고해 채워 넣으세요.

- `<현재_채널>` → 메시지를 받은 channel adapter 이름 (예: `telegram`, `slack`, `web`)
- `<현재_사용자>` → channel adapter가 노출하는 안정적 user 식별자 (예: `tg:1234567`, `slack:U012ABC`)

게이트웨이 레벨에 등록했다면 이 system prompt도 게이트웨이 전역에 두는 것이 자연스럽습니다. skill 레벨로만 Memento를 노출했다면 해당 skill의 manifest에 같이 두세요. 두 위치에 중복으로 두면 prompt가 두 번 들어가니 한 곳에만 두세요.

---

## 검증

OpenClaw 게이트웨이를 재시작한 뒤 다음 두 가지를 차례로 확인하세요.

1. **MCP 도구가 노출됐는가** — Memento를 활성화한 channel(또는 skill)에서 게이트웨이의 도구 목록 명령(빌드에 따라 `/tools`, 디버그 패널, 또는 게이트웨이 startup 로그 등 — OpenClaw 문서 참조)으로 `memento.recall`·`memento.remember`가 보이는지 확인합니다.

2. **회상이 동작하는가** — 활성화된 channel(예: telegram)에서 한 번 사용자 사실을 알려준 뒤("기억해 둬: 내 형 이름은 진우야"), 새 세션을 열고 같은 채널 또는 다른 채널에서 "방금 뭐라 했지?" 또는 "내 형 이름이 뭐였지?"를 물어 봅니다. OpenClaw가 내부적으로 `memento.recall`을 호출해 그 사실을 답변에 녹여 내야 합니다. 게이트웨이 레벨 등록이라면 telegram에서 알려준 사실을 slack에서 회상하는 것까지 통과해야 정상입니다.

HTTP 트랙은 추가로 토큰 검증을 한 번 돌려 두면 안전합니다.

```bash
# Memento가 살아 있는지
curl -i https://memory.example.com/health

# 토큰이 유효한지
curl -i -H "Authorization: Bearer $MEMENTO_TOKEN" \
  https://memory.example.com/api/v1/quality/snapshot
```

`/health`가 `200`, 토큰 검증이 `200`이면 OpenClaw 게이트웨이가 같은 헤더로 보낼 때도 통과합니다. `401`이 나오면 [`./_shared/auth.md`](./_shared/auth.md)와 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md#401-unauthorized)를 참조하세요.

---

## 트러블슈팅

연결 실패, 401, 회상 결과가 비어 있음 등 흔한 이슈는 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)에 정리돼 있습니다. OpenClaw 게이트웨이의 로그 위치(systemd journal, PM2, Docker 로그 등)는 OpenClaw 문서를 따르고, 거기서 stdio 트랙이라면 `memento-mcp-server` 자식 프로세스의 stderr를, HTTP 트랙이라면 게이트웨이가 보낸 요청과 응답 코드(특히 `401`/`5xx`)를 함께 추적하세요.

OpenClaw 고유의 함정 두 가지를 짚어 둡니다.

- **게이트웨이 vs skill 등록 위치 혼동** — 게이트웨이 레벨에 등록했는데 특정 skill에서 도구가 안 보인다면, 그 skill이 명시적 MCP allowlist를 갖고 있어 `memento`를 가려내고 있을 수 있습니다. skill manifest의 MCP allow/deny 키 이름은 OpenClaw 문서 참조.
- **채널별로 user 통합이 깨질 때** — 같은 사람이 telegram·slack에서 알려준 기억이 서로 회상되지 않는다면, 게이트웨이의 user 통합 로직이 채널 raw id를 그대로 `owner_id`로 흘렸을 가능성이 큽니다. 위 식별자 매핑 표대로 `owner_id`는 통합 user에, raw id는 `tags`의 `user:<id>`에만 두도록 어댑터를 손보세요.

---

## 한 단계 더: `@memento/assistant`로 자동 회상/저장

베어 MCP로 기본 통합이 완료됐다면 `@memento/assistant` SDK를 추가해 **매 턴 결정론적 자동 recall/remember**를 얻을 수 있습니다.

### 게이트웨이 레벨 통합 (권장)

skill 레벨에 개별 통합하면 매 skill마다 중복 코드가 생깁니다. **게이트웨이 메시지 파이프라인에 한 번** 붙이는 편이 효율적입니다.

```ts
import { MementoAssistant } from '@memento/assistant';

const memory = MementoAssistant.fromEnv(
  {
    ownerId: gatewayUser.id,   // OpenClaw gateway user ID → ownerId
    channel: adapterName,      // 어댑터 이름 (예: 'telegram', 'slack', 'discord')
  },
  process.env,
);

// 게이트웨이 메시지 핸들러
async function handleMessage(msg) {
  const conversationId = msg.conversationId ?? msg.channelId;

  // ① 메시지 수신 후, LLM 호출 직전
  const ctx = await memory.beforeUserTurn({
    userMessage: msg.content,
    conversationId,
  });

  const systemPrompt = ctx.systemContext
    ? `${gatewayBasePrompt}\n\n${ctx.systemContext}`
    : gatewayBasePrompt;

  const reply = await gateway.llm.chat({ systemPrompt, userMessage: msg.content });
  await gateway.send(reply);

  // ② 응답 전송 직후
  await memory.afterAssistantTurn({
    userMessage: msg.content,
    assistantReply: reply,
    conversationId,
  });
}
```

### 식별자 매핑

| Memento 파라미터 | OpenClaw 소스 | 예시 |
|----------------|--------------|------|
| `ownerId` | 게이트웨이 통합 user 객체의 안정적 ID | `'user_42'` |
| `channel` | 어댑터 이름 또는 채널 종류 | `'telegram'`, `'slack'` |

`ownerId`에는 raw 플랫폼 ID(텔레그램 `123456789` 등) 대신 **게이트웨이가 통합 관리하는 user ID**를 쓰세요. 같은 사람이 telegram·slack 두 채널에서 쓴 기억이 모두 같은 `ownerId` 아래에 모입니다.

환경변수 및 Policy 옵션은 [`_shared/sdk-quickstart.md`](./_shared/sdk-quickstart.md) 참조.

---

## 다음 단계

- [`./_shared/transports.md`](./_shared/transports.md) — stdio·HTTP 트랙 결정과 마이그레이션
- [`./_shared/auth.md`](./_shared/auth.md) — Bearer 토큰 발급·저장·로테이션
- [`./_shared/system-prompt.md`](./_shared/system-prompt.md) — recall/remember 호출을 유도하는 권장 프롬프트
- [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md) — 연결 실패, 401, 회상 결과 비어 있음 등
- [`./README.md`](./README.md) — 통합 가이드 허브로 돌아가기
