# External Personal Assistant Integration — Design Spec

**Date:** 2026-04-27
**Related Issue:** #100 (방향 전환 — 자체 비서 빌드 보류)
**Status:** Draft v1
**Author:** brainstorming session 산출물

---

## 1. 목적

OpenClaw / NanoClaw / ZeroClaw 같은 **이미 존재하는 단일-사용자 개인 AI 비서**가 Memento를 *공유 장기 기억 백엔드*로 사용할 수 있게 한다. **새 비서 런타임을 만들지 않는다** (= 이슈 #100 `memento-agent` 방향과 결별).

### 핵심 장면
사용자는 노트북(ZeroClaw)과 홈서버(OpenClaw)에서 같은 비서 페르소나를 쓰고, Telegram·Discord·iMessage를 오가며 대화한다. 어디서 말해도 **같은 기억**을 본다.

---

## 2. 범위

### v0.1 = L1 + L3

**Phase 1 (L1) — 가이드:**
- 세 비서별 통합 가이드: `docs/integrations/{openclaw,nanoclaw,zeroclaw}.md`
  - stdio 트랙 (5분 셋업, 단일 머신)
  - HTTP 트랙 (멀티 디바이스, 토큰 발급)
- 권장 시스템 프롬프트 스니펫 (recall-first 패턴)
- 트러블슈팅 / 보안 / 채널 식별 매핑

**Phase 2 (L3) — SDK:**
- `@memento/assistant` 패키지 신설 (현재 비어있는 `packages/memento-assistant/` 채움)
- Transport 추상화 (stdio / HTTP 둘 다 투명 지원 — T3)
- 대화 라이프사이클 훅: `beforeUserTurn` / `afterAssistantTurn`
- 채널 스코핑 헬퍼
- proactive 자동 recall + 자동 remember (옵트인 기본값 ON)
- 폴백 / 저하 모드 (memento 다운 시 비서 멈추지 않음)

### v0.1 제외 (이후)
- **L2** (외부 비서 저장소에 PR 기여): `/add-memento` 스킬, ZeroClaw 플러그인, OpenClaw 스킬
- 비서 측 UI (memento `/dashboard`로 충분)
- 멀티 사용자 / 팀 공유 (단일-사용자 비서 타깃)

### 비-목표
- 비서 런타임을 새로 만들지 않는다
- Memento 코어 도메인 변경 없음 (이 작업은 통합 레이어만 다룸)
- LLM 호출 / 에이전트 루프를 SDK에 포함하지 않는다 (= `memento-agent`와의 명확한 차별점)

---

## 3. 아키텍처 개요

```
┌────────────────────────────────────────────────────────────────────┐
│                  사용자의 머신 (또는 홈서버)                          │
│                                                                    │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │   OpenClaw      │   │   NanoClaw      │   │   ZeroClaw      │   │
│  │ (Node + Skill)  │   │ (Container +    │   │ (Rust binary)   │   │
│  │                 │   │  Claude SDK)    │   │                 │   │
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘   │
│           │                     │                     │            │
│           │  (1) MCP 도구 등록 — L1 가이드            │            │
│           │       stdio 또는 HTTP                     │            │
│           │                     │                     │            │
│           │ ┌───────────────────┴───────────────────┐ │            │
│           ├─┤  @memento/assistant  (L3, 옵션)       ├─┤            │
│           │ │  - Transport 추상화                   │ │            │
│           │ │  - beforeUserTurn / afterAssistantTurn│ │            │
│           │ │  - 채널 스코핑                         │ │            │
│           │ │  - proactive recall/remember          │ │            │
│           │ └───────────────────┬───────────────────┘ │            │
│           ▼                     ▼                     ▼            │
│  ┌────────────────────────────────────────────────────────┐        │
│  │                    Memento 서버                         │        │
│  │  ┌──────────────┐    또는    ┌──────────────────────┐  │        │
│  │  │ stdio MCP    │             │ HTTP MCP + REST     │  │        │
│  │  └──────┬───────┘             └─────────┬────────────┘  │        │
│  │         └───────────┬─────────────────────┘             │        │
│  │                     ▼                                   │        │
│  │            @memento/core (도메인 로직)                  │        │
│  │           SQLite + FTS5 + sqlite-vec                    │        │
│  └────────────────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────────────┘
```

### 두 개의 통합 채널 (의도적 이중성)

**채널 A — "베어 MCP"** (L1 단독, 모든 비서에서 가능)
- 비서가 memento를 그냥 또 하나의 MCP 서버로 등록
- LLM이 스스로 `recall`/`remember`를 도구로 호출
- 우리 쪽 코드 변경 0, 가이드 + 시스템 프롬프트 권장 패턴만 제공
- 장점: 즉시 동작, 위험도 0, 세 비서 모두 호환
- 단점: 자동 회상 품질이 LLM의 "도구 호출 의지"에 종속

**채널 B — "memento-assistant SDK"** (L3, 옵션)
- 비서가 자기 메시지 파이프라인 안에서 SDK를 호출
- 매 사용자 발화 *앞*에 `beforeUserTurn(msg)` → 관련 기억 자동 주입
- 매 비서 응답 *뒤*에 `afterAssistantTurn(reply)` → 자동 저장
- 장점: LLM의 도구 호출 의지와 무관한 결정론적 동작
- 단점: 비서 측 코드 한 군데 수정 필요 (그래서 옵션)

### 핵심 설계 원칙

1. **두 채널은 독립적이고 상호 배타적이지 않다.** A로 시작 → 필요할 때 B로 업그레이드. 같은 memento 인스턴스에 둘 다 붙어도 정합성 안 깨짐.
2. **Transport는 SDK 내부 구현 디테일.** 사용자/비서는 stdio든 HTTP든 같은 `MementoAssistant` API만 본다. URL/토큰만 환경변수로 바꾸면 전환됨.
3. **비서가 죽지 않는다.** memento 다운 시 SDK는 빈 컨텍스트를 반환하고 경고만 로그. 절대 throw하지 않음 (§7).
4. **메모리 코어를 건드리지 않는다.** 모든 작업은 `@memento/client` + `@memento/assistant` 신설 패키지에 한정.

---

## 4. L1: 비서별 통합 가이드

### 산출물 위치

```
docs/integrations/
  README.md                # 통합 허브
  _shared/
    transports.md          # T3: stdio vs HTTP 트랙 결정 가이드
    auth.md                # 토큰 발급, 회전, 폐기
    system-prompt.md       # recall-first 권장 패턴
    troubleshooting.md
  openclaw.md
  nanoclaw.md
  zeroclaw.md
```

### 비서 가이드 공통 골격 (90% 동일)

**4.1 5분 셋업 (stdio 트랙)**
- `npx memento-mcp-server@latest setup`
- 비서별 MCP 등록 스니펫 (예시는 가이드 본문에)

**4.2 멀티 디바이스 셋업 (HTTP 트랙)**
- `docker compose -f docker-compose.prod.yml up -d`
- `/auth/session` 또는 `/admin`에서 Bearer 토큰 발급
- HTTP MCP 등록 스니펫 + `Authorization` 헤더 위치
- 토큰을 비서별 secret store에 저장하라는 보안 노트

**4.3 권장 시스템 프롬프트 (`_shared/system-prompt.md` import)**
- "사용자가 새 주제를 꺼내거나 과거를 참조하면 먼저 `memento.recall`을 호출하라. 사실/선호/약속/결정사항이 나오면 끝나기 전 `memento.remember`로 저장하라."
- 비서별 채널 컨텍스트를 `tags`에 넣는 패턴 예시

**4.4 채널 스코핑 권장**
- §5 모델을 가이드 코드 스니펫에 그대로 반영

**4.5 트러블슈팅**
- "memento가 응답이 없음", "검색 결과 비어있음", "토큰 401" 등

### 비서별 *고유* 부분 (10%)

| 비서 | 고유 이슈 |
|---|---|
| OpenClaw | 게이트웨이의 skill loading 메커니즘, MCP 등록 컨텍스트 |
| NanoClaw | **호스트에서 memento 실행 + 컨테이너에서 HTTP 접근 권장** (stdio는 컨테이너 격리 모델과 충돌). mount 정책 명시 |
| ZeroClaw | Rust 바이너리의 `[[mcp.servers]]` config 위치, 필요 feature flag |

### 무엇을 *하지 않는*가
- 각 비서 저장소에 PR 보내지 않는다 (= L2). v0.1은 memento 쪽 docs만.

---

## 5. 멀티채널 스코핑 모델

### 결정: owner_id = 사용자, tags로 채널 구분, 기본 검색은 사용자 전체

```
owner_id   = "user:<userId>"
tags       = ["channel:telegram", "channel:discord", ...]
project_id = (비활용 — 향후 "워크스페이스" 도입 시)
```

### 의미

| 시나리오 | 동작 |
|---|---|
| Telegram에서 "내 생일 5/10" 저장 → Discord에서 "내 생일 언제?" | 회상됨 (owner_id만으로) |
| 채널별로만 회상하고 싶을 때 | `recall(query, { tags: ['channel:telegram'] })` 명시 |

### `@memento/assistant` 자동 적용

```ts
const memory = MementoAssistant.fromEnv({
  ownerId: 'user:jee1lee',
  channel: 'telegram',
  policy: { crossChannelRecall: 'on' }
});
// remember 시: tags = [...userTags, 'channel:telegram'], owner_id = 'user:jee1lee'
// recall 시:   crossChannelRecall='on'  → tags 필터 없음
//              crossChannelRecall='off' → tags ⊇ ['channel:telegram']
//              crossChannelRecall='sameContext' → 향후 (work/personal 컨텍스트 도입 시)
```

기본값 `'on'`. 프라이버시 우려 있는 사용자는 `'off'`로 끔.

### 비서별 사용자/채널 식별 매핑

| 비서 | userId 소스 | channel 소스 |
|---|---|---|
| OpenClaw | gateway의 user 객체 | channel 어댑터 이름 |
| NanoClaw | agent group 이름 | channel 모듈 이름 |
| ZeroClaw | config의 actor.id | channel kind |

### 명시적 비-결정
- 채널별 별도 owner_id 부여 안 함 (멀티채널 가치 무력화)
- conversation_id 기반 격리 안 함 (working TTL 48h로 자연 격리)
- project_id 미사용 (개인 비서엔 과함, 빈자리 유지)

---

## 6. `@memento/assistant` SDK 표면

### 패키지 구조

```
packages/memento-assistant/
  src/
    index.ts                  # 공개 API export
    assistant.ts              # MementoAssistant 클래스
    transport/
      transport.ts            # interface Transport
      stdio-transport.ts
      http-transport.ts       # @memento/client 위에 thin wrapper
      factory.ts              # env/옵션 → Transport 인스턴스
    scoping/
      channel-scope.ts
    lifecycle/
      before-user-turn.ts
      after-assistant-turn.ts
    policy/
      auto-recall-policy.ts
      auto-remember-policy.ts
    fallback/
      degraded-mode.ts
      circuit-breaker.ts
    types.ts
  README.md
  package.json
  tsconfig.json
  vitest.config.ts
```

### 핵심 API

```ts
import { MementoAssistant } from '@memento/assistant';

const memory = MementoAssistant.fromEnv({
  channel: 'telegram',
  ownerId: 'user:jee1lee',
  policy: {
    autoRecall: 'always',           // 'always' | 'heuristic' | 'off'
    autoRemember: 'turn',           // 'turn' | 'decision' | 'off'
    crossChannelRecall: 'on',       // 'on' | 'off' | 'sameContext'
    tokenBudget: 1200,
    recallLimit: 8,
    recallTimeoutMs: 1500,
    degradeOnError: true,
  },
});

// 매 사용자 발화 직전
const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
// ctx.systemContext (포맷된 텍스트, 시스템 프롬프트에 합성)
// ctx.references    (메타데이터 배열, UI 출처 표시 옵션)
// ctx.degraded      (boolean)

// 매 비서 응답 직후
await memory.afterAssistantTurn({
  userMessage,
  assistantReply,
  conversationId,
  extracted: [{ kind: 'preference', content: '...' }],  // 옵션
});

// 명시 호출 (선택)
await memory.remember({ content: '...', type: 'semantic', tags: [...] });
const hits = await memory.recall('지난번 그 식당 이름이 뭐였지?');
```

### `MementoAssistant.fromEnv()`
- 환경변수만으로 stdio/HTTP 자동 결정 (T3 핵심)
- `MEMENTO_TRANSPORT=stdio` (기본) → 자식 프로세스 spawn
- `MEMENTO_TRANSPORT=http MEMENTO_URL=… MEMENTO_TOKEN=…` → HTTP

### 라이프사이클 훅

| 훅 | 입력 | 출력 | 부수효과 |
|---|---|---|---|
| `beforeUserTurn` | userMessage + conversationId | `{ systemContext, references, degraded }` | 없음 (read-only) |
| `afterAssistantTurn` | userMessage + assistantReply + extracted? | void | working memory 저장, 필요 시 episodic/semantic 승급 |
| `recall` / `remember` | client passthrough | client 결과 | client와 동일 |

**Invariant**: `beforeUserTurn`/`afterAssistantTurn` 은 절대 throw하지 않는다. memento 다운이어도 `degraded:true` 빈 번들 반환. 비서는 그냥 계속 응답함.

### `extracted` 형태

```ts
type ExtractedItem =
  | { kind: 'fact';        content: string; tags?: string[] }                // → semantic
  | { kind: 'preference';  content: string; tags?: string[] }                // → semantic, importance 0.7
  | { kind: 'event';       content: string; at?: string; tags?: string[] };  // → episodic
```

`'commitment'`는 v0.1에서 제외 — 미래 약속은 `{ kind: 'event', at: '<future ISO>', tags: ['commitment'] }`로 표현. v0.2에서 reminder 도메인과 함께 재검토.

### 기본값 (Just Works)

| 옵션 | 기본 |
|---|---|
| `autoRecall` | `'always'` |
| `autoRemember` | `'turn'` |
| `crossChannelRecall` | `'on'` |
| `tokenBudget` | `1200` |
| `recallLimit` | `8` |
| `recallTimeoutMs` | `1500` |
| `degradeOnError` | `true` |

### 비-목표
- 자동 요약/consolidation은 memento-core의 sleep-consolidation에 위임 (이미 존재)
- 비서별 메시지 큐/스케줄링 — 각 비서가 잘함, SDK는 stateless
- 직접 LLM 호출 — SDK는 LLM과 무관

---

## 7. 자동 recall / remember 의미론

### Recall — `beforeUserTurn`

```
userMessage
  → autoRecall 정책 체크
     'always'    → 항상 1회 recall
     'heuristic' → 길이/물음표/대명사 휴리스틱
     'off'       → skip
  → scoping 적용
     owner_id = ownerId
     tags filter:
       crossChannelRecall='on'          → 필터 없음
       crossChannelRecall='off'         → tags ⊇ ['channel:<current>']
       crossChannelRecall='sameContext' → 향후
  → client.recall (token budget 처리)
  → 실패 → degraded:true, 빈 systemContext (절대 throw 안 함)
  → systemContext 포맷팅: "<memento>...</memento>" 펜스로 일반 컨텍스트와 구분
```

### Remember — `afterAssistantTurn`

```
턴 종료 (userMessage + assistantReply)
  → autoRemember 정책 체크
     'turn'     → working memory 저장 (user/assistant 페어)
     'decision' → 'turn' + extracted 항목을 type별 저장
     'off'      → skip

  case 'turn':
    type    = 'working'
    content = `User: ${userMessage}\nAssistant: ${assistantReply}`
    ttl     = 48h (memento working 기본)
    tags    = ['channel:<current>', 'conv:<id>', ...userTags]

  case 'decision' AND extracted.length > 0:
    각 항목 → 적절한 type 매핑
      kind:'fact'       → semantic
      kind:'preference' → semantic, importance 0.7
      kind:'event'      → episodic
    + 'turn' 동작도 함께 (working 백업)

  중복 회피:
    extracted 항목은 저장 직전 client.recall(content, limit:1, tags) 로
    유사도 0.85+ 결과 있으면 updateExisting 사용
    'turn' working은 중복 체크 안 함 (TTL로 자연 소멸)

  fire-and-forget:
    저장은 비동기. 실패해도 로그만, 비서에 영향 없음
```

### Working → Episodic 승급
SDK는 working을 그대로 둠. memento-core의 sleep-consolidation 서비스가 알아서 episodic/semantic으로 증류함 (이미 존재). SDK 책임은 *입력만 정확히*.

---

## 8. 오류 처리 / 저하 모드

### 핵심 원칙
**비서는 절대 memento 때문에 멈추지 않는다.** 메모리는 augmentation이지 dependency가 아니다.

### 실패 모드별 동작

| 시점 | 실패 종류 | SDK 동작 | 비서가 보는 결과 |
|---|---|---|---|
| `beforeUserTurn` | 네트워크/타임아웃 | `degraded:true`, 빈 systemContext | 메모리 없이 응답 진행 |
| `beforeUserTurn` | 401/403 | 같음 + 1회 경고 로그 (rate-limited) | 동일 |
| `beforeUserTurn` | 5xx | 같음 | 동일 |
| `beforeUserTurn` | stdio child 사망 | 같음 + spawn 재시도 (백오프) | 동일 |
| `afterAssistantTurn` | 모든 실패 | 큐 적재 + 백그라운드 재시도, 최종 실패 시 **drop** + WARN | 영향 없음 |
| 명시 `recall`/`remember` | 모든 실패 | 정상 throw (호출자 책임) | LLM이 도구 호출 결과로 인지 |

비대칭 의도: 자동 동작은 absorb, 명시 호출은 propagate.

### 타임아웃 / 백오프

```
beforeUserTurn:  recallTimeoutMs = 1500 (사용자 응답 지연 = UX 손상)
afterAssistantTurn 재시도: 1s → 2s → 4s, 최대 3회, 최종 drop
                          큐 cap 1000건, 초과 시 oldest drop (메모리 누수 방지)
stdio: child 사망 → 5s 쿨다운 후 1회 재spawn, 연속 3회 실패 → 다음 startup까지 비활성
       env에 HTTP URL도 있으면 자동 fallback 시도
```

### Circuit Breaker
연속 5회 실패 → 30s open → half-open probe → closed 복귀. 작은 inline 구현.

### 로깅
- 사용자에게 노출 안 함 (비서 로그에만)
- 첫 실패 WARN 1줄, 같은 종류 반복은 1분에 1회 rate-limit
- 정상 복귀 INFO 1줄
- `MEMENTO_LOG=debug` 시 모든 호출 trace

### `degraded` 시그널
비서가 사용하든 무시하든 자유. 옵션으로 시스템 프롬프트에 "(memory unavailable)" 추가하면 LLM이 자연스럽게 응답 가능.

### 명시적 비-목표
- 디스크 WAL/큐 (in-process only — 손실 무방)
- 자동 토큰 갱신 (보안 위험, 가이드에 회전 절차만)
- 헬스체크 endpoint 폴링 (circuit breaker가 자연 헬스 신호)

### Dependency invariant
SDK는 비서 측에 추가 데몬/사이드카를 요구하지 않는다. 단순 in-process 라이브러리.

---

## 9. 테스트 전략

### 패키지별 책임

| 영역 | 위치 | 도구 |
|---|---|---|
| `@memento/assistant` 단위 | `packages/memento-assistant/src/**/*.spec.ts` | Vitest + MockTransport |
| Transport 통합 | `packages/memento-assistant/**/*.integration.spec.ts` | 실제 stdio child + 실제 HTTP fixture |
| End-to-end | `packages/memento-assistant/test/e2e/` | 실제 memento-server + in-memory SQLite |
| L1 가이드 smoke | `tests/integrations/{openclaw,nanoclaw,zeroclaw}.smoke.spec.ts` | 가이드 스니펫을 그대로 사용 |

### 단위 테스트 핵심 케이스

```
beforeUserTurn:
  ✓ autoRecall='always' — 항상 호출
  ✓ autoRecall='off'    — 호출 안 함
  ✓ autoRecall='heuristic' + 짧은 인사 — 호출 안 함
  ✓ autoRecall='heuristic' + 물음표 — 호출함
  ✓ crossChannelRecall='off' — channel tag 필터 적용
  ✓ recall throw → degraded:true
  ✓ recall timeout 1500ms → degraded:true

afterAssistantTurn:
  ✓ autoRemember='turn' — working 1건 저장
  ✓ autoRemember='decision' + fact → semantic
  ✓ autoRemember='decision' + preference → semantic, importance 0.7
  ✓ autoRemember='decision' + event(future at) → episodic
  ✓ remember 실패 → drop, 호출자에 throw 안 함
  ✓ retry 1→2→4s 후 drop
  ✓ 유사도 0.85+ 시 updateExisting

scoping:
  ✓ 자동 tags 부여 (channel/conv)
  ✓ ownerId 항상 전파
  ✓ user-supplied + 자동 tags 머지

circuit breaker:
  ✓ closed → 5회 실패 → open
  ✓ open 동안 즉시 degraded
  ✓ 30s 후 half-open probe → closed
```

### 통합 테스트 (Transport)

```
stdio:
  ✓ child spawn → recall 응답
  ✓ child kill → 5s 후 재spawn
  ✓ 연속 3회 실패 → HTTP fallback (env에 URL 있으면)
  ✓ 종료 시 child cleanup (좀비 방지)

http:
  ✓ Bearer 헤더 부착
  ✓ 401 → degraded
  ✓ MCP-over-HTTP 응답 파싱
  ✓ self-signed TLS 거부 (개발 모드 옵트인)
```

### E2E 시나리오 (5개)

1. **Cross-channel recall**: Telegram에서 fact 저장 → Discord에서 질의 → 회상 (`crossChannelRecall='on'`)
2. **Channel isolation**: 같은 흐름 + `crossChannelRecall='off'` → 회상 안 됨
3. **Degraded fallback**: memento 강제 종료 → beforeUserTurn 즉시 degraded → 비서 응답 정상
4. **Working → episodic 승격**: 같은 사실 5턴 반복 → sleep-consolidation 후 semantic 승급 (입력 정확성 검증)
5. **stdio → http 전환**: env 바꿔 재시작 → 같은 owner_id로 같은 기억 회상 (T3 약속 검증)

### L1 가이드 smoke 테스트

문서 스니펫이 *진짜* 동작하는지. 비서 자체는 설치 안 함 — config 스니펫의 명령어/URL/auth 형식만 검증. 가이드 drift 방지.

### Mocking 정책
- LLM은 항상 mock (echo 등). SDK는 LLM과 무관.
- Embedding provider는 통합/E2E에서 TF-IDF만 (외부 API 의존 0)
- 시간은 vitest fake timers (TTL/백오프 검증)

### CI 게이트
- `npm test` / `npm run lint` / `npm run type-check` 통과
- 신규 패키지 커버리지 ≥85% (CI 리포트만, 빌드 게이트 아님)

### 비-목표
- L2 어댑터 테스트 (v0.1에 없음)
- 부하 / 카오스 테스트 (단일-사용자 비서 타깃)

---

## 10. 롤아웃 / 단계

### Phase 0 — 정리 (PR 1개)
- `packages/memento-agent/` → `packages/_archived/memento-agent-issue-100/` 이동, 루트 workspaces에서 제외
- 이슈 #100에 결정 노트 + close

### Phase 1 — L1 가이드 (PR 2~3개, ~1주)
- `docs/integrations/_shared/{transports,auth,system-prompt,troubleshooting}.md`
- `docs/integrations/{openclaw,nanoclaw,zeroclaw}.md`
- `docs/integrations/README.md` (허브)
- README.md / README.en.md "External Assistants" 섹션
- L1만으로도 사용자가 베어 MCP로 시작 가능 — 가치 출시 빠름

### Phase 2 — L3 SDK (PR 5~7개, ~2주)
1. 패키지 스캐폴드 + Transport 인터페이스 + MockTransport
2. stdio transport
3. http transport (`@memento/client` 위에)
4. `MementoAssistant` + `fromEnv` + `beforeUserTurn`
5. `afterAssistantTurn` + 정책 + extracted 처리
6. 채널 스코핑 + crossChannelRecall + circuit breaker
7. README, examples, 단위/통합/E2E 테스트

### Phase 3 — 가이드 업그레이드 (PR 1~2개, ~3일)
L3 안정화 후 L1 가이드에 "한 단계 더: `@memento/assistant` 사용" 섹션 추가. 두 트랙 병기.

### Phase 4 — L2 (외부 PR, v0.2 이후, 별도 일정)
- NanoClaw `/add-memento` 스킬 → 업스트림 PR
- ZeroClaw 플러그인 → 업스트림 PR
- OpenClaw 스킬 → 업스트림 PR
- 메인테이너 수용 의지에 의존. 거절돼도 L1 가이드(fork 사용)는 유효.

### 마이그레이션 / 호환성
- Memento 코어 변경 없음 → 기존 사용자 영향 0
- `memento-agent` 아카이브: 외부 의존 거의 없을 것. published라면 deprecate 1릴리스 후 제거.

### 성공 기준 (v0.1 출시 시점)
- ZeroClaw에서 5분 안에 stdio MCP로 등록 → 회상 동작
- HTTP 트랙으로 노트북 ZeroClaw + 홈서버 OpenClaw 기억 공유
- `@memento/assistant` 사용 시 LLM 도구 호출 없이도 자동 회상/저장
- memento 강제 종료 → 비서 응답 계속

### 위험 / 완화

| 위험 | 완화 |
|---|---|
| 세 비서 plugin 모델 변경 → 가이드 drift | smoke 테스트 + `_shared/` 추출 |
| 사용자가 토큰 평문 저장 → 유출 | 가이드에 비서별 secret store 위치 명시 |
| HTTP 트랙 셋업 복잡 → 채택률 저조 | `docker compose up`만으로 시작하는 quickstart |
| L3 SDK가 LLM 가정에 의존 | `extracted`는 옵션, 'turn' 모드만으로도 가치 |
| 무한 retry 메모리 누수 | in-process 큐 cap 1000건 |

### 출시 후 측정
memento 텔레메트리에서:
- `memento-assistant/<v>` user-agent 별 호출량
- recall p95 latency
- circuit breaker open 빈도
- → v0.2 우선순위 입력

---

## Appendix A — 결정 요약

| 항목 | 결정 | 대안 (기각) |
|---|---|---|
| 통합 깊이 | L1 + L3 (L2는 v0.2 이후) | L1만 / L1+L2 / L3만 |
| 배포 토폴로지 | T3 (stdio + HTTP 둘 다 지원) | T1 stdio only / T2 HTTP only |
| 채널 스코핑 | owner_id=user, tags=channel | 채널별 owner_id (멀티채널 가치 무력화) |
| 자동 회상 기본값 | `autoRecall='always'` | `'heuristic'` (정확도 ↓) |
| 자동 저장 기본값 | `autoRemember='turn'` | `'decision'` (extracted 의존 ↑) |
| 채널 간 회상 | 옵션 (기본 'on', 'off' 가능) | 항상 통합 (프라이버시) / 항상 격리 (가치 ↓) |
| ExtractedItem.kind | fact / preference / event | + commitment (v0.2 reminder와 함께 재검토) |
| 실패 시 손실 | drop 허용 (in-process queue only) | 디스크 WAL (단순함 손해) |
| `memento-agent` 패키지 | 아카이브 (`packages/_archived/`) | 삭제 / 유지 |

## Appendix B — 용어

- **L1 / L2 / L3**: 통합 깊이 단계. L1=가이드만, L2=외부 비서에 PR 기여, L3=memento쪽 SDK
- **T1 / T2 / T3**: 배포 토폴로지. T1=stdio, T2=HTTP, T3=둘 다
- **베어 MCP**: SDK 없이 비서가 memento를 그냥 MCP 서버로 등록한 상태
- **degraded mode**: memento 호출 실패 시 빈 컨텍스트로 응답 진행하는 폴백 모드
