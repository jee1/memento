# KnowledgeCandidateExtractor (#234) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `userMessage`에서 규칙 기반으로 `preference` / `decision` / `learning` / `procedure` 후보를 추출하고 `PersonalKnowledgeAgentService` 한 턴에 연결한다.

**Architecture:** `extractors/knowledge-candidate-extractor.ts`의 순수 함수 `extractKnowledgeCandidates`가 후보 배열을 반환한다. `KnowledgeCandidate` 타입은 `category`, `reason`, `confidence`, `suggestedMemoryType`(working 제외) 등 이슈 스키마를 따른다. 서비스는 `buildContext` 직후 추출 → `llm.complete` → `proposeCandidates` 순서를 유지한다.

**Tech Stack:** TypeScript 5.x, Vitest, `@memento/core` 워크스페이스.

**Spec:** `docs/superpowers/specs/2026-05-13-issue-234-knowledge-candidate-extractor-design.md`

---

## File map

| File | 역할 |
|------|------|
| `packages/memento-core/src/domains/personal-agent/types/agent-types.ts` | `KnowledgeCandidate`, `KnowledgeCandidateCategory`, `SuggestedPersonalMemoryType` |
| `packages/memento-core/src/domains/personal-agent/extractors/knowledge-candidate-extractor.ts` | `extractKnowledgeCandidates` 규칙 |
| `packages/memento-core/src/domains/personal-agent/extractors/knowledge-candidate-extractor.spec.ts` | 카테고리별 ± 테스트 |
| `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts` | 추출 호출 및 순서 |
| `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts` | 통합: `proposeCandidates` 인자 검증 |
| `packages/memento-core/src/domains/personal-agent/index.ts` | public export |

---

## Verification (구현 완료 후 항상 실행)

```bash
cd /path/to/worktree
npm run type-check -w @memento/core
npx vitest run packages/memento-core/src/domains/personal-agent/
```

예상: type-check exit 0, Vitest 25 tests passed (extractor + service + mock llm adapter).

---

## Spec coverage (self-review)

| 스펙 요구 | 구현 위치 |
|-----------|-----------|
| 4 카테고리 | `extractKnowledgeCandidates` 분기 + spec describe 블록 |
| reason/confidence 필수 | 모든 push 경로에서 설정 |
| suggestedMemoryType, working 제외 | `SuggestedPersonalMemoryType` + 매핑 상수 |
| userMessage만 | 함수 인자 단일, 서비스에서 `input.userMessage`만 전달 |
| 모호(끝 `?`) 제외 | `ambiguous` 플래그로 preference/decision 스킵 |
| Agent Loop 통합 | `personal-knowledge-agent-service.spec.ts` 선호 문장 케이스 |

---

## 실행 옵션 (스킬 훅)

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-issue-234-knowledge-candidate-extractor.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트, 태스크 간 리뷰  
2. **Inline Execution** — `executing-plans`로 동일 세션 배치 실행

본 워크트리에서는 위 검증 명령까지 구현이 반영되어 있다.
