# NanoClaw × Memento

NanoClaw는 Anthropic Claude Agent SDK 위에서 동작하는 컨테이너형 개인 AI 비서입니다 (참고: <https://github.com/qwibitai/nanoclaw>). 각 agent group이 별도 컨테이너로 격리되기 때문에, Memento와의 결합 방식도 그 격리 모델을 깨지 않는 형태가 우선입니다. 이 문서는 NanoClaw 사용자가 Memento를 *베어 MCP* 방식으로 붙이는 5분 셋업 가이드입니다.

전반적인 트랜스포트·인증·시스템 프롬프트 개념은 공통 문서에서 다룹니다. 이 페이지는 NanoClaw 고유의 컨테이너 토폴로지·토큰 주입·식별자 매핑만 정리합니다.

- 트랜스포트 결정과 셋업: [`./_shared/transports.md`](./_shared/transports.md)
- 토큰 발급·저장·로테이션: [`./_shared/auth.md`](./_shared/auth.md)
- 권장 시스템 프롬프트: [`./_shared/system-prompt.md`](./_shared/system-prompt.md)
- 트러블슈팅: [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)
- 통합 가이드 허브: [`./README.md`](./README.md)

---

## 권장 트랙: HTTP

NanoClaw에서는 **호스트에서 Memento를 띄우고, 컨테이너 안의 agent group은 HTTP로 접근**하는 형태를 권장합니다. 이유는 셋입니다.

1. **격리 모델과 정합** — NanoClaw의 핵심 가치는 agent group마다 컨테이너가 분리되어 파일·런타임이 섞이지 않는다는 점입니다. stdio 트랙으로 가려면 컨테이너마다 `memento-mcp-server` npx 바이너리와 SQLite 데이터 파일을 마운트해야 하므로 격리가 빠르게 흐려집니다.
2. **데이터 파일 단일화** — Memento SQLite는 한 곳에서 단일 프로세스가 잡고 있는 편이 가장 안전합니다. 여러 agent group이 같은 파일을 동시에 stdio로 잡으면 락 경합과 백업 일관성 문제가 생깁니다.
3. **업그레이드 비용** — `npx memento-mcp-server@latest`는 호스트에서 한 번만 올리면 끝이지만, 컨테이너 안에서 띄우면 이미지 빌드·재배포가 매번 따라옵니다.

stdio도 **기술적으로는 가능**합니다 (`## 옵션: stdio 마운트 패턴 (비권장)` 섹션 참조). 다만 위 비용 대비 얻는 이득이 거의 없으므로, 잘 모르는 상태에서는 HTTP를 고르세요.

---

## 호스트 셋업

호스트(노트북·홈서버)에서 Memento HTTP 서버를 컨테이너로 띄웁니다. 저장소 클론 후 다음을 실행하세요. 자세한 변수와 옵션은 [`./_shared/transports.md`](./_shared/transports.md#http-트랙)에 있습니다.

```bash
# 저장소 클론 후
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
```

기본 포트는 `9001`이고, MCP 라우트는 `/mcp`, 헬스 체크는 `/health` 입니다. 컨테이너에서 호스트로 접근하려면 호스트의 방화벽이 `9001`을 막지 않도록 두거나, NanoClaw 컨테이너와 같은 docker network에 Memento를 올려두세요.

토큰 발급은 [`./_shared/auth.md`](./_shared/auth.md#발급-절차)의 절차를 그대로 따릅니다. 발급한 64자 hex 비밀을 환경변수로 export 해 두세요.

```bash
export MEMENTO_TOKEN="…64자 hex…"
```

`/health`가 `200 OK`로 응답하고, `/mcp`가 토큰 없이 `401`, 토큰을 붙이면 `200`으로 응답하면 호스트 셋업은 끝입니다 ([`./_shared/auth.md`](./_shared/auth.md#발급-검증)).

---

## NanoClaw 컨테이너에서 등록

NanoClaw fork에서 agent group이 읽는 MCP 설정에 다음 블록을 추가하세요. 정확한 파일 경로는 NanoClaw 빌드에 따라 `mcp.json` (전역 또는 agent group별) 이거나 agent group의 `CLAUDE.md` 안 MCP 섹션일 수 있습니다 — NanoClaw 문서 참조.

```json
{
  "mcpServers": {
    "memento": {
      "transport": "http",
      "url": "http://host.docker.internal:9001/mcp",
      "headers": {
        "Authorization": "Bearer ${MEMENTO_TOKEN}"
      }
    }
  }
}
```

`host.docker.internal`은 Mac/Windows의 Docker Desktop에서는 기본 동작합니다. **Linux 호스트(Docker 20.10+)에서는** 컨테이너 실행 시 `--add-host=host.docker.internal:host-gateway` 플래그를 추가해야 인식됩니다. NanoClaw가 자체적으로 docker compose를 쓴다면 해당 서비스에 다음을 추가하세요.

```yaml
services:
  agent-group:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

같은 docker network 안에서 Memento도 함께 띄우는 구성이라면 `host.docker.internal` 대신 서비스 이름(예: `http://memento:9001/mcp`)을 써도 됩니다.

---

## 토큰 주입

토큰을 config에 평문으로 박지 마세요. NanoClaw fork의 `.env.local`에 두고, agent group 컨테이너에 환경변수로 주입하는 패턴을 권장합니다.

```bash
# NanoClaw fork 루트의 .env.local
MEMENTO_TOKEN=…64자 hex…
```

`.env.local`은 반드시 `.gitignore`에 들어 있어야 합니다 — NanoClaw 기본 fork에 이미 포함되어 있는지 한 번 확인하세요. 토큰을 git에 커밋하면 회전이 강제됩니다 ([`./_shared/auth.md`](./_shared/auth.md#회전)).

agent group 컨테이너로 변수를 흘려보내는 정확한 키 이름·mount 정책은 NanoClaw 문서 참조. 일반적으로 docker compose의 `env_file: .env.local` 또는 agent group 정의의 `environment:` 항목으로 흘립니다. 위 `mcp.json`의 `${MEMENTO_TOKEN}` 치환은 그 환경변수가 컨테이너 안에서 보일 때 동작합니다.

저장 위치·로테이션 정책은 [`./_shared/auth.md`](./_shared/auth.md#비서별-secret-저장-위치)의 권장 사항을 따르세요.

---

## 식별자 매핑

NanoClaw는 agent group 단위로 격리되고, 그 안에서 채널 모듈(예: telegram, discord, web 어댑터 등)이 메시지를 받습니다. Memento와의 매핑은 다음과 같이 두는 것을 권장합니다.

| NanoClaw 측 | Memento 측 | 비고 |
|---|---|---|
| agent group 이름 | `owner_id` | 같은 agent group 안의 메시지를 한 사람으로 묶습니다. group 이름은 안정적인 식별자(예: `nano-jee1`)를 쓰세요. |
| 채널 모듈 이름 | `tags`의 `channel:<module>` | `recall`에서 채널별 필터링이 필요할 때 사용합니다 (예: `channel:telegram`). |
| 채널 측 user id | `tags`의 `user:<id>` | 멀티유저 채널에서 발화자를 구분하려면 함께 부여합니다. |

베어 MCP에서는 위 매핑을 **시스템 프롬프트가 강제**합니다. NanoClaw 어댑터는 메시지마다 `<현재_채널>`·`<현재_사용자>` 자리에 모듈·user 정보를 동적으로 렌더링해야 합니다 ([`./_shared/system-prompt.md`](./_shared/system-prompt.md#채널사용자-태그-치환)).

---

## 옵션: stdio 마운트 패턴 (비권장)

stdio가 꼭 필요한 폐쇄 환경(호스트에 포트를 열 수 없거나 외부 네트워크 호출이 차단된 경우)이라면 다음 블록처럼 컨테이너 안에서 `memento-mcp-server`를 자식 프로세스로 띄울 수 있습니다.

```json
{
  "mcpServers": {
    "memento": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest", "start", "--stdio"]
    }
  }
}
```

권장하지 않는 이유는 셋입니다. 첫째, agent group 컨테이너에 Node.js 런타임과 `npx` 캐시 디렉터리, 그리고 Memento SQLite 데이터 파일을 모두 mount 또는 baked-in 해야 하므로 이미지가 무거워집니다. 둘째, agent group이 늘어날 때마다 같은 SQLite 파일을 여러 컨테이너가 stdio로 잡게 돼 락 경합·백업 일관성이 위태로워집니다. 셋째, 업그레이드가 호스트 한 곳이 아니라 모든 agent group 이미지에 분산됩니다 — `npx … @latest`라도 컨테이너 캐시에 박힌 버전부터 깨야 합니다. 잘 모르겠으면 위의 HTTP 트랙을 쓰세요.

---

## 시스템 프롬프트 적용

[`./_shared/system-prompt.md`](./_shared/system-prompt.md)의 "권장 시스템 프롬프트 블록"을 그대로 복사해 NanoClaw agent group의 system prompt 슬롯에 붙여넣으세요. NanoClaw 빌드에 따라 system prompt는 agent group의 `CLAUDE.md` 또는 별도 prompt 파일·config 항목일 수 있습니다 — 정확한 슬롯 위치는 NanoClaw 문서 참조.

붙여넣은 뒤 다음 두 토큰을 NanoClaw 어댑터의 메시지 렌더링 단계에서 동적으로 치환하도록 만드세요.

- `<현재_채널>` → 메시지를 받은 채널 모듈 이름 (예: `telegram`, `discord:guild123`, `web`)
- `<현재_사용자>` → 채널이 제공하는 안정적 user 식별자 (예: `tg:1234567`, `discord:userid`)

NanoClaw는 멀티채널이 흔하므로 정적 문자열로 두면 모든 기억이 같은 태그로 뭉쳐 나중에 필터링이 깨집니다. 어댑터에서 메시지마다 동적으로 렌더링하세요.

---

## 검증

NanoClaw agent group을 (재)시작한 뒤 다음 두 가지를 차례로 확인하세요.

1. **MCP 도구가 노출됐는가** — agent group이 부팅 직후 `memento.recall`·`memento.remember`를 도구 목록에 올리는지 NanoClaw의 도구 목록 명령(빌드에 따라 다름 — NanoClaw 문서 참조)으로 확인합니다.

2. **회상이 동작하는가** — 채널에서 한 번 사용자 사실을 알려준 뒤("내 형 이름은 진우야"), 새 세션을 열어 같은 주제를 물어 봅니다. NanoClaw가 내부적으로 `memento.recall`을 호출해 그 사실을 답변에 녹여 내야 합니다.

호스트 측에서도 한 번 더 검증할 수 있습니다.

```bash
# Memento가 살아 있는지
curl -i http://localhost:9001/health

# 토큰이 유효한지
curl -i -H "Authorization: Bearer $MEMENTO_TOKEN" \
  http://localhost:9001/api/v1/quality/snapshot

# Memento 컨테이너 로그에서 NanoClaw의 호출이 보이는지
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml logs --tail=50 memento
```

`/health`가 `200`, 토큰 검증이 `200`이면 NanoClaw가 같은 헤더로 보낼 때도 통과합니다. `401`이면 [`./_shared/auth.md`](./_shared/auth.md)와 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md#401-unauthorized) 참조.

---

## 트러블슈팅

연결 실패, 401, 회상 결과가 비어 있음 등 흔한 이슈는 [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md)에 정리돼 있습니다.

NanoClaw 고유의 함정은 다음 한 가지가 가장 흔합니다.

- **`host.docker.internal` 미해결 (Linux)** — 컨테이너에서 `curl http://host.docker.internal:9001/health`가 `Could not resolve host`로 실패하면, 호스트가 Linux이면서 `--add-host=host.docker.internal:host-gateway`(또는 compose의 `extra_hosts`)가 빠졌을 가능성이 높습니다. Docker 20.10+ 에서만 동작하니 도커 버전도 함께 확인하세요. 회피책으로 `network_mode: host` 또는 같은 docker network 안에서 서비스 이름으로 접근하는 방법이 있습니다.

NanoClaw 자체 로그 위치(agent group 컨테이너의 stdout, journald, 또는 NanoClaw 운영 도구)는 NanoClaw 문서를 따르고, 거기서 MCP 호출 직전·직후 로그를 함께 추적하세요.

---

## 한 단계 더: `@jee1/memento-assistant`로 자동 회상/저장

베어 MCP로 기본 통합이 완료됐다면 `@jee1/memento-assistant` SDK를 추가해 **매 턴 결정론적 자동 recall/remember**를 얻을 수 있습니다.

### NanoClaw 컨테이너에서 사용 시 주의

NanoClaw는 컨테이너 기반이므로 SDK는 **컨테이너 내부에서 import**합니다. stdio child spawn은 컨테이너 격리와 충돌하므로 반드시 **HTTP transport를 사용**하세요.

```bash
# NanoClaw 컨테이너의 .env.local 또는 환경변수
MEMENTO_TRANSPORT=http
MEMENTO_URL=http://host.docker.internal:9001
MEMENTO_TOKEN=<admin-api-key>
```

```ts
import { MementoAssistant } from '@jee1/memento-assistant';

const memory = MementoAssistant.fromEnv(
  {
    ownerId: agentGroup.name,  // NanoClaw agent group 이름 → ownerId
    channel: moduleId,         // 채널 모듈 이름 → channel
  },
  process.env,
);

// agent 메시지 핸들러
async function handleMessage(msg) {
  const ctx = await memory.beforeUserTurn({
    userMessage: msg.content,
    conversationId: msg.sessionId,
  });

  const systemPrompt = ctx.systemContext
    ? `${basePrompt}\n\n${ctx.systemContext}`
    : basePrompt;

  const reply = await agent.chat({ systemPrompt, userMessage: msg.content });

  await memory.afterAssistantTurn({
    userMessage: msg.content,
    assistantReply: reply,
    conversationId: msg.sessionId,
  });
}
```

### 식별자 매핑

| Memento 파라미터 | NanoClaw 소스 | 예시 |
|----------------|--------------|------|
| `ownerId` | agent group 이름 | `'personal-assistant'` |
| `channel` | 채널 모듈 이름 | `'telegram-bot'`, `'slack-app'` |

환경변수 및 Policy 옵션은 [`_shared/sdk-quickstart.md`](./_shared/sdk-quickstart.md) 참조.

---

## 다음 단계

- [`./_shared/transports.md`](./_shared/transports.md) — stdio·HTTP 트랙 결정과 마이그레이션
- [`./_shared/auth.md`](./_shared/auth.md) — Bearer 토큰 발급·저장·로테이션
- [`./_shared/system-prompt.md`](./_shared/system-prompt.md) — recall/remember 호출을 유도하는 권장 프롬프트
- [`./_shared/troubleshooting.md`](./_shared/troubleshooting.md) — 연결 실패, 401, 회상 결과 비어 있음 등
- [`./README.md`](./README.md) — 통합 가이드 허브로 돌아가기
