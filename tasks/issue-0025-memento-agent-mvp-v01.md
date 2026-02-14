## 개요

**Memento Agent**(Actionable Memory Assistant) MVP v0.1 구현을 위한 마스터 이슈입니다.

- **한 줄 정의**: 기억을 기반으로 행동하는 AI 비서
- **PRD**: [tasks/0025-prd-actionable-memory-assistant-mvp-v01.md](tasks/0025-prd-actionable-memory-assistant-mvp-v01.md)

## 범위 (v0.1)

- **Actionable Memory Loop**: memory_injection → Intent(룰 기반) → LLM → remember, owner_id/sessionId 지원
- **One Killer Tool**: `search_web_with_memory` (Personalized Web Search), SearchProvider 추상화(API 또는 Playwright)
- **Transparency UX**: 응답 meta(usedMemories, executedTools, intent), CLI Inspector
- **LLM Provider**: OpenAI / Gemini / Ollama, LLMProvider 추상화
- **Agent UI**: CLI (WebChat 등은 v0.1 이후)
- **설치·의존성**: Memento 선행 설치·기동, `MEMENTO_BASE_URL` 설정, docker-compose 또는 로컬 실행

## 아키텍처 원칙

- Memento Core = Memory Server (루트 `src/`), Agent = `services/agent/`
- Agent는 Core를 **import 금지**, HTTP/MCP 호출만
- 모노레포 + 런타임 분리(docker compose 등)

## 구현 단계 (PRD §12 기준)

- [ ] **Phase 1 — Skeleton**: services/agent 폴더, CLI 진입점, 설치·Memento 의존성 문서화, docker-compose, mementoClient
- [ ] **Phase 2 — Core Loop**: inject + chat loop, Intent 룰, LLM Provider 연동, remember, POST /chat
- [ ] **Phase 3 — Killer Tool**: SearchProvider, search_web_with_memory, Tool Registry 등록
- [ ] **Phase 4 — Transparency**: meta 구조화, 로깅, Memory Inspector(CLI)

## Team Feature (파일 소유권·순서)

상세 분해 및 파일 소유권은 **[0025-feature-plan-team-feature.md](0025-feature-plan-team-feature.md)** 참고.

- **P1** Skeleton → **P2** Memento Client, **P3** CLI+Server (병렬 가능) → **P4** Core Loop → **P5** Tool+Registry → **P6** Transparency
- 승인 후 위 계획서 순서대로 순차/병렬 구현 가능.

## 참고

- PRD §16 Next Steps: Memento 기동 확인 → Core API 매핑 → Agent Skeleton → docker-compose E2E
- 언어: TypeScript (Memento와 동일)
