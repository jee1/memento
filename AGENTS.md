# Memento Agent Guidelines (Master Guide)

에이전트 가이드 **진입점**입니다. 상세는 [docs/agents/](./docs/agents/README.md)에 분리되어 있으며, **Karpathy 코딩 행동 지침(§4)은 이 파일에 유지**합니다. `CLAUDE.md`·`GEMINI.md`는 여기를 가리킵니다.

| 문서 | 내용 |
|------|------|
| [architecture.md](./docs/agents/architecture.md) | 패키지·도메인 |
| [commands.md](./docs/agents/commands.md) | 명령·환경·Docker (배포 전 `db:pre-docker-deploy`) |
| [agent-workflow.md](./docs/agents/agent-workflow.md) | MCP·graphify·UI·복리 |
| [search-ranking.md](./docs/agents/search-ranking.md) | 랭킹 공식 |
| [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) | 코딩 표준 |

## 1. 프로젝트 개요

Memento는 AI 에이전트용 MCP 메모리 서버입니다.
- **메모리**: Working (48h), Episodic (90d), Semantic/Procedural (∞)
- **스택**: Node.js ≥24, TypeScript, SQLite, Vitest
- **기능**: 하이브리드 검색(FTS5+Vector), 망각 정책, 다중 임베딩

## 2. 빠른 시작

```bash
npm install && npm run build && npm test
npm run dev          # MCP
npm run dev:http     # HTTP 관리
npm run lint && npm run type-check  # 커밋 전 필수
```

전체 명령·환경: [commands.md](./docs/agents/commands.md) · 구조: [architecture.md](./docs/agents/architecture.md)

## 3. 에이전트 필수 습관

- 작업 전 `recall`/`memory_injection`, 후 `remember`
- 아키텍처 질문 전 `graphify-out/GRAPH_REPORT.md` 확인; 코드 수정 후 graphify 재빌드
- 커밋 전 `lint`, `type-check`, `test`

상세: [agent-workflow.md](./docs/agents/agent-workflow.md)

## 4. 코딩 에이전트 행동 지침 (Karpathy Guidelines)

> 출처: [andrej-karpathy-skills/CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md)

**트레이드오프:** 속도보다 신중함 우선. 사소한 작업은 유연 적용.

### 4.1 구현 전에 생각하기 (Think Before Coding)

**가정하지 말 것. 혼란을 숨기지 말 것. 트레이드오프를 드러낼 것.**

- 가정을 명시한다. 불확실하면 질문한다.
- 해석이 여러 가지면 제시한다.
- 더 단순한 접근이 있으면 말한다.
- 불명확하면 멈추고 질문한다.

### 4.2 단순함 우선 (Simplicity First)

**최소 코드만. 추측성 코드 금지.**

- 요청 범위 초과·단일용 추상화·미요청 설정성·불가능 시나리오 에러 처리 금지
- 200줄이 50줄이 될 수 있으면 다시 쓴다

### 4.3 수술적 변경 (Surgical Changes)

**꼭 필요한 것만 수정. 자신이 만든 unused만 정리.**

- 인접 코드·포맷 "개선", 무관 리팩터, 기존 dead code 삭제 금지
- 변경 줄은 사용자 요청에 직접 연결되어야 한다

### 4.4 목표 기반 실행 (Goal-Driven Execution)

**성공 기준을 정의하고 검증될 때까지 반복.**

- "검증 추가" → 잘못된 입력 테스트 작성 후 통과
- "버그 수정" → 재현 테스트 후 통과
- 다단계 작업은 `단계 → 검증 방법` 계획을 먼저 제시

**잘 작동하면:** diff 노이즈·과도한 재작성이 줄고, 구현 전에 질문이 나온다.
