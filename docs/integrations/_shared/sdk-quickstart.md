# `@memento/assistant` SDK Quickstart

이 문서는 `@memento/assistant` SDK를 사용해 외부 비서에 Memento 장기기억을 붙이는 방법을 다룹니다. 베어 MCP 방식과의 차이, stdio/HTTP 빠른 시작, 라이프사이클 훅 통합 위치, 환경변수 레퍼런스, 그리고 Memento가 다운돼도 비서가 멈추지 않는 degraded 모드까지 순서대로 안내합니다.

---

## 1. 왜 SDK인가 — 베어 MCP와의 차이

베어 MCP 방식은 비서의 LLM이 `recall`·`remember` 도구를 **자기 의지로** 호출하는 구조입니다. 즉 LLM이 깜빡이면 기억을 불러오거나 저장하지 않습니다. SDK는 이 호출을 비서 루프에서 **결정론적으로 자동화**합니다.

| 특성 | 베어 MCP | @memento/assistant SDK |
|------|---------|------------------------|
| 회상 트리거 | LLM 자기 의지 | 매 턴 자동 |
| 저장 트리거 | LLM 자기 의지 | 매 턴 자동 |
| 실패 처리 | LLM이 에러 처리 필요 | 내장 서킷브레이커 + 리트라이 |
| 비서 언어 | 어떤 언어든 (TOML/JSON config만) | Node.js / TypeScript 필수 |
| Rust(ZeroClaw) | ✅ | ❌ (v0.2+ 예정) |

> ZeroClaw 등 Node.js 이외의 비서는 베어 MCP 방식만 사용할 수 있습니다. [`../zeroclaw.md`](../zeroclaw.md) 참고.

---

## 2. 5분: stdio quickstart

설치:

```bash
npm install @memento/assistant
```

환경변수를 별도로 설정하지 않으면 SDK는 `npx -y memento-mcp-server@latest`를 자식 프로세스로 자동 기동합니다. 로컬에서 빠르게 시작하는 가장 간단한 경로입니다.

```ts
import { MementoAssistant } from '@memento/assistant';

const memory = MementoAssistant.fromEnv(
  { ownerId: 'user-123', channel: 'telegram' },
  process.env,
);

const ctx = await memory.beforeUserTurn({
  userMessage: '내 생일이 언제야?',
  conversationId: 'conv-abc',
});

const systemPrompt = ctx.systemContext
  ? `${baseSystemPrompt}\n\n${ctx.systemContext}`
  : baseSystemPrompt;

await memory.afterAssistantTurn({
  userMessage: '내 생일이 언제야?',
  assistantReply: '5월 10일이에요.',
  conversationId: 'conv-abc',
});
```

`ctx.systemContext`가 비어 있지 않을 때의 실제 포맷은 다음과 같습니다:

```
<memento>
- 기억 내용 1
- 기억 내용 2
</memento>
```

이 블록을 base 시스템 프롬프트 뒤에 이어붙이면 LLM이 이전 기억을 바탕으로 응답합니다.

---

## 3. 30분: HTTP quickstart

Memento 서버가 이미 떠 있는 환경(홈서버, NanoClaw 컨테이너 등)이라면 HTTP 트랜스포트를 권장합니다.

```bash
export MEMENTO_TRANSPORT=http
export MEMENTO_URL=http://localhost:9001
export MEMENTO_TOKEN=<admin-api-key>
```

NanoClaw 컨테이너 안에서 호스트의 Memento 서버에 연결할 때는 다음을 사용하세요:

```bash
export MEMENTO_URL=http://host.docker.internal:9001
```

나머지 코드는 stdio 예제와 완전히 동일합니다. `MementoAssistant.fromEnv`가 환경변수를 읽어 트랜스포트를 자동으로 선택합니다.

```ts
import { MementoAssistant } from '@memento/assistant';

const memory = MementoAssistant.fromEnv(
  { ownerId: 'user-123', channel: 'telegram' },
  process.env,
);

// 이후 코드는 stdio quickstart와 동일
```

---

## 4. 라이프사이클 훅 통합 위치

SDK 훅을 비서 루프의 **정확한 위치**에 삽입하는 것이 핵심입니다.

```ts
// 비서 루프 의사코드
while (true) {
  const userMessage = await receiveMessage();

  // ① beforeUserTurn — LLM 호출 직전
  const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
  const systemPrompt = ctx.systemContext
    ? `${basePrompt}\n\n${ctx.systemContext}`
    : basePrompt;

  const reply = await llm.chat({ systemPrompt, userMessage });
  await sendReply(reply);

  // ② afterAssistantTurn — 응답 전송 직후
  await memory.afterAssistantTurn({ userMessage, assistantReply: reply, conversationId });
}
```

**중요**: `beforeUserTurn`이 반환한 `ctx`는 **해당 턴의 LLM 호출에만** 사용하세요. 다음 턴에 재사용하면 기억이 오래된 상태로 고정됩니다.

---

## 5. 환경변수 표

| 환경변수 | 설명 |
|----------|------|
| `MEMENTO_TRANSPORT` | `stdio`(기본) 또는 `http` |
| `MEMENTO_URL` | HTTP 서버 URL |
| `MEMENTO_TOKEN` | HTTP 인증 토큰 |
| `MEMENTO_STDIO_COMMAND` | stdio 커스텀 명령 (기본: `npx -y memento-mcp-server@latest`) |
| `MEMENTO_OWNER_ID` | `ownerId` 기본값 |
| `MEMENTO_CHANNEL` | `channel` 기본값 |
| `MEMENTO_ASSISTANT_LOG` | `off`(기본) / `warn` / `info` / `debug` |

`fromEnv` 옵션(`ownerId`, `channel` 등)이 환경변수보다 우선합니다. 운영 환경에서는 환경변수로 관리하고, 개발·테스트에서는 옵션 객체로 직접 전달하는 방식이 일반적입니다.

`Policy` 기본값:

| 필드 | 기본값 | 선택 가능 값 |
|------|--------|-------------|
| `autoRecall` | `'always'` | `'always'` \| `'heuristic'` \| `'off'` |
| `autoRemember` | `'turn'` | `'turn'` \| `'decision'` \| `'off'` |
| `crossChannelRecall` | `'on'` | `'on'` \| `'off'` |
| `recallLimit` | `8` | — |
| `recallTimeoutMs` | `1500` | — |
| `degradeOnError` | `true` | — |
| `tokenBudget` | `1200` | — |

---

## 6. Degraded 모드 — 비서가 죽지 않는다

SDK는 **절대 throw하지 않습니다**. Memento 서버가 다운되거나 타임아웃이 발생해도 비서 루프는 계속 동작합니다.

```ts
const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
if (ctx.degraded) {
  // 기억 없이 계속 진행 — 비서가 멈추지 않음
}
```

`afterAssistantTurn`도 마찬가지입니다. 저장에 실패하면 RetryQueue에서 최대 3회 재시도하고, 모두 실패할 경우 조용히 drop합니다.

**서킷브레이커**: 연속 5회 실패 시 서킷이 open 상태로 전환되어 30초 동안 Memento 호출을 건너뜁니다. 30초 후 half-open 상태로 전환되어 다음 요청으로 복구를 시도합니다. 이 동작은 `degradeOnError: true`(기본값)일 때 활성화됩니다.

---

## 7. 다음 단계

- [OpenClaw 가이드](../openclaw.md)
- [NanoClaw 가이드](../nanoclaw.md)
- [ZeroClaw 가이드](../zeroclaw.md) (SDK 미지원 — 베어 MCP 사용)
- [시스템 프롬프트 패턴](./system-prompt.md)
- [통합 가이드 허브](../README.md)
