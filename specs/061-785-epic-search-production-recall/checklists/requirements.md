# Specification Quality Checklist: Epic #785 production recall

**Purpose**: Validate spec completeness before implementation
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation leakage in spec (file paths belong in plan)
- [x] Focused on user value: candidate recall, ranking contracts, injection parity
- [x] Non-goals explicit (new embedding, corpus hard-code, official QA score, migration, weight tuning before P0)
- [x] Child issues #786–#790 mapped 1:1 to user stories

## Requirement Completeness

- [x] FR cover epic completion criteria (funnel, FTS/BM25, fusion, vector policy, injection, gate)
- [x] Edge cases: zero-hit, SQL vs engine split, vector-empty, empty query, concurrent bench, missing LoCoMo corpus
- [x] Success criteria measurable (Recall@10, zero-hit, p95, tests, hashes)
- [x] Related prior art (#737/#767/#783, specs/057) acknowledged
- [x] Order constraint: no global weight tuning before FTS/fusion restore
- [x] LoCoMo license: synthetic CI fixtures only

## Open for reviewer

- [ ] Q4 default (`memento_prod` 키 유지 + `production_path` 명시) 확인
- [ ] SC-006 gate를 엔진 primitive에 적용할지, injection 전략에 적용할지, 둘 다인지 확인 — spec 기본은 **동일 fixture에서 제안 gate 평가**, injection 전략이 사용자 대면 기준
- [ ] Ablation 결정(Q1–Q3)은 구현 중 기록으로 충분한지 확인
