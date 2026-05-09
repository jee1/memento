# Issue #239 — slop 정책 A(로컬 전용 오버라이드) 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 루트 `.slopconfig.yaml`은 변경하지 않고, `.slopconfig.local.yaml`을 gitignore에 추가하며 `DEVELOPMENT_RULES.md`에 로컬 전용 slop 스캔 절차를 문서화하여 이슈 #239·#313의 정책 A를 반영한다.

**Architecture:** 저장소 기본값(#221)은 유지하고, 기여자가 선택적으로 로컬 YAML 한 개로 `slop-detector --config`만 바꿔 동일 CLI 패턴을 재사용한다.

**Tech Stack:** `ai-slop-detector`(PyPI), 기존 `.slopconfig.yaml` v2.0, Git.

**Spec:** [docs/superpowers/specs/2026-05-10-issue-239-slop-followup-design.md](../specs/2026-05-10-issue-239-slop-followup-design.md)

---

### Task 1: `.gitignore`에 로컬 slop 설정 무시

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 환경 변수 블록 다음에 항목 추가**

`# Environment variables` 절 직후(`.env.production.local` 다음)에 아래 두 줄을 삽입한다.

```gitignore
# Local-only slop-detector overrides (see DEVELOPMENT_RULES.md — optional static scan)
.slopconfig.local.yaml
```

- [ ] **Step 2: 무시 확인**

```bash
cd /path/to/repo
touch .slopconfig.local.yaml
git check-ignore -v .slopconfig.local.yaml
```

Expected: `.gitignore:NN:.slopconfig.local.yaml` 형태로 무시됨.

- [ ] **Step 3: 더미 파일 제거**

```bash
rm -f .slopconfig.local.yaml
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(slop): gitignore local .slopconfig.local.yaml (#239)"
```

---

### Task 2: `DEVELOPMENT_RULES.md` — 로컬 전용 스캔 절차

**Files:**
- Modify: `DEVELOPMENT_RULES.md` (「선택적 정적 스캔 (slop-detector)」소절)

- [ ] **Step 1: `테스트 경로 무시` 불릿을 확장**

기존 한 줄:

`*   **테스트 경로 무시:** 기본 .slopconfig에서는 *.spec.ts 등을 대량 제외하지 않는다. 팀 정책에 따라 로컬에서만 ignore를 추가할 수 있다.`

을 아래 블록으로 **교체**한다(앞의 `*` 들여쓰기 스타일 유지).

```markdown
*   **테스트 경로 무시(저장소 기본):** 루트 `.slopconfig.yaml`에는 `*.spec.ts`·`tests/**` 등을 **대량으로 넣지 않는다**([#221](https://github.com/jee1/memento/issues/221) 정책).
*   **로컬 전용 오버라이드(선택):** Vitest 노이즈를 줄이려면 (1) 루트 `.slopconfig.yaml`을 복사해 `.slopconfig.local.yaml`을 만들고, (2) `ignore`에 개인용 패턴(예: `**/*.spec.ts`, `**/tests/**`)만 추가한다. 이 파일은 `.gitignore`에 포함되어 **커밋되지 않는다**. (3) 스캔 시 `--config .slopconfig.local.yaml`을 지정한다. 예: `slop-detector --project packages --js --config .slopconfig.local.yaml`
```

- [ ] **Step 2: Commit**

```bash
git add DEVELOPMENT_RULES.md
git commit -m "docs(slop): document local-only .slopconfig override (#239)"
```

---

### Task 3: 설계 문서 추적

**Files:**
- Create: `docs/superpowers/specs/2026-05-10-issue-239-slop-followup-design.md` (이미 본 플랜 작성 시 존재하면 `git add`만)

- [ ] **Step 1: 스펙 파일 추가·커밋**

```bash
git add docs/superpowers/specs/2026-05-10-issue-239-slop-followup-design.md
git commit -m "docs: issue #239 slop follow-up spec (policy A)"
```

---

### Task 4: 품질 게이트(문서만 변경 시)

**Files:** 없음

- [ ] **Step 1: 린트(저장소 관례에 맞게 선택)**

문서·gitignore만 변경한 경우 필수는 아니나, 팀 관례상 실행하려면:

```bash
npm run lint
```

Expected: 기존과 동일하게 통과(문서 변경으로 새 오류 없음).

---

## Self-review (플랜 작성자용)

| Spec § | Task |
|--------|------|
| §3 루트 설정 불변 | Task 1–2는 `.slopconfig.yaml` 미수정 |
| §3 로컬 파일 | Task 1 gitignore + Task 2 절차 |
| §5 검증 | Task 1 Step 2, Task 4 |

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-issue-239-slop-policy-local.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트, 태스크 사이 리뷰  
**2. Inline Execution** — 같은 세션에서 체크포인트로 순차 실행

Which approach?
