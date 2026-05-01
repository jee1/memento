# Issue #215 Wave 2 — 거대 spec 분할 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `llm-client-initializer` 단위 spec과 `llm-provider-integration` 통합 spec을 하위 폴더·다중 `*.spec.ts`로 분할하고, 기존 단일 파일을 제거한 뒤 동일 54개 테스트가 통과하도록 한다.

**Architecture:** 공용 `*.test-setup.ts`에 `vi.hoisted` 모킹과 `getMockMementoConfig()`·환경 리셋을 둔다(호이스팅 export 제한 회피). 각 `*.spec.ts`는 setup을 먼저 import하고 `describe` 경계는 기존과 동일하게 유지한다. 통합 쪽은 `fetch`/`AbortSignal` 기본값 복원을 리셋에 포함해 파일 간 병렬 실행 시 오염을 막는다.

**Tech Stack:** Vitest 1.x, TypeScript, 기존 `vi.mock` 패턴.

---

## 파일 맵

| 구역 | 경로 |
|------|------|
| 단위 setup | `packages/memento-core/src/shared/services/__tests__/llm-client-initializer/llm-client-initializer.test-setup.ts` |
| 단위 분할 | `.../__tests__/llm-client-initializer/*.spec.ts` (10개) |
| 통합 setup | `.../__tests__/llm-provider-integration/llm-provider-integration.test-setup.ts` |
| 통합 분할 | `.../__tests__/llm-provider-integration/provider-*.spec.ts` (6개) |
| 제거 | `llm-client-initializer.spec.ts`, `llm-provider-integration.spec.ts` |

---

## Tasks

- [x] 단위: `test-setup` 경로(`../../../config` 등) 및 `getMockMementoConfig` 패턴 확정
- [x] 단위: `describe` 블록별 `*.spec.ts` 생성 및 fallback 4분할
- [x] 통합: `test-setup` + 6 파일 분할, logger 동적 import 경로 보정
- [x] 구형 단일 spec 삭제
- [ ] `npm run lint` / `npm run type-check` / `npm test` 통과 확인
- [ ] PR: `Closes #215`, `Related #180`

