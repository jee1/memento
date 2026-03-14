# 이슈 #20 — 구현 계획 (Plan)

SDD **Plan** 단계 산출물. [spec.md](./spec.md)를 기준으로 구현 순서·태스크·검증을 정리한다.

---

## 0. Memory Bank (Plan 기초 문서)

구현·태스크 수행 시 아래 문서를 우선 참조한다.

| 문서 | 용도 |
|------|------|
| [structure.md](./structure.md) | 아키텍처·컴포넌트 관계·코드 위치. |
| [tech.md](./tech.md) | 스키마·기술 스택·제약. |
| [product.md](./product.md) | 비즈니스 맥락·기존 기능 연관. |

아키텍처·기술·제품 관점 변경 시 해당 Memory Bank 문서를 먼저 갱신한 뒤, 본 구현 계획을 수정한다.

---

## 1. 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 중복 제거 및 기억 압축 (반복 보존 정책) |
| **문서 유형** | PLAN (구현 계획) |
| **기준 명세** | [spec.md](./spec.md) |
| **작업 분해** | [tasks.md](./tasks.md) |
| **관련 이슈** | [#20](https://github.com/jee1/memento/issues/20) |

---

## 2. 개요

- **목표**: 유사 기억 병합 시 반복 정보(num_times, last_mentioned_at)를 보존하고, recall 시 해당 메타를 활용해 랭킹 품질을 높인다.
- **구현 위치**: `packages/memento-core` 내, 기존 워커·검색 엔진 확장. [structure.md](./structure.md) 참조.
- **의존성**: #88 Fact 메타데이터(num_times, last_mentioned_at) 반영 후 본 기능 활성화. #89·#90과 통합 시 병합 단계에 “메타 갱신” 포함.

---

## 3. Phase·Task 요약

| Phase | 목표 | Task |
|-------|------|------|
| **Phase 1** | 전제·의존 확인 | T1: #88 스키마·의존 확인 |
| **Phase 2** | 반복 메타 갱신 로직 | T2: 병합 시 num_times·last_mentioned_at 갱신 로직 |
| **Phase 3** | 파이프라인 통합 | T4: #89/#90 워커·파이프라인 통합 |
| **Phase 4** | 회수 품질 검증 | T5: recall 랭킹에서 num_times·last_mentioned_at 반영 검증 |
| **Phase 5** | 선택·정리 | T3: (선택) 병합 대상 원본 보존, T6: 문서화 및 AC 체크 |

상세 작업 단위는 [tasks.md](./tasks.md) 참조.

### T4 연동 안내 (워커·파이프라인)

- **이미 반영된 경로**
  - **SemanticMemoryUpdateService** (유사 triple 병합): `updateExistingSemanticMemory`에서 병합 시 `num_times = COALESCE(num_times, 1) + 1`, `last_mentioned_at = ?` 갱신. (Issue #20 반영 완료.)
  - **SemanticMemoryUpdateService** (kg_triple 대표 재사용): 동일 (s,p,o) 대표 항목에 `num_times = num_times + 1`, `last_mentioned_at = ?` 갱신. (기존 구현 유지.)
- **배치 병합 시 호출**
  - #89 비동기 Augmentation 워커 또는 #90 dedupe 파이프라인에서 **유사 기억 N건을 대표 1건으로 병합**하는 단계가 있으면, 병합 실행 후 `updateRepresentativeRepetitionMeta(db, representativeId, mergedIds)`를 호출한다.
  - 구현 위치: `packages/memento-core/src/domains/memory/services/repetition-meta-update-service.ts`. `mergedIds`는 대표를 제외한 병합 대상 ID 목록.

---

## 4. 보안·컨벤션

- **트랜잭션**: 병합(대표 UPDATE + 병합 대상 처리)은 원자적. 롤백 시 일관성 유지.
- **코드 스타일**: AGENTS.md·기존 memento-core 컨벤션 준수. kebab-case 파일명, camelCase 함수.
- **의존성**: #88 미반영 시 num_times·last_mentioned_at 접근 시 조건부 분기 또는 no-op으로 안전 처리.

---

## 5. 검증 (Implement: 조기 테스트 설계)

### 5.1 단위 테스트

- **T2 (메타 갱신)**  
  - **동등 분할**: 대표 1건 + 병합 대상 0건 / 1건 / N건(2 이상).  
  - **경계값**: num_times = 0 → 1, N = 1(병합 없음), N = 2, N = 큰 값(상한 또는 한도).  
  - **기대**: 대표의 num_times = 기존 + (N-1) 또는 N, last_mentioned_at = max(created_at 또는 last_accessed).

- **T5 (랭킹)**  
  - **동등 분할**: 동일 쿼리·동일 유사도 구간에서 num_times만 다른 두 항목.  
  - **기대**: num_times가 큰 항목이 더 높은 최종 점수 또는 순위.

### 5.2 통합·E2E

- **T4 통합**: #89 또는 #90 워커 실행 후, 병합된 대표 항목에 num_times·last_mentioned_at이 갱신되어 있는지 DB 조회로 확인.
- **AC 검증**: [spec.md](./spec.md) §5 수용 기준(AC1–AC5)을 테스트 또는 수동 시나리오로 충족.

### 5.3 완료 판단

- [spec.md](./spec.md)의 **AC1–AC5**가 모두 충족되고, [tasks.md](./tasks.md)의 Task가 완료되면 구현 완료로 판단한다.

### 5.4 수용 기준 체크 (Issue #20 구현 후)

| AC | 내용 | 구현 반영 |
|----|------|------------|
| AC1 | 병합 후 대표 항목 num_times 갱신 | SemanticMemoryUpdateService 병합 경로 + updateRepresentativeRepetitionMeta |
| AC2 | 병합 후 대표 항목 last_mentioned_at 갱신 | 동일 |
| AC3 | recall 시 num_times 큰 항목이 더 높은 순위 | search-engine Fact 메타 가중 및 기존 테스트(search-engine-reflection-notes.spec.ts) |
| AC4 | #89/#90 파이프라인에 “병합 시 메타 갱신” 명시 | 본 문서 §3 T4 연동 안내, repetition-meta-update-service.ts |
| AC5 | (선택) 병합된 원본 ID 조회 | T3 선택으로 보류 |

---

## 6. 참조

- **명세**: [spec.md](./spec.md)
- **설계**: [design.md](./design.md)
- **원자 작업**: [tasks.md](./tasks.md)
- **요구사항**: [requirements.md](./requirements.md)
- **논의 요약**: [2026-03-14-issue-20-memory-vs-storage-discussion.md](../2026-03-14-issue-20-memory-vs-storage-discussion.md)
- **SDD 가이드**: [docs/guides/ko/sdd-workflow.md](../../guides/ko/sdd-workflow.md)

---

*이 계획은 SDD의 Task → Implement 단계에서 태스크 단위로 실행할 때 기준으로 사용한다. Implement 시 AI 생성·인간 검증을 수행하고, 위 §5 조기 테스트 설계(동등 분할, 경계값 분석)를 활용한다.*
