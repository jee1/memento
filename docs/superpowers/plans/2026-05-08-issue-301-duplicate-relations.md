# Issue #301 — Duplicate relation contract hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #301의 단기 수정(`updateOnConflict: true`)을 넘어, relation 계층 전반의 중복/순환 예외 처리를 **문자열 기반에서 타입 기반 계약**으로 전환해 회귀 가능성을 제거한다.

**Architecture:** `RelationGraph`가 도메인 예외 타입(`DuplicateRelationError`, `CyclicRelationError`)을 소유하고, 호출 계층(`SemanticMemoryUpdateService`, `AddRelationTool`)은 `instanceof`로 안정 분기한다. `SemanticMemoryUpdateService`는 중복 허용(upsert) 정책을 명시 유지하고, `AddRelationTool`은 중복 비허용 정책과 기존 응답 코드 계약을 유지한다.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing relation domain services/tools.

---

## Files

| File | Role |
|------|------|
| `packages/memento-core/src/domains/relation/services/relation-graph.ts` | typed error throw 경계, UNIQUE/동시성 처리 정리 |
| `packages/memento-core/src/domains/relation/services/relation-errors.ts` (new) | relation domain 에러 타입 정의 |
| `packages/memento-core/src/domains/memory/services/semantic-memory/semantic-memory-update-service.ts` | 문자열 기반 UNIQUE 분기 제거, typed flow 정리 |
| `packages/memento-core/src/domains/relation/tools/add-relation-tool.ts` | 문자열 기반 예외 분기 제거, `instanceof` 매핑 |
| `packages/memento-core/src/domains/relation/services/__tests__/relation-graph.spec.ts` | typed error 검증 케이스 보강 |
| `packages/memento-core/src/domains/memory/services/semantic-memory/__tests__/semantic-memory-update-service.spec.ts` | #301 재현/회귀 + 로그 회귀 방지 |
| `packages/memento-core/src/domains/relation/tools/__tests__/add-relation-tool.spec.ts` | duplicate/cyclic 매핑 회귀 검증 |

---

## Tasks

### Phase 1 — RelationGraph typed error 계약 도입
- [ ] `relation-errors.ts` 생성: `RelationGraphError`, `DuplicateRelationError`, `CyclicRelationError`
- [ ] `relation-graph.ts`에서 문자열 메시지 throw 경로를 typed error로 교체
- [ ] `handleRelationAddError`의 UNIQUE 경로에서 `updateOnConflict=false`이면 `DuplicateRelationError` 보장
- [ ] 기존 public behavior(성공/실패 의미)는 유지하고 메시지는 보조 정보로만 사용

### Phase 2 — 호출자 전환 (문자열 분기 제거)
- [ ] `semantic-memory-update-service.ts`의 `'UNIQUE constraint'` 문자열 분기 제거
- [ ] `createEpisodicEdge`에서 `updateOnConflict: true` 정책 명시 유지(양방향 관계 모두)
- [ ] `add-relation-tool.ts`의 `'이미 존재하는 관계'`/`'순환 참조'` 문자열 분기를 `instanceof`로 교체
- [ ] tool 응답 코드(`DUPLICATE_RELATION`, `CYCLIC_RELATION`)와 응답 구조는 그대로 유지

### Phase 3 — 테스트 보강 및 회귀 차단
- [ ] RelationGraph 테스트: duplicate(false) -> `DuplicateRelationError`, duplicate(true) -> upsert
- [ ] SemanticMemoryUpdateService 테스트: 동일 관계 재처리 시 error 로그 미발생 검증
- [ ] AddRelationTool 테스트: typed error 매핑 검증(duplicate/cyclic)
- [ ] 문자열 변경에 독립적인 테스트 어서션으로 정리(메시지 substring 의존 금지)

### Phase 4 — 검증 및 문서/메타 정리
- [ ] `npm test && npm run lint` 실행
- [ ] graphify 재빌드 실행  
  `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- [ ] 필요 시 `docs/_work/solutions/`에 교훈/회귀 방지 포인트 반영

---

## Risk & Mitigation

- **Risk:** 기존 문자열 의존 테스트가 다수 깨질 수 있음  
  **Mitigation:** typed error 도입 직후 테스트를 먼저 갱신하고, 메시지 어서션 최소화

- **Risk:** 호출부 일부 누락으로 계약 불일치가 잔존할 수 있음  
  **Mitigation:** `error.message.includes(` 패턴 전수 검색 후 relation/memory 핵심 경로 우선 정리

- **Risk:** 에러 타입 파일 위치/의존 방향 위반 가능성  
  **Mitigation:** relation domain 내부에 배치하고 상위 계층에서만 import

---

## Exit Criteria

- `relation`/`memory` 핵심 경로에서 문자열 기반 예외 분기 제거
- #301 시나리오 재현 시 duplicate relation 때문에 error 로그가 발생하지 않음
- 수동 add relation의 duplicate/cyclic 응답 계약 유지
- `npm test && npm run lint` 통과
- graphify 코드 그래프 재빌드 완료

## Verification

```bash
npm test && npm run lint
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```
