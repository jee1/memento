# Issue #221 — slop-detector 범위·설정·문서 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.slopconfig.yaml`에 git worktree 경로를 무시 목록에 추가하고, `DEVELOPMENT_RULES.md`에 권장 `slop-detector` 명령과 `--gate` 해석을 문서화하여 이슈 #221을 반영한다(CI 게이트 없음).

**Architecture:** 루트 설정 파일 한 줄 추가 + 개발 규칙 문서에 선택적 도구 절 추가. 런타임 코드 변경 없음.

**Tech Stack:** `ai-slop-detector`(PyPI), 기존 `.slopconfig.yaml` v2.0.

---

### Task 1: `.slopconfig.yaml`에 worktree 무시 추가

**Files:**
- Modify: `.slopconfig.yaml`

- [ ] **Step 1: `ignore` 목록에 패턴 추가**

`ignore:` 배열에 다음 항목을 **알파벳·논리적 순서에 맞게** 삽입한다(기존 항목과 중복 없음).

```yaml
  - "**/.worktrees/**"
```

권장 위치: `**/node_modules/**` 근처(둘 다 `**/` 로 시작하는 로컬·도구 산출 경로 그룹).

- [ ] **Step 2: 커밋**

```bash
git add .slopconfig.yaml
git commit -m "chore(slop): ignore git worktrees in .slopconfig (#221)"
```

---

### Task 2: `DEVELOPMENT_RULES.md`에 slop-detector 안내 추가

**Files:**
- Modify: `DEVELOPMENT_RULES.md` — `### 품질 게이트`의 두 항목(검증 필수, 실패 우선 테스트) **뒤**에 새 소절 삽입

- [ ] **Step 1: 「선택적 정적 스캔 (slop-detector)」 소절 추가**

`*   **실패 우선 테스트:**` 줄 **다음**에 빈 줄 하나를 넣고, 아래 마크다운을 그대로 삽입한다.

```markdown
### 선택적 정적 스캔 (slop-detector)
*   **도구:** PyPI 패키지 `ai-slop-detector`, CLI `slop-detector`.
*   **설치:** `pip install ai-slop-detector`
*   **권장 명령(저장소 루트):**
    *   패키지 소스: `slop-detector --project packages --js --config .slopconfig.yaml`
    *   대시보드 정적 스크립트: `slop-detector --project static/js --js --config .slopconfig.yaml`
    *   루트 전체(설정 반영): `slop-detector --project . --js --config .slopconfig.yaml`
*   **`--gate`:** 상단 요약에 Python/LDR가 0으로 보일 수 있다. **`--js` 사용 시 JS/TS Analysis 구간을 게이트 판단의 주된 근거로 본다.**
*   **CI:** 본 저장소의 필수 CI 게이트에는 포함하지 않는다(후속 이슈에서 선택).
*   **테스트 경로 무시:** 기본 `.slopconfig`에서는 `*.spec.ts` 등을 대량 제외하지 않는다. 팀 정책에 따라 로컬에서만 ignore를 추가할 수 있다.
```

- [ ] **Step 2: 커밋**

```bash
git add DEVELOPMENT_RULES.md
git commit -m "docs: slop-detector 권장 명령 및 게이트 해석 안내 (#221)"
```

---

### Task 3: 설계·플랜 산출물 정리(이미 반영된 경우 스킵)

**Files:**
- `docs/superpowers/specs/2026-05-02-issue-221-slop-scope-design.md`
- `docs/superpowers/plans/2026-05-02-issue-221-slop-scope.md`

- [ ] **Step 1:** 위 파일이 저장소에 포함되어 있으면 한 커밋으로 묶거나, Task 2와 함께 `docs:` 커밋으로 추가한다.

```bash
git add docs/superpowers/specs/2026-05-02-issue-221-slop-scope-design.md docs/superpowers/plans/2026-05-02-issue-221-slop-scope.md
git commit -m "docs: issue #221 slop scope spec and plan"
```

---

### Task 4: 검증

- [ ] **Step 1:** `npm test` 및 `npm run lint` (저장소 루트) — 문서·YAML만 변경 시 회귀 없어야 한다.

```bash
npm test && npm run lint
```

기대: 기존과 동일하게 통과.

- [ ] **Step 2 (선택):** `slop-detector` 가 설치된 환경에서:

```bash
slop-detector --project packages --js --config .slopconfig.yaml 2>&1 | head -40
```

기대: 명령이 스캔을 시작하고 치명적 설정 오류가 없음.

---

## Self-review (플랜 작성자용)

| 스펙 요구 | 태스크 |
|-----------|--------|
| `**/.worktrees/**` ignore | Task 1 |
| 권장 명령·`--gate`·CI 비포함·테스트 무시 정책 문서화 | Task 2 |
| 프로덕션 Critical 백로그 | 설계 문서 §3.3 (코드 변경 없음) |
| CI 하드 게이트 없음 | 명시됨 |

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-issue-221-slop-scope.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트, 태스크 사이 리뷰  
**2. Inline Execution** — 이 세션에서 `executing-plans`로 순차 실행

원하는 방식을 알려 주세요.
