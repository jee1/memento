# Issue 766 Design: `memento-mcp` bin 별칭 이름 충돌 해소

## 1) Context and Goal

### Problem
`package.json` / `packages/memento-server/package.json`의 `bin`에 `memento-mcp` 별칭이 있다.  
동일 CLI 이름 `memento-mcp`를 쓰는 `gannonh/memento-mcp`(Neo4j knowledge graph memory)가 mcpservers.org·Glama·Lobehub·mcp.so·awesome-mcp-servers에 선점되어 있다.

결과:
- 검색·레지스트리에서 우리 프로젝트가 묻힌다
- 두 서버를 함께 쓰는 사용자에게 PATH/CLI 충돌
- Epic #770의 MCP 레지스트리 등재(#763) 선행 조건

### Goal
브랜드·CLI 이름을 충돌 없이 확정한다. 정식 CLI는 `memento-mcp-server`만 남긴다.

### Decisions (maintainer-approved)
| 항목 | 결정 |
|---|---|
| 제거 타이밍 | **즉시 하드 삭제** (soft-deprecation 없음) |
| 정식 CLI 이름 | **`memento-mcp-server`만** (새 이름 도입 없음) |
| 접근 | Approach 1 — bin 삭제 + CHANGELOG Breaking + 현행 문서 정리 |

## 2) Scope and Architecture Boundary

### In-scope
- root `package.json` `bin.memento-mcp` 제거
- `packages/memento-server/package.json` `bin.memento-mcp` 제거
- `package-lock.json` bin 항목 동기화
- CHANGELOG Breaking 안내 (마이그레이션: `memento-mcp` → `memento-mcp-server`)
- 현행 사용자/기여자 문서에서 “또는 `memento-mcp`” 병기 제거
  - 확인된 대상: `docs/reference/ko/memento-repository-current-state-report.md`
  - README / INSTALL / `install.sh` / assistant 기본값은 이미 `memento-mcp-server` — 회귀 확인만

### Out-of-scope
- npm 패키지명 변경 (`memento-mcp-server` 유지)
- 로고·비주얼 아이덴티티
- `memento-mcp.lock` 파일명 변경 (instance lock 경로; CLI bin과 무관)
- `docs/_work/**`, 역사 plans/specs 아카이브 전면 rewrite
- MCP 레지스트리 `server.json` 등재 자체 (#763)

## 3) Approach Options and Selection

### Option 1: Hard delete + Breaking CHANGELOG + 현행 docs (**Selected**)
- Pros: 최소 diff, #763 즉시 가능, 공식 경로와 일치
- Cons: 구버전 global install의 `memento-mcp` PATH는 로컬에 남을 수 있음 (재설치/재링크 시 해소)

### Option 2: Delete + runtime one-shot message
- Pros: 실수 실행 시 안내 가능처럼 보임
- Cons: bin이 없으면 메시지에 도달 불가 → 실효 없음

### Option 3: Delete + lockfile/archive rename sweep
- Pros: 문자열 일관성
- Cons: 이슈 비범위, 데이터 경로 리스크, 과한 범위

## 4) Component Design

### C1. Package bin surface
- Remove `"memento-mcp"` from both package `bin` maps.
- Keep: `memento-mcp-server`, `memento-dev`, `memento-setup` (root); server package bins unchanged except alias removal.
- After edit, ensure lockfile `bin` mirrors package.json (npm install / lock refresh as needed).

### C2. Deprecation path (documentation only)
- No shim binary, no stderr warning stub.
- CHANGELOG entry under Breaking (or equivalent Unreleased section):
  - What removed: CLI alias `memento-mcp`
  - Replacement: `memento-mcp-server` (same entrypoint)
  - Why: name collision with unrelated `gannonh/memento-mcp`
  - Action: update MCP client configs / scripts that invoke `memento-mcp`

### C3. Doc consistency
- Patch current-state report (and any other **current** guide that still lists both bins).
- Do not rewrite historical design/plan archives under `docs/_work` or dated `docs/superpowers/plans`.

### C4. Verification
- Grep: no `"memento-mcp":` under package `bin` in package.json files
- Confirm README / INSTALL / smoke tests still reference `memento-mcp-server`
- `npm run type-check` (and targeted smoke if docs/config blocks are touched)

## 5) Testing and Acceptance

### Acceptance criteria (maps to #766)
- [ ] `memento-mcp` bin alias removed from published package surfaces
- [ ] Canonical CLI name documented as `memento-mcp-server` only
- [ ] CHANGELOG documents removal + migration for existing users
- [ ] Current docs do not advertise `memento-mcp` as an alternate CLI
- [ ] Ready as prerequisite for #763 registry listing

### Non-goals for tests
- No new unit test required solely for package.json bin map (declarative config).
- Existing smoke that asserts `memento-mcp-server` in stdio configs remains green.

## 6) Rollout / PR
- Branch: `jee1/chore-brand-memento-mcp-bin` (or equivalent)
- PR: `Fixes #766`, link Epic #770
- No production TS runtime change expected → graphify rebuild not required unless code files change

## 7) Risks
| Risk | Mitigation |
|---|---|
| External blogs/configs still say `memento-mcp` | CHANGELOG + issue note; we do not control third-party docs |
| Confusion with `memento-mcp.lock` | Explicit out-of-scope; leave lock basename unchanged |
| Users with both packages installed | Removing our alias reduces PATH collision going forward |
