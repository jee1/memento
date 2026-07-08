# @memento/assistant

외부 AI 비서(OpenClaw 등)가 Memento를 **공유 장기 기억**으로 쓰게 해 주는 SDK입니다. LLM 호출은 비서 쪽에 그대로 두고, Memento 쪽에는 두 훅만 붙이면 됩니다. 사용자 턴 직전에 `beforeUserTurn`으로 관련 기억을 끌어오고, 비서 응답이 끝난 뒤 `afterAssistantTurn`으로 대화를 저장합니다.

## 설치

```bash
npm install @memento/assistant
```

## 5분 빠른 시작 (stdio — MCP 서버 자동 시작)

```ts
import { MementoAssistant } from '@memento/assistant';

const memory = MementoAssistant.fromEnv(
  { ownerId: 'user-123', channel: 'telegram' },
  process.env,
);

// 사용자 메시지 수신 시
const ctx = await memory.beforeUserTurn({
  userMessage: '내 생일이 언제야?',
  conversationId: 'conv-abc',
});

// ctx.systemContext를 LLM system prompt에 추가
const systemPrompt = ctx.systemContext
  ? `${baseSystemPrompt}\n\n${ctx.systemContext}`
  : baseSystemPrompt;

// 비서 응답 완료 후
await memory.afterAssistantTurn({
  userMessage: '내 생일이 언제야?',
  assistantReply: '5월 10일이에요.',
  conversationId: 'conv-abc',
});
```

환경 변수 설정 없이 실행하면 `npx -y memento-mcp-server@latest`를 자동으로 자식 프로세스로 시작합니다.

## 30분 빠른 시작 (HTTP — 이미 실행 중인 Memento 서버 연결)

```bash
export MEMENTO_TRANSPORT=http
export MEMENTO_URL=http://localhost:9001
export MEMENTO_TOKEN=<admin-api-key>  # 선택
```

```ts
const memory = MementoAssistant.fromEnv(
  { ownerId: 'user-123' },
  process.env,
);
```

## API 표면

### `MementoAssistant.fromEnv(opts, env)`

| 옵션 | 타입 | 설명 |
|------|------|------|
| `ownerId` | `string?` | 메모리 소유자 ID |
| `channel` | `string?` | 채널 식별자 (telegram, discord 등) |
| `userTags` | `string[]?` | 모든 기억에 추가할 태그 |
| `policy` | `Policy?` | 동작 정책 (아래 참조) |
| `transport` | `Transport?` | 커스텀/테스트용 transport 주입 |

### `Policy` 옵션

| 키 | 기본값 | 설명 |
|----|--------|------|
| `autoRecall` | `'always'` | `'always'` / `'heuristic'` / `'off'` |
| `autoRemember` | `'turn'` | `'turn'` / `'decision'` / `'off'` |
| `crossChannelRecall` | `'on'` | `'on'` / `'off'` |
| `tokenBudget` | `1200` | systemContext 최대 토큰 수 (미래 사용) |
| `recallLimit` | `8` | 회상 결과 최대 개수 |
| `recallTimeoutMs` | `1500` | recall 타임아웃 (ms) |
| `degradeOnError` | `true` | 오류 시 degraded 모드로 계속 실행 |

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MEMENTO_TRANSPORT` | `stdio` | `stdio` 또는 `http` |
| `MEMENTO_URL` | — | HTTP transport 서버 URL |
| `MEMENTO_TOKEN` | — | HTTP transport 인증 토큰 |
| `MEMENTO_STDIO_COMMAND` | `npx -y memento-mcp-server@latest` | stdio 커스텀 실행 명령 |
| `MEMENTO_OWNER_ID` | — | ownerId 기본값 |
| `MEMENTO_CHANNEL` | — | channel 기본값 |
| `MEMENTO_ASSISTANT_LOG` | `off` | 로그 레벨: `off` / `warn` / `info` / `debug` |

## degraded 모드

`beforeUserTurn`은 절대 throw하지 않습니다. transport 오류, 타임아웃, 서킷브레이커 open 시 `degraded: true`와 빈 `systemContext`를 반환합니다. 비서가 기억 백엔드 없이도 계속 동작할 수 있도록 설계된 원칙입니다.

```ts
const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
if (ctx.degraded) {
  // 기억 없이 계속 진행 — 비서를 멈추지 않음
}
```

`afterAssistantTurn`도 마찬가지로 절대 throw하지 않습니다. 저장 실패 시 RetryQueue가 최대 3회 재시도하고, 모두 실패하면 조용히 drop합니다 (`MEMENTO_ASSISTANT_LOG=warn` 설정 시 경고 출력).

## 테스트에서 MockTransport 사용

```ts
import { MementoAssistant } from '@memento/assistant';
import { MockTransport } from '@memento/assistant';

const t = new MockTransport();
t.fixture('m:1', { content: '사용자 이름: Alice', type: 'semantic' });

const a = MementoAssistant.fromEnv({ transport: t }, {});
const ctx = await a.beforeUserTurn({ userMessage: '내 이름이 뭐야?', conversationId: 'c1' });
expect(ctx.systemContext).toContain('Alice');
```

## 모노레포에서 개발

이 저장소 루트에서 패키지를 빌드·검증하려면 [루트 `package.json`](../../package.json)의 워크스페이스 스크립트를 사용합니다. 예:

```bash
npm run build -w @memento/assistant
npm run type-check -w @memento/assistant
npm run test -w @memento/assistant
```

## FAQ

**Q: stdio vs HTTP 어느 걸 써야 하나요?**
stdio는 별도 서버 설치 없이 쓸 수 있어 빠르게 시작할 때 좋습니다. HTTP는 이미 Memento 서버가 실행 중이거나 여러 비서가 같은 서버를 공유할 때 적합합니다.

**Q: `crossChannelRecall: 'off'`는 무엇을 하나요?**
recall 시 `channel:<name>` 태그로 필터링해서 같은 채널의 기억만 가져옵니다. 기본값(`'on'`)은 채널 구분 없이 모든 기억을 검색합니다.

**Q: `autoRemember: 'decision'`은 무엇인가요?**
`extracted` 항목(사실, 선호도, 이벤트)을 semantic/episodic 메모리로 저장하고, 유사한 기억이 이미 있으면 덮어씁니다(dedup). 기본 `'turn'` 모드는 매 턴의 대화 전체를 working 메모리로 저장합니다.
