# Memento 기반 OpenClaw 유사 개인 비서 리서치 — 기능·MVP 범위

**작성일**: 2026-03-02  
**목적**: Memento를 기반으로 OpenClaw와 유사한 개인 비서(에이전트)를 만들 때 필요한 기능 정리 및 MVP 범위 제안.

---

## Executive Summary

OpenClaw는 로컬·다채널·24/7 자율·지속 메모리를 갖춘 개인 AI 비서로, Gateway·Skills·Channels 3계층과 “context vs memory” 구분으로 동작한다. Mem0·Rewind 등은 메모리 레이어·프라이버시에 초점을 둔 대안이다. **Memento**는 이미 recall, remember, memory_injection, search_local, anchor 등 MCP 메모리 도구를 제공하므로, “메모리 백엔드”는 갖춰진 상태다. **MVP**는 단일 채널(CLI 또는 Web) + Memento 연동(질의 전 recall/memory_injection, 응답 후 remember) + 필요 시 anchor/search_local로 작업 스코프 검색에 집중하고, 다채널·24/7 백그라운드·대량 스킬·음성은 제외하는 것이 합리적이다.

---

## Key Findings

- **OpenClaw**: 로컬·다채널(WhatsApp, Telegram, Slack 등), 24/7 자율, 지속 메모리·컨텍스트, 5,700+ 스킬, Gateway 제어면·Pi 에이전트 [1][2].
- **Mem0**: 범용 메모리 레이어, 세션 간 선호·컨텍스트 유지, 토큰/지연 감소, AI 컴패니언용 [3][4].
- **Rewind**: 프라이버시 우선, 로컬 캡처(화면·음성), 회의 요약·백업·AI 보조 [5].
- **Memento**: MCP 기반 recall / remember / memory_injection / search_local / anchor 등으로 “작업 전 검색·작업 후 저장” 플로우에 적합 [6][7].
- **MVP 권장**: 캡처→정리, 요약→결정, 60–120초 내 첫 유용한 결과; 음성·전체 캘린더 쓰기·자율 다단계 행동은 MVP 제외 [8][9].

---

## Detailed Analysis

### 1. OpenClaw

**역할**: 사용자 기기에서 동작하는 개인 AI 비서. “어디서나 대화”를 위해 여러 채널을 지원하고, 지속 메모리와 24/7 자율 작업을 제공한다.

**아키텍처** [1][2]:

- **Data layer**: 세션, 미디어, 설정, 로깅/감사
- **Capability layer**: 도구(Tools), 프로바이더(모델 + failover)
- **Execution plane**: 에이전트(run/attempt 생명주기, lane/queue 동시성, 스트리밍)
- **Control plane**: Gateway(세션·동시성·인증·WebSocket/HTTP API·채널/프로바이더 관리)
- **Ingress**: 채널(WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Teams, WebChat 등) 및 자동화 진입점

**메모리·컨텍스트**:

- **Context vs Memory 구분**: 컨텍스트 관리와 메모리는 별도로 다룸. 에이전트 루프는 Pi 프레임워크로 컨텍스트·도구 호출을 처리하고, OpenClaw는 오케스트레이션·라우팅·영속성 계층을 담당 [2].
- **스킬·메모리 형태**: 스킬은 마크다운으로, 에이전트가 대화 중에 능력을 작성·배포할 수 있음. 메모리도 human-readable [2].
- **입력으로서의 시간·상태**: 메시지 외에 heartbeat(기본 30분), cron, webhook, 에이전트 간 메시지로 능동 동작 [2].

**기능 요약**:


| 영역  | 내용                                             |
| --- | ---------------------------------------------- |
| 채널  | 다채널(메신저·WebChat), 페어링·허용 목록 기반 접근 제어           |
| 메모리 | 선호·노트·바이오마커(예: WHOOP) 등 지속·연속 컨텍스트             |
| 자율성 | 백그라운드·cron·webhook·앱 모니터링·PR 생성 등              |
| 모델  | Claude, GPT, Gemini, DeepSeek 등 다중 모델·failover |
| 스킬  | ClawHub 등 5,700+ 스킬(웹, 이메일, 파일, 스마트홈, 코딩 등)    |


---

### 2. Mem0·Rewind (유사 서비스)

**Mem0** [3][4]:

- AI 앱용 “메모리 레이어”. 세션 간 사용자 선호·컨텍스트 유지.
- 토큰 비용·지연 감소(예: 90% 토큰 절감, 91% 지연 감소 등 벤치마크 제시).
- 사용자·AI 페르소나 모두에 대한 지속 메모리, 자기 개선형 선호 반영.
- 벤치마크에서 OpenAI 메모리 대비 26% 정확도 향상 주장.

**Rewind** [5]:

- “본·말한·들은 것” 기반 프라이버시 우선 개인 비서.
- 화면·오디오 로컬 캡처, Zoom/Meet/Teams 회의 녹음·요약, 백업·복구.
- 연구 요약·이메일 초안·정보 검색 등 AI 보조.
- 데이터는 기기 로컬, 클라우드 업로드 불필요 옵션.

**시사점**: 개인 비서의 가치가 “지속 기억 + 빠른/저비용 컨텍스트”에 있음. Memento는 이미 MCP로 이 역할을 할 수 있는 도구 세트를 제공한다.

---

### 3. Memento의 역할 (이 저장소)

**제공 도구** (MCP) [6][7]:

- **recall**: 하이브리드 검색, 타입/태그/시간 등 필터.
- **remember**: 기억 저장, type(episodic/semantic/procedural 등)·tags·importance.
- **memory_injection**: 쿼리 기반으로 상위 K개 기억을 컨텍스트로 주입.
- **search_local**: 앵커가 설정된 경우 앵커 주변 기억 검색.
- **set_anchor / clear_anchor / get_anchor**: 현재 작업 스코프(앵커) 설정·해제·조회.
- **pin / unpin / forget**: 고정·삭제(소프트/하드).
- **remember_procedure / procedural_rollback / procedural_diff**: 절차 기억 버전 관리.
- **get_memory_neighbors**: 관계·이웃 기억 조회.

**목표** (Memento Goals) [7]:

- 에이전트가 대화/작업 맥락을 잃지 않도록, 작업기억·일화·의미·절차 기억을 모사한 스토리지+검색+요약+망각.
- 검색 스코어: relevance + recency + importance + usage - duplication_penalty.
- 망각·간격반복·“수면 통합”(episodic → semantic) 등 정책 지원.

**정리**: OpenClaw는 “메모리를 어떻게 쓸지”를 마크다운·컨텍스트로 유연하게 두고, Memento는 **타입·스코어·망각·앵커**까지 포함한 구조화된 메모리 레이어를 제공한다. 개인 비서의 “기억 백본”으로 Memento를 쓰면, 검색 품질·스코프·정책을 한 곳에서 관리할 수 있다.

---

### 4. 필요한 기능 vs MVP 제안

#### 4.1 전체 기능(장기 목표) 요약


| 영역       | 기능 예시                                                                |
| -------- | -------------------------------------------------------------------- |
| 진입점      | 다채널(메신저, WebChat), CLI, API                                          |
| 메모리      | Memento 연동(recall, remember, memory_injection, search_local, anchor) |
| 에이전트 루프  | 사용자 메시지 → recall/memory_injection → LLM → remember, feedback         |
| 스킬       | 할일 추출, 일정 요약, 메모 검색, 이메일/캘린더 읽기·쓰기 등                                 |
| 자율성      | 24/7 백그라운드, cron, webhook, 모니터링·알림                                   |
| 보안·프라이버시 | 로컬/선택적 클라우드, 페어링·허용 목록, 감사 로그                                        |


#### 4.2 MVP로 넣을 것

1. **단일 진입 채널**
  - CLI 또는 Web 채널 하나. (예: `openclaw agent --message "..."` 같은 CLI 또는 단일 WebChat UI.)
2. **Memento 연동**
  - 질의 전: `recall` 또는 `memory_injection`으로 관련 기억 로드.
  - 응답 후: `remember`로 결과·선호·결정 저장(type·tags 권장).
  - 필요 시: `set_anchor` + `search_local`로 “지금 작업 중인 주제” 스코프 검색.
3. **에이전트 플로우**
  - 사용자 메시지 → (선택) anchor 설정 → recall/memory_injection → LLM 생성 → remember.
  - “자유 대화 + 기억 기반 답변”만으로도 MVP 가치 검증 가능.
4. **검증 지표**
  - 시간 대비 첫 유용한 답변(60–120초 권장 [8][9]).
  - 기억 활용 정확도(recall 결과가 답변에 반영되는지).
  - 재방문/재사용율.

#### 4.3 MVP에서 제외할 것

- 다채널(WhatsApp, Telegram 등): 단일 채널로 먼저 검증.
- 24/7 백그라운드·cron·webhook: 수동/온디맨드 대화만.
- 대량 스킬·스킬 마켓: 스킬 0~1개 또는 “기억 기반 대화”만.
- 음성 입출력, 전체 캘린더 쓰기, 자율 다단계 행동 [8][9].

---

## Areas of Consensus

- 개인 비서의 핵심 가치: **지속 메모리**와 **컨텍스트 인식** [1][3][4][5].
- MVP는 **캡처→정리**, **요약→결정**, **짧은 시간 내 유용한 결과**에 집중하는 것이 합리적 [8][9].
- 메모리 레이어는 별도로 두고(OpenClaw의 context vs memory, Memento의 타입·스코어·앵커) 에이전트 루프와 결합하는 구조가 반복적으로 등장함 [1][2][7].

---

## Areas of Debate

- **메모리 형태**: OpenClaw식 human-readable 마크다운 vs Memento식 타입·태그·스코어 구조. MVP에서는 Memento 구조를 그대로 쓰고, 필요 시 요약/내보내기를 마크다운으로 제공하는 절충이 가능.
- **채널 전략**: 단일 채널로 검증 후 확장 vs 처음부터 Gateway·다채널 설계. 리소스와 검증 목적에 따라 선택.
- **자율성 시점**: MVP 이후 얼마나 빨리 cron/webhook을 넣을지는 사용 시나리오(리마인더, 모니터링 등)에 따라 결정.

---

## Sources

[1] OpenClaw — Personal AI Assistant. [https://www.opensclaw.com/](https://www.opensclaw.com/) ; OpenClaw GitHub. [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) (README, 구조).

[2] OpenClaw Architecture (Gateway, Channels, Skills, Memory, Context). System architecture – OpenClaw; Gateway Architecture – OpenClaw; Lessons from OpenClaw's Architecture for Agent Builders - DEV Community; docs.openclaw.ai/concepts/architecture.

[3] Mem0 - The Memory Layer for your AI Apps. [https://mem0.ai/](https://mem0.ai/)

[4] Making AI Companions Truly Personal; AI Memory Layer Guide. [https://mem0.ai/blog/](https://mem0.ai/blog/)

[5] Rewind. [https://rewindai.org/](https://rewindai.org/)

[6] Memento MCP serverUseInstructions. docs/guides/ko/mcp-server-instructions.md. 작업 전 recall/memory_injection, 작업 후 remember, 타입·태그 권장.

[7] Memento Goals, MCP 인터페이스, 에이전트 플로우, MVP 스펙. docs/reference/ko/Memento-Goals.md.

[8] How We Built an AI Assistant MVP in 3 Days. [https://spd.tech/artificial-intelligence/ai-assistant-mvp/](https://spd.tech/artificial-intelligence/ai-assistant-mvp/)

[9] Technical Blueprint for a Privacy-First AI Assistant MVP; Build a Personal Assistant App with Vibe Coding and LLMs. 캡처→정리, 요약→결정, 60–120초, MVP 제외 항목(음성, 전체 캘린더 쓰기, 자율 다단계).

---

## Gaps and Further Research

- Memento와 OpenClaw를 **같은 프로젝트에서** 연동한 사례(예: OpenClaw 스킬로 Memento MCP 호출)가 있는지 확인.
- **anchor/search_local**을 개인 비서 플로우에 넣었을 때 체감 품질·성능 측정.
- MVP 이후 **Phase 2** 기능 우선순위: 할일/일정 스킬 vs 다채널 vs 24/7 자율 중 어떤 것부터 할지 시나리오 기반 결정.

---

## 정리: 논의용 체크리스트

- MVP 진입점: CLI 우선 vs WebChat 우선?
- Memento 서버: 기존 인스턴스 재사용 vs 전용 인스턴스?
- LLM: 단일 모델 고정 vs failover/다중 모델(OpenClaw 스타일)?
- 첫 스킬: “기억 기반 대화”만 vs 할일 추출/일정 요약 중 1개 포함?
- 검증 기간·지표(첫 유용한 답변 시간, 기억 활용도, 재방문율) 합의.

