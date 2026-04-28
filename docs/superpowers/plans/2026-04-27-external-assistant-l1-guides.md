# External Assistant Integration — L1 Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 0 (memento-agent 아카이브) + Phase 1 (외부 비서 통합 가이드 docs) 완료. v0.1 스펙의 L1 단계로, 사용자가 OpenClaw / NanoClaw / ZeroClaw에서 베어 MCP로 memento를 즉시 사용할 수 있게 한다.

**Architecture:** 모든 가이드 docs는 `docs/integrations/` 아래에 모이고, 90% 공통 내용은 `_shared/`로 추출, 10% 비서별 차이만 비서 파일에 둔다. T3 트랙(stdio + HTTP)을 둘 다 안내. 코드 변경은 Phase 0 아카이브 이동 한 건뿐.

**Tech Stack:** Markdown, JSON/TOML config 스니펫, Node.js (스모크 테스트), Vitest

**Spec:** `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`

---

## 파일 구조

| 파일 | 유형 | 역할 |
|---|---|---|
| `packages/_archived/memento-agent-issue-100/**` | 이동 | 기존 `packages/memento-agent/` 전체를 아카이브 |
| `packages/_archived/README.md` | 신규 | 아카이브 정책 노트 |
| `docs/integrations/README.md` | 신규 | 통합 허브, 비서 선택 + 트랙 결정 가이드 진입점 |
| `docs/integrations/_shared/transports.md` | 신규 | T3: stdio vs HTTP 트랙 결정 + 셋업 |
| `docs/integrations/_shared/auth.md` | 신규 | 토큰 발급, 회전, 폐기, secret store 가이드 |
| `docs/integrations/_shared/system-prompt.md` | 신규 | recall-first 시스템 프롬프트 패턴, ExtractedItem 추출 가이드 |
| `docs/integrations/_shared/troubleshooting.md` | 신규 | 공통 이슈 (응답 없음, 빈 결과, 401 등) |
| `docs/integrations/openclaw.md` | 신규 | OpenClaw 고유 셋업 + 식별자 매핑 |
| `docs/integrations/nanoclaw.md` | 신규 | NanoClaw 고유 (호스트 memento + 컨테이너 HTTP 접근) |
| `docs/integrations/zeroclaw.md` | 신규 | ZeroClaw 고유 (Rust `[[mcp.servers]]` config) |
| `README.md` | 수정 | "External Assistants" 섹션 + 허브 링크 |
| `README.en.md` | 수정 | 영문 동일 |
| `tests/integrations/smoke.spec.ts` | 신규 | L1 가이드 스니펫 drift 방지 스모크 (최소형) |
| `vitest.config.ts` | 수정 (필요 시) | tests/integrations/ include |

---

## Task 0: 작업 브랜치 생성

**Files:** (없음 — git 작업)

### 배경

이 저장소의 글로벌 규칙: **main 직접 커밋 금지, 항상 브랜치 → PR**. 모든 후속 task는 이 브랜치에서 수행한다.

> **Note:** 본 plan 문서 자체가 이미 `docs/external-assistant-integration-design` 브랜치에 커밋되어 있다면 그 브랜치를 그대로 이어 쓰면 된다. 새로 시작하는 경우에만 아래 명령 실행.

- [ ] **Step 1: 브랜치 확인 / 생성**

```bash
git branch --show-current
# 결과가 'main'이면 새 브랜치 생성:
git checkout -b docs/external-assistant-integration-design
# 결과가 이미 'docs/external-assistant-integration-design'이면 skip
```

기대 결과: 작업 브랜치 `docs/external-assistant-integration-design`에 위치.

---

## Task 1: memento-agent 아카이브

**Files:**
- Move: `packages/memento-agent/` → `packages/_archived/memento-agent-issue-100/`
- Create: `packages/_archived/README.md`

### 배경

`packages/memento-agent/`는 이슈 #100의 자체 비서 빌드 산출물(설계 + 일부 스캐폴드). 외부 비서 통합으로 방향 전환했으므로 active 패키지에서 제외한다. 루트 `package.json`의 `workspaces` 배열에 이미 포함되어 있지 않아 빌드/테스트 영향 없음 — 그래도 `packages/` 아래에 있으면 혼란을 줄 수 있어 `_archived/`로 격리.

- [ ] **Step 1: 현재 git 상태 확인**

```bash
git status -s packages/memento-agent
```

결과 해석:
- 라인이 `??`로 시작 → **untracked**. `git mv` 사용 불가. Step 2의 폴백 경로 사용.
- 라인이 비어있거나 `M`/`A` 등으로 시작 → **tracked**. `git mv` 사용 가능.

- [ ] **Step 2: 아카이브 디렉터리 생성 및 이동**

tracked인 경우:
```bash
mkdir -p packages/_archived
git mv packages/memento-agent packages/_archived/memento-agent-issue-100
```

untracked인 경우 (폴백):
```bash
mkdir -p packages/_archived
mv packages/memento-agent packages/_archived/memento-agent-issue-100
# 새 위치를 git이 인식하도록 (Step 5 commit에서 자동 staged됨)
```

- [ ] **Step 3: 아카이브 README 작성**

```markdown
# _archived

이 디렉터리는 **참고용으로만** 보존되는 보류된 패키지를 담는다. 빌드·테스트·배포에 포함되지 않는다.

## memento-agent-issue-100

이슈 #100 ("자체 Memento Agent 빌드")의 산출물. 2026-04-27 외부 비서 통합(OpenClaw / NanoClaw / ZeroClaw) 방향으로 전환되면서 active 개발이 중단되었다.

- 설계: `docs/superpowers/specs/2026-04-25-memento-agent-design.md`
- 새 방향: `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`

코드와 설계는 향후 reminder/scheduled-recall 같은 코어 기능 도입 시 참고할 가치가 있어 보존.
```

저장: `packages/_archived/README.md`

- [ ] **Step 4: 빌드 깨지지 않음 확인**

```bash
npm install
npm run build
```

기대 결과: 둘 다 성공. `packages/memento-agent`가 `workspaces`에 없었으므로 영향 없어야 함.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npm test
```

기대 결과: 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/_archived
git commit -m "chore: archive memento-agent (issue #100 superseded by external assistant integration)"
```

---

## Task 2: `docs/integrations/` 스켈레톤

**Files:**
- Create: `docs/integrations/README.md`
- Create: `docs/integrations/_shared/transports.md` (placeholder)
- Create: `docs/integrations/_shared/auth.md` (placeholder)
- Create: `docs/integrations/_shared/system-prompt.md` (placeholder)
- Create: `docs/integrations/_shared/troubleshooting.md` (placeholder)
- Create: `docs/integrations/openclaw.md` (placeholder)
- Create: `docs/integrations/nanoclaw.md` (placeholder)
- Create: `docs/integrations/zeroclaw.md` (placeholder)

### 배경

먼저 빈 골격을 만들어 후속 태스크가 각 파일을 채운다. 빈 placeholder는 `> TODO: filled in Task N` 한 줄만 둔다 — drift는 후속 task에서 잡힘.

- [ ] **Step 1: 디렉터리와 placeholder 파일 생성**

각 파일 내용:
```markdown
# <파일 제목>

> TODO: 이 문서는 Task N에서 작성됩니다.
```

- [ ] **Step 2: integrations/README.md 허브 골격**

```markdown
# Memento × External AI Assistants

이 디렉터리는 **이미 존재하는 단일-사용자 개인 AI 비서**가 Memento를 공유 장기 기억 백엔드로 사용하도록 안내합니다. 새 비서를 만들지 않고, 기존 비서에 memento를 *그냥 또 하나의 MCP 서버*로 등록하는 방식입니다.

## 어떤 비서를 쓰시나요?

- [OpenClaw](./openclaw.md) — Node.js 게이트웨이 + 멀티채널
- [NanoClaw](./nanoclaw.md) — 컨테이너 격리 + Claude Agent SDK
- [ZeroClaw](./zeroclaw.md) — Rust 단일 바이너리

## 트랙 결정

- 단일 머신만 사용 → [stdio 트랙](./_shared/transports.md#stdio-트랙) (5분 셋업)
- 여러 디바이스/홈서버 → [HTTP 트랙](./_shared/transports.md#http-트랙) (멀티 디바이스 기억 공유)

## 공통 가이드

- [Transport 결정 + 셋업](./_shared/transports.md)
- [인증 / 토큰 관리](./_shared/auth.md)
- [권장 시스템 프롬프트 패턴](./_shared/system-prompt.md)
- [트러블슈팅](./_shared/troubleshooting.md)

## 더 깊은 통합 (옵션)

베어 MCP만으로 부족하면 `@memento/assistant` SDK를 사용해 *결정론적 자동 회상/저장*을 얻을 수 있습니다. v0.2에서 별도 가이드 추가 예정.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/integrations/
git commit -m "docs(integrations): scaffold external assistant integration guides"
```

---

## Task 3: `_shared/transports.md` 작성

**Files:**
- Modify: `docs/integrations/_shared/transports.md`

### 배경

T3 핵심 문서. stdio vs HTTP 결정 가이드, 각 트랙의 셋업 절차, 트랙 전환 시 주의사항.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- 결정 매트릭스 (단일/멀티 머신, 멀티채널 우선순위, 보안 요구)
- stdio 트랙 셋업: `npx memento-mcp-server@latest setup` 한 줄, 트러블슈팅 링크
- HTTP 트랙 셋업: `docker compose -f docker-compose.prod.yml up -d`, base URL 확인, `/auth/session` 흐름
- 트랙 전환: 같은 owner_id로 같은 SQLite 파일을 보면 stdio/HTTP가 같은 데이터를 본다는 점, 마이그레이션 절차

저장 위치: `docs/integrations/_shared/transports.md`

- [ ] **Step 2: 내부 링크 검증**

```bash
npm run docs:audit-links
```

기대 결과: 새 링크 모두 OK.

- [ ] **Step 3: 커밋**

```bash
git add docs/integrations/_shared/transports.md
git commit -m "docs(integrations): write _shared/transports.md"
```

---

## Task 4: `_shared/auth.md` 작성

**Files:**
- Modify: `docs/integrations/_shared/auth.md`

### 배경

HTTP 트랙 사용자가 봐야 할 인증 흐름. 토큰 발급, 회전, 폐기, secret store 권장.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- Bearer 토큰 발급: 어드민 페이지에서 발급, 또는 CLI 발급 명령
- 토큰 종류 (X-API-Key vs Bearer 비교 표 — `docs/reference/ko/security.md` 참조)
- 회전 절차: 새 토큰 발급 → 비서 config 갱신 → 옛 토큰 폐기
- 폐기: 어드민 UI 또는 API 호출
- secret store 권장 (비서별 위치 명시 — OpenClaw env, NanoClaw `.env.local`, ZeroClaw Vault, OS keychain 등)
- TLS 검증: 자체 서명 인증서 사용 시 주의 (개발 모드 옵트인)

- [ ] **Step 2: 링크 검증**

```bash
npm run docs:audit-links
```

- [ ] **Step 3: 커밋**

```bash
git add docs/integrations/_shared/auth.md
git commit -m "docs(integrations): write _shared/auth.md"
```

---

## Task 5: `_shared/system-prompt.md` 작성

**Files:**
- Modify: `docs/integrations/_shared/system-prompt.md`

### 배경

베어 MCP 모드에서 LLM이 `recall`/`remember`를 부지런히 호출하도록 만드는 권장 시스템 프롬프트. v0.2에서 SDK가 자동화하지만, v0.1 베어 MCP는 LLM 의지에 의존.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- 권장 프롬프트 블록 (그대로 복붙 가능):

```text
[Memento Memory]
이 어시스턴트는 memento MCP 서버에 장기 기억을 저장합니다. 다음 규칙을 따릅니다:

1. 사용자가 새 주제를 꺼내거나 과거 사실/대화를 참조할 때, 우선 `memento.recall(query)`를 호출하여 관련 기억을 가져옵니다.
2. 사용자가 사실, 선호, 약속, 결정사항을 알려주면 응답을 마치기 전 `memento.remember`로 저장합니다. type 매핑:
   - 사실/지식 → `semantic`
   - 사건/대화/약속 → `episodic` (미래 약속은 tags에 'commitment' 추가)
   - 임시 컨텍스트 → `working` (48h)
3. 모든 저장은 다음 tags를 자동 부여: ["channel:<현재_채널>", "user:<현재_사용자>"]
4. recall 결과는 출처(memory_id, type, importance)를 응답에 명시하지 않아도 되지만, 사용자가 "어떻게 알았어?"라고 물으면 출처를 노출할 수 있습니다.

memento가 응답하지 않으면 **그냥 진행**하세요. 메모리는 augmentation이지 dependency가 아닙니다.
```

- ExtractedItem 추출 가이드 (LLM이 직접 추출하는 경우 — 베어 MCP에서는 LLM 책임):
  - fact / preference / event 형태 예시
  - "commitment"는 event + tags에 'commitment'로 표현

- 비서별 channel/user 토큰 자리에 무엇을 넣을지 — 비서 가이드 본문에서 다시 안내

- [ ] **Step 2: 커밋**

```bash
git add docs/integrations/_shared/system-prompt.md
git commit -m "docs(integrations): write _shared/system-prompt.md"
```

---

## Task 6: `_shared/troubleshooting.md` 작성

**Files:**
- Modify: `docs/integrations/_shared/troubleshooting.md`

### 배경

흔한 이슈와 진단 단계.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- "memento MCP가 응답이 없음": stdio 자식 프로세스 로그 확인 위치 (비서별 링크), `npx memento-mcp-server health-check` 명령
- "recall 결과가 비어있음": 임베딩 프로바이더 확인 (`/admin/providers`), TF-IDF 폴백 동작 여부, 데이터 파일 위치 (`~/.memento/memento.db`)
- "401 Unauthorized": 토큰 만료/회전 절차 → `auth.md` 링크
- "TLS 인증서 오류": 자체 서명 시 옵션 + 권장 (Let's Encrypt)
- "두 디바이스가 같은 기억을 못 봄": HTTP 트랙으로 전환했는지, 같은 base URL인지, owner_id 일치 여부
- 디버그 로그 활성화: `MEMENTO_LOG=debug` (단, 토큰이 로그에 나오지 않도록 주의 안내)

- [ ] **Step 2: 커밋**

```bash
git add docs/integrations/_shared/troubleshooting.md
git commit -m "docs(integrations): write _shared/troubleshooting.md"
```

---

## Task 7: `zeroclaw.md` 작성

**Files:**
- Modify: `docs/integrations/zeroclaw.md`

### 배경

ZeroClaw는 Rust 바이너리. config가 TOML, MCP 서버는 `[[mcp.servers]]` 블록.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- 사전 조건: `agent-runtime` feature 필요 (소스 빌드 시 `--features agent-runtime`)
- stdio 트랙 config 스니펫:

```toml
# ~/.config/zeroclaw/config.toml 또는 워크스페이스 config.toml
[[mcp.servers]]
name    = "memento"
command = "npx"
args    = ["-y", "memento-mcp-server@latest", "start", "--stdio"]
```

- HTTP 트랙 config 스니펫:

```toml
[[mcp.servers]]
name      = "memento"
transport = "http"
url       = "http://your-home-server:9001/mcp"

[mcp.servers.headers]
authorization = "Bearer ${MEMENTO_TOKEN}"
```

- 식별자 매핑: ZeroClaw `actor.id` → memento `owner_id`, channel kind → tag
- 시스템 프롬프트 적용 위치: `_shared/system-prompt.md` 블록을 ZeroClaw의 system prompt slot에 붙여넣기. `<현재_채널>` 자리에 ZeroClaw 채널 변수
- 검증: ZeroClaw에서 `/list-tools` 같은 명령으로 memento 도구가 노출됐는지 확인

- [ ] **Step 2: 링크 검증**

```bash
npm run docs:audit-links
```

- [ ] **Step 3: 커밋**

```bash
git add docs/integrations/zeroclaw.md
git commit -m "docs(integrations): write zeroclaw guide"
```

---

## Task 8: `nanoclaw.md` 작성

**Files:**
- Modify: `docs/integrations/nanoclaw.md`

### 배경

NanoClaw는 컨테이너 격리. **결정사항: 호스트에서 memento 실행 + 컨테이너 → HTTP 접근**. stdio는 컨테이너 격리 모델과 충돌하므로 비권장.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- 권장 트랙: HTTP only (stdio는 컨테이너 안에서 SQLite 파일까지 마운트하면 가능하지만 maintenance 부담 ↑)
- 호스트 셋업: `docker compose -f docker-compose.prod.yml up -d` (memento 자체 컨테이너), 토큰 발급
- NanoClaw fork에 추가할 mcp config (`mcp.json` 또는 agent CLAUDE.md):

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

- 토큰을 컨테이너에 주입: NanoClaw `.env.local`에 `MEMENTO_TOKEN=...`, agent group의 mount 정책 명시
- 식별자 매핑: NanoClaw agent group 이름 → owner_id 권장 형식, channel 모듈 이름 → tag
- 옵션: stdio를 굳이 쓰고 싶을 때 — SQLite 파일 + npx 바이너리를 컨테이너에 마운트하는 방법 + 비권장 이유

- [ ] **Step 2: 링크 검증 + 커밋**

```bash
npm run docs:audit-links
git add docs/integrations/nanoclaw.md
git commit -m "docs(integrations): write nanoclaw guide"
```

---

## Task 9: `openclaw.md` 작성

**Files:**
- Modify: `docs/integrations/openclaw.md`

### 배경

OpenClaw는 Node.js 게이트웨이 + skill 시스템. MCP 등록은 게이트웨이 config에.

- [ ] **Step 1: 콘텐츠 작성**

내용 골격:
- stdio 트랙 config 스니펫 (게이트웨이 config 또는 skill MCP 등록):

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

- HTTP 트랙 config 스니펫
- 식별자 매핑: OpenClaw gateway user → owner_id, channel 어댑터 이름(telegram/slack 등) → tag
- skill loading 메커니즘 안내: 어떤 skill 컨텍스트에서 memento를 노출할지, 사용자별 분리 시 가이드
- 시스템 프롬프트 적용 위치

- [ ] **Step 2: 링크 검증 + 커밋**

```bash
npm run docs:audit-links
git add docs/integrations/openclaw.md
git commit -m "docs(integrations): write openclaw guide"
```

---

## Task 10: 루트 README에 External Assistants 섹션 추가

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

### 배경

루트 README에서 통합 허브로 진입하는 링크 추가. 기존 README 구조 유지.

- [ ] **Step 1: README.md에 섹션 추가**

기존 "주요 기능" 또는 "설치" 섹션 근처에 다음 블록 추가:

```markdown
## 🔗 외부 AI 비서와 함께 쓰기

OpenClaw / NanoClaw / ZeroClaw 같은 개인 AI 비서가 Memento를 공유 장기 기억 백엔드로 사용할 수 있습니다. 가이드: [docs/integrations/](./docs/integrations/README.md)
```

- [ ] **Step 2: README.en.md에 영문 동일 섹션 추가**

```markdown
## 🔗 Use Memento with External AI Assistants

Personal AI assistants like OpenClaw, NanoClaw, and ZeroClaw can use Memento as a shared long-term memory backend. Guide: [docs/integrations/](./docs/integrations/README.md)
```

- [ ] **Step 3: 링크 검증**

```bash
npm run docs:audit-links
```

- [ ] **Step 4: 커밋**

```bash
git add README.md README.en.md
git commit -m "docs: link external assistant integration hub from root README"
```

---

## Task 11: L1 가이드 스모크 테스트 (최소형)

**Files:**
- Create: `tests/integrations/smoke.spec.ts`
- Modify: `vitest.config.ts` (필요 시 include 패턴 확장)

### 배경

스펙 §9에 따라 가이드 스니펫 drift 방지용 스모크 테스트. v0.1 Phase 1 범위에서는 **스니펫 *추출* + *형식 검증*** 까지만. 실제 spawn/HTTP 호출은 L3 SDK 통합 테스트가 더 효율적이라 v0.2에서 확장.

검증 범위 (이번 task):
- 각 비서 가이드(.md)에서 첫 번째 ```json 또는 ```toml 블록을 추출
- JSON/TOML로 파싱 가능한지 (= 문법 깨짐 없음)
- stdio 블록은 `command`/`args` 키 또는 `command`/`args`에 해당하는 TOML 키가 있는지
- HTTP 블록은 `url`이 있고 `Authorization` 헤더 패턴이 있는지

이 정도만으로도 가이드를 무심코 깨뜨리는 PR을 잡아낼 수 있다.

- [ ] **Step 1: 실패 테스트 작성 (TDD)**

```typescript
// tests/integrations/smoke.spec.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const guides = ['openclaw', 'nanoclaw', 'zeroclaw'];

function extractFencedBlocks(md: string, lang: 'json' | 'toml'): string[] {
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
}

describe('docs/integrations smoke', () => {
  for (const name of guides) {
    it(`${name}.md: stdio config block parses and references memento-mcp-server`, async () => {
      const path = join(ROOT, 'docs/integrations', `${name}.md`);
      const md = await readFile(path, 'utf8');
      const blocks = [...extractFencedBlocks(md, 'json'), ...extractFencedBlocks(md, 'toml')];
      const stdio = blocks.find(b => b.includes('--stdio'));
      expect(stdio, `no stdio config block found in ${name}.md`).toBeTruthy();
      expect(stdio).toMatch(/memento-mcp-server/);
    });

    it(`${name}.md: HTTP config block contains url and Authorization`, async () => {
      const path = join(ROOT, 'docs/integrations', `${name}.md`);
      const md = await readFile(path, 'utf8');
      const blocks = [...extractFencedBlocks(md, 'json'), ...extractFencedBlocks(md, 'toml')];
      const http = blocks.find(b => /url\s*[:=]/.test(b) && /Authorization|authorization/.test(b));
      expect(http, `no HTTP config block found in ${name}.md`).toBeTruthy();
      expect(http).toMatch(/(Bearer|MEMENTO_TOKEN)/);
    });
  }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
npx vitest run tests/integrations/smoke.spec.ts
```

기대: Task 7-9에서 가이드를 작성했으므로 **이미 통과**할 가능성이 높다. 통과하면 그대로 OK. 만약 실패하면 가이드 본문에 누락된 블록을 추가하고 다시 실행.

- [ ] **Step 3: vitest 설정 확인**

```bash
grep -n "include" vitest.config.ts
```

`tests/integrations/`나 `tests/**/*.spec.ts`가 include 패턴에 들어있는지 확인. 안 되면 추가:

```typescript
test: {
  include: ['packages/**/*.spec.ts', 'tests/**/*.spec.ts'],
  // ...
}
```

- [ ] **Step 4: 전체 테스트 실행**

```bash
npm test
```

기대: 전체 PASS, 새 스모크 테스트 6개 (3 비서 × 2 케이스) 포함.

- [ ] **Step 5: 커밋**

```bash
git add tests/integrations/smoke.spec.ts vitest.config.ts
git commit -m "test(integrations): add L1 guide snippet smoke tests"
```

---

## Task 12: PR 생성 및 이슈 #100 정리

**Files:** (코드 변경 없음 — 외부 작업)

### 배경

지금까지의 모든 변경(Task 1-11)을 하나의 PR로 묶어 main에 병합 요청. 이슈 #100에 결정 노트 코멘트 + close.

- [ ] **Step 1: 브랜치 push 및 PR 생성**

```bash
git push -u origin docs/external-assistant-integration-design
gh pr create --title "docs+chore: external assistant integration v0.1 — L1 guides + memento-agent archive" --body "$(cat <<'EOF'
## Summary
- Phase 0: archive `packages/memento-agent/` (issue #100 superseded)
- Phase 1: external assistant integration guides under `docs/integrations/`
  - `_shared/` 공통 가이드 (transports, auth, system-prompt, troubleshooting)
  - per-assistant guides (openclaw, nanoclaw, zeroclaw)
  - root README linkage
  - L1 guide snippet smoke tests

Spec: `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`
Plan: `docs/superpowers/plans/2026-04-27-external-assistant-l1-guides.md`

## Test plan
- [ ] `npm test` 전체 통과
- [ ] `npm run docs:audit-links` 통과
- [ ] `npm run lint` / `npm run type-check` 통과
- [ ] OpenClaw / NanoClaw / ZeroClaw 가이드의 stdio 스니펫을 실제 비서 한 곳에서 시도 (수동 검증, 수용 기준)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: 이슈 #100 코멘트 + close**

```bash
gh issue comment 100 --body "$(cat <<'EOF'
방향 전환 결정. 자체 비서 빌드(memento-agent) 대신 **외부 비서 통합**(OpenClaw / NanoClaw / ZeroClaw)으로 전환합니다.

- 새 스펙: docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md
- L1 plan: docs/superpowers/plans/2026-04-27-external-assistant-l1-guides.md
- packages/memento-agent → packages/_archived/memento-agent-issue-100 (참고용 보존)

이 이슈를 close하고, 외부 통합 작업은 별도 PR/이슈로 트랙합니다.
EOF
)"
gh issue close 100
```

(주의: 이 단계는 외부 가시성 영향 — PR/이슈에 대한 사용자 권한 확인 후 진행)

---

## 완료 기준

- [ ] 모든 Task 1-12 완료
- [ ] PR이 main에 머지됨
- [ ] `docs/integrations/`에서 출발해 사용자가 자기 비서를 골라 5분 안에 stdio 트랙으로 memento에 연결 가능
- [ ] HTTP 트랙도 docs만 따라 구성 가능
- [ ] L1 스모크 테스트가 CI에서 통과

## 후속 (이 plan 범위 밖)

- Plan 2: `docs/superpowers/plans/2026-04-27-external-assistant-l3-sdk.md` (Phase 2 + Phase 3)
- v0.2: L2 (NanoClaw / ZeroClaw / OpenClaw 업스트림 PR)
