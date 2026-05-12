# Issue #360 Doc Audit — docs 포털 메타·DESIGN·Cursor 규칙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/README.md`와 `docs/docs-classification.md`에서 누락된 `docs/integrations/`·`docs/adr/` 항목을 추가하고, 나머지 3개 파일(DESIGN.md, blog/README.md, .cursor/rules/specify-rules.mdc)의 정합성을 확인한 뒤 `docs:audit-links`를 통과시킨다.

**Architecture:** 코드 변경 없음. 마크다운 문서 2개(docs/README.md, docs/docs-classification.md)에 누락된 디렉토리 항목을 추가한다. 나머지 3개 파일은 확인 후 변경이 필요 없으므로 그대로 둔다. 모든 작업은 별도 git worktree에서 진행한다.

**Tech Stack:** git worktree, markdown, `npm run docs:audit-links`

---

## 사전 조사 결과 (변경 불필요 항목)

탐색 단계에서 확인된 사항:
- `docs/DESIGN.md`: `static/css/tokens.css`, `static/css/components.css`, `static/css/dashboard.css` 모두 실재함 → 변경 불필요
- `docs/blog/README.md`: 링크 전수 유효 → 변경 불필요
- `.cursor/rules/specify-rules.mdc`: 자동 생성분, `alwaysApply: true` 메타 정합, 수동 편집 금지 → 확인만

---

## Task 1: Worktree 생성 및 브랜치 설정

**Files:**
- (신규 worktree) `../memento-docs-360/`

- [ ] **Step 1: 저장소 최신화 및 worktree 추가**

저장소 루트(`/home/jee1lee/git/memento`)에서 실행:

```bash
git fetch origin
git worktree add ../memento-docs-360 origin/main
```

Expected: `Preparing worktree (detached HEAD abcdef1)` 유사 메시지

- [ ] **Step 2: 전용 브랜치 생성**

```bash
cd ../memento-docs-360
git switch -c docs/issue-360
```

Expected: `Switched to a new branch 'docs/issue-360'`

- [ ] **Step 3: 의존성 설치 (docs:audit-links 실행용)**

```bash
npm ci --silent
```

Expected: `npm warn` 없이 완료 또는 `added N packages`

- [ ] **Step 4: 현재 상태 기준선 확인**

```bash
npm run docs:audit-links
```

Expected: `All relative markdown links resolve to existing paths.`

---

## Task 2: `docs/README.md` — integrations·adr 섹션 추가

**Files:**
- Modify: `docs/README.md`

### 배경

`docs/integrations/`에는 외부 AI 비서(OpenClaw/NanoClaw/ZeroClaw)가 Memento를 MCP 백엔드로 사용하는 방법을 안내하는 공식 문서가 있다. `docs/adr/`에는 아키텍처 결정 기록(ADR)이 있다. 두 디렉토리 모두 포털에 미등재 상태다.

- [ ] **Step 1: integrations 섹션 추가 위치 파악**

`docs/README.md`의 "연동·레퍼런스" 표 아래, "How-to" 표 위에 integrations 행을 추가한다.

현재 "연동·레퍼런스" 표:
```markdown
| 문서 | KO | EN |
|------|----|----|
| 전체 API | [api-reference.md](../../api/ko/api-reference.md) | [api-reference.md](../../api/en/api-reference.md) |
| 임베딩 API | [embedding-api-reference.md](../../api/ko/embedding-api-reference.md) | — |
| 관계 그래프 API | [relation-graph-api.md](../../api/ko/relation-graph-api.md) | [relation-graph-api.md](../../api/en/relation-graph-api.md) |
| 보안 | [security.md](../../reference/ko/security.md) | [security.md](../../reference/en/security.md) |
```

- [ ] **Step 2: integrations 행 추가**

"연동·레퍼런스" 표에 integrations 행을 추가한다. 표 전체를 다음으로 교체:

```markdown
| 문서 | KO | EN |
|------|----|----|
| 전체 API | [api-reference.md](../../api/ko/api-reference.md) | [api-reference.md](../../api/en/api-reference.md) |
| 임베딩 API | [embedding-api-reference.md](../../api/ko/embedding-api-reference.md) | — |
| 관계 그래프 API | [relation-graph-api.md](../../api/ko/relation-graph-api.md) | [relation-graph-api.md](../../api/en/relation-graph-api.md) |
| 보안 | [security.md](../../reference/ko/security.md) | [security.md](../../reference/en/security.md) |
| 외부 비서 통합 | [integrations/README.md](../../integrations/README.md) | — |
```

- [ ] **Step 3: 아키텍처·설계 섹션에 ADR 항목 추가**

`docs/README.md`의 "아키텍처·설계" 섹션:

현재:
```markdown
- DB ERD: [KO](../../architecture/ko/database-erd.md) / [EN](../../architecture/en/database-erd.md) (영문은 KO 링크 안내)
- 비동기 보강 파이프라인: [KO](../../architecture/ko/async-augmentation-pipeline.md) / [EN](../../architecture/en/async-augmentation-pipeline.md)
- FTS5 무중단 마이그레이션: [KO](../../architecture/ko/zero-downtime-fts5-migration.md) / [EN](../../architecture/en/zero-downtime-fts5-migration.md)
- 아키텍처 개요: [KO](../../architecture/ko/architecture.md) / [EN](../../architecture/en/architecture.md)
```

다음으로 교체:
```markdown
- DB ERD: [KO](../../architecture/ko/database-erd.md) / [EN](../../architecture/en/database-erd.md) (영문은 KO 링크 안내)
- 비동기 보강 파이프라인: [KO](../../architecture/ko/async-augmentation-pipeline.md) / [EN](../../architecture/en/async-augmentation-pipeline.md)
- FTS5 무중단 마이그레이션: [KO](../../architecture/ko/zero-downtime-fts5-migration.md) / [EN](../../architecture/en/zero-downtime-fts5-migration.md)
- 아키텍처 개요: [KO](../../architecture/ko/architecture.md) / [EN](../../architecture/en/architecture.md)
- 아키텍처 결정 기록(ADR): [adr/](../../adr/)
```

- [ ] **Step 4: 링크 검증**

```bash
npm run docs:audit-links
```

Expected: `All relative markdown links resolve to existing paths.`

- [ ] **Step 5: 커밋**

```bash
git add docs/README.md
git commit -m "docs(360): add integrations and adr entries to portal"
```

---

## Task 3: `docs/docs-classification.md` — 매핑 표에 integrations·adr 추가

**Files:**
- Modify: `docs/docs-classification.md`

- [ ] **Step 1: 섹션 2 "공식 문서 카테고리" 표에 항목 추가**

현재 섹션 2 표 마지막 행:
```markdown
| **블로그 (blog)** | 비정기 게시·회고 | `blog/` | any | ephemeral |
```

다음으로 교체 (두 행 추가):
```markdown
| **블로그 (blog)** | 비정기 게시·회고 | `blog/` | any | ephemeral |
| **통합·외부 연동 (integrations)** | 외부 AI 비서와 Memento 연결 가이드 | `integrations/` | user, integrator | stable |
| **아키텍처 결정 기록 (adr)** | 설계 결정 근거 기록 | `adr/` | contributor | stable |
```

- [ ] **Step 2: 섹션 4 "디렉터리 → 카테고리 매핑" 표에 항목 추가**

현재 섹션 4 공식 문서 마지막 행:
```markdown
| `docs/blog/` | 공식 | 블로그 |
```

다음으로 교체 (두 행 추가):
```markdown
| `docs/blog/` | 공식 | 블로그 |
| `docs/integrations/` | 공식 | 통합·외부 연동 |
| `docs/adr/` | 공식 | 아키텍처 결정 기록 |
```

- [ ] **Step 3: 링크 검증**

```bash
npm run docs:audit-links
```

Expected: `All relative markdown links resolve to existing paths.`

- [ ] **Step 4: 커밋**

```bash
git add docs/docs-classification.md
git commit -m "docs(360): add integrations and adr to docs classification"
```

---

## Task 4: 나머지 3개 파일 확인 (변경 없음 확인 커밋)

**Files:**
- Read-only: `docs/DESIGN.md`, `docs/blog/README.md`, `.cursor/rules/specify-rules.mdc`

- [ ] **Step 1: DESIGN.md CSS 경로 존재 확인**

```bash
ls static/css/tokens.css static/css/components.css static/css/dashboard.css
```

Expected: 세 파일 모두 출력됨 (존재 확인)

- [ ] **Step 2: blog/README.md 확인**

```bash
npm run docs:audit-links 2>&1 | tail -3
```

Expected: `All relative markdown links resolve to existing paths.`

- [ ] **Step 3: .cursor/rules/specify-rules.mdc 메타 확인**

```bash
head -6 .cursor/rules/specify-rules.mdc
```

Expected:
```
---
description: Project Development Guidelines
globs: ["**/*"]
alwaysApply: true
---
```

`alwaysApply: true`이고 `description`이 현재 프로젝트를 기술하면 정합함. 자동 생성분이므로 내용 수동 편집 금지.

---

## Task 5: 최종 검증 및 PR 제출

**Files:**
- (없음 — 검증 및 PR 작업)

- [ ] **Step 1: 전체 링크 감사 최종 실행**

```bash
npm run docs:audit-links
```

Expected: `All relative markdown links resolve to existing paths.`

- [ ] **Step 2: 변경 파일 확인 (스냅샷 미수정 확인)**

```bash
git diff main --name-only
```

Expected: 아래 파일만 나타나야 함 (체크리스트 업데이트 전이라면 2개, 후라면 3개)
```
docs/README.md
docs/docs-classification.md
docs/operations/ko/doc-audit-checklist.md  ← Step 5 이후에만 포함
```

`docs/superpowers/`, `specs/`, `tasks/` 경로가 없어야 한다.

- [ ] **Step 3: 원격 푸시**

```bash
git push -u origin docs/issue-360
```

- [ ] **Step 4: PR 생성**

```bash
gh pr create \
  --title "docs(360): add integrations and adr to doc portal" \
  --body "$(cat <<'EOF'
## Summary

- `docs/README.md`: 연동·레퍼런스 표에 외부 비서 통합(`integrations/README.md`) 추가, 아키텍처·설계 섹션에 ADR(`adr/`) 추가
- `docs/docs-classification.md`: 섹션 2·4에 `integrations/`·`adr/` 항목 추가
- `docs/DESIGN.md`, `docs/blog/README.md`, `.cursor/rules/specify-rules.mdc`: 이상 없음 확인, 변경 없음

## Closes

Closes #360

## 검증

- `npm run docs:audit-links`: All relative markdown links resolve to existing paths.
- 스냅샷 문서(`docs/superpowers/**`, `specs/`, `tasks/`) 미수정 확인

EOF
)"
```

- [ ] **Step 5: doc-audit-checklist.md 체크**

`docs/operations/ko/doc-audit-checklist.md`의 `docs/README.md` 항목을 `[x]`로 표시한다.

```bash
# 체크리스트 파일에서 해당 줄 수동 수정
# - [ ] `docs/README.md`  →  - [x] `docs/README.md`
```

변경 후:
```bash
git add docs/operations/ko/doc-audit-checklist.md
git commit -m "docs(360): mark docs/README.md audited in checklist"
git push
```
