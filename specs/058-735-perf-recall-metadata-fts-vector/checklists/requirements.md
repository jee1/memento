# Requirements Checklist: Recall metadata wait removal & FTS·vector parallelism

**Purpose**: spec.md 요구사항이 구현 전에 테스트 가능하고 모호하지 않은지 확인
**Created**: 2026-08-12
**Feature**: [spec.md](../spec.md)

## Spec completeness

- [x] CHK001 Problem / goals / non-goals가 이슈 #735와 일치한다
- [x] CHK002 US1은 타이머 없이 meta_stats read-your-write를 독립 검증한다
- [x] CHK003 US2는 delayed-mock max-not-sum을 독립 검증한다
- [x] CHK004 US3은 ranking·score_breakdown 불변을 독립 검증한다
- [x] CHK005 새 cache/queue, ranking weight, provider 내부 병렬화가 Out of Scope다
- [x] CHK006 #736 scope-filter가 전제이고 재구현 대상이 아니다
- [x] CHK007 스키마 변경이 없다 (Constitution III)

## Acceptance mapping

- [x] CHK008 SC-001 ↔ 이슈 “timer advance 없이 현재 recall이 반환 meta stats에 반영”
- [x] CHK009 SC-002 ↔ 이슈 “setTimeout(..., 150) 제거”
- [x] CHK010 SC-003 ↔ 이슈 “hybrid 시간이 합이 아니라 최대 분기에 근접”
- [x] CHK011 SC-004 ↔ 이슈 “기존 ranking 결과·score breakdown 불변”
- [x] CHK012 SC-005 ↔ targeted tests, p95 비교, type-check, lint, graphify

## Notes

- 구현은 `tasks.md` T002부터. 이 체크리스트는 specify 단계 완료 표시다.
