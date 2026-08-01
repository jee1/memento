# Tasks: Epic #707 Anchor Map 이웃 복구

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)  
**Worktree root**: `~/git/memento-worktrees/`  
**#712**: 보류 — 작업 없음

---

## Phase 0 — Spec Kit
- [x] T000: `specs/056-707-anchor-map-neighbors/{spec,plan,tasks}.md` 작성

---

## Phase 1 — #708 (P0) · worktree `issue-708-relationgraph-wiring`

- [ ] T708-1: RED — bootstrap 후 `anchorSearchService`에 relationGraph가 주입됐는지 검증하는 테스트 작성
- [ ] T708-2: GREEN — `initializeServices`에서 `anchorSearchService` destructure + `setRelationGraph(relationGraph)` (+ hybrid 권장)
- [ ] T708-3: 관련 테스트 green · lint/type-check · commit · push · `gh pr create` (`Closes #708`, parent #707)
- [ ] T708-4: graphify 재빌드(코드 변경 시)

**Verify**: Slot A `searchLocal`이 `memory_link` 없이 relation 이웃 포함 (단위/통합)

---

## Phase 2 — #709 (P1) · worktree `issue-709-anchor-map-relation-links`

- [ ] T709-1: RED — node dedup + slot edge 분리 fixture 테스트 (A·B 동일 memory → node1 / edges2)
- [ ] T709-2: GREEN — `buildNetworkLinks`를 RelationGraph/`memory_relation` + confidence; hop≥2 path edge 미구현
- [ ] T709-3: commit · PR (`Closes #709`)

**Depends**: #708 권장 (통합 검증); 파일 독립이면 병행 PR 가능

---

## Phase 3 — #713 (P1.5) · worktree `issue-713-vec-cosine-metric`

- [ ] T713-1: RED — cosine similarity≈1 회귀 + clamp 정책 테스트
- [ ] T713-2: GREEN — schema/init-legacy/migrate + migration `041-vec-cosine-metric` + 전 vec table + triggers
- [ ] T713-3: cardinality `provider+dimensions+projection_type=native` 검증
- [ ] T713-4: commit · PR (`Closes #713`)

**Blocks**: #710

---

## Phase 4a — #710 (P2) · worktree `issue-710-semantic-embedding`

- [ ] T710-1: RED — semantic 생성 시 embedding row / remember 비차단
- [ ] T710-2: GREEN — fire-and-forget embedding + 제한 backfill (#713 계약)
- [ ] T710-3: commit · PR (`Closes #710`)

---

## Phase 4b — #711 (P2, #708 후 병렬) · worktree `issue-711-relation-extraction-persist`

- [ ] T711-1: RED — extract→row + 재실행 멱등 테스트
- [ ] T711-2: GREEN — `addRelationsBatch` + metadata + remember 비차단
- [ ] T711-3: commit · PR (`Closes #711`)

---

## Phase 5 — #714 · worktree `issue-714-auto-anchor-isolation`

- [ ] T714-1: RED — 고립(둘 다 0) vs 연결 후보 우선순위
- [ ] T714-2: GREEN — relation∧embedding 모두 0만 감점
- [ ] T714-3: commit · PR (`Closes #714`)

---

## Phase 6 — #715 · worktree `issue-715-hop-path-edges`

- [ ] T715-1: RED — 2-hop fixture에 실제 path edge 2개, `anchor→m2` 직결 없음
- [ ] T715-2: GREEN — n-hop provenance + map path edges
- [ ] T715-3: commit · PR (`Closes #715`)

---

## PR Checklist (each)
- [ ] 별도 worktree / branch
- [ ] Tests for changed behavior
- [ ] `npm run lint && npm run type-check` (+ 관련 `npm test -- …`)
- [ ] PR body: Summary + Test plan + `Closes #<n>` + `Parent: #707`
- [ ] graphify rebuild if code under packages/ changed
