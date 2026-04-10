# 저장소 정리 구현 계획 (Repo Cleanup)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 불필요한 파일·디렉토리와 작업 흔적을 단계별로 정리하여 유지보수성·문서 정합성·빌드/CI를 개선한다.

**Architecture:** 접근 A(단계별·카테고리별). 1단계 루트·.gitignore → 2단계 scripts·tasks → 3단계 문서·tests·demo·services. 각 단계 끝에 `npm run build`·`npm test`로 검증.

**Tech Stack:** Git, Node/npm, 기존 docs/·AGENTS.md·package.json.

**설계 문서:** [design.md](./design.md)

---

## Phase 1: 루트·.gitignore

### Task 1.1: 루트 중복·작업 흔적 파일 식별 및 정리

**Files:**
- 삭제 또는 이동 후보: `PR_DESCRIPTION.md`, `pr-description.md`, `mcp-http-client.js`, `test-docker.js`, `test-anchor-map-ui.sh`
- 참고: `package.json` (test:docker가 `node test-docker.js` 참조)

**Step 1: 참조 확인**

```bash
cd /home/jee1lee/git/memento
grep -r "PR_DESCRIPTION\|pr-description\|mcp-http-client\|test-docker\|test-anchor-map" --include="*.json" --include="*.md" --include="*.ts" --include="*.js" . 2>/dev/null | grep -v node_modules | grep -v ".git"
```

- `package.json`에 `"test:docker": "node test-docker.js"` 있으면 test-docker.js는 유지 또는 스크립트로 대체 후 삭제 결정.

**Step 2: 중복 문서 정리**

- `PR_DESCRIPTION.md`와 `pr-description.md` 중 하나만 남기고 다른 하나 삭제(내용 동일하면 pr-description.md 유지, 루트 대문자 파일 삭제).
- 수정: 없음. 삭제만 수행.

**Step 3: 불필요 루트 파일 삭제 또는 이동**

- `mcp-http-client.js`: 다른 코드/문서에서 참조 없으면 삭제. 있으면 `scripts/` 또는 `docs/operations` 예제로 이동.
- `test-anchor-map-ui.sh`: 참조 없으면 삭제.
- `test-docker.js`: package.json `test:docker` 제거 후 삭제하거나, 유지 시 `scripts/`로 이동 후 package.json 경로 수정.

**Step 4: 검증**

```bash
npm run build
```
Expected: 성공.

**Step 5: 커밋**

```bash
git add -A
git commit -m "chore: remove or relocate root-level duplicate and ad-hoc files"
```

---

### Task 1.2: .gitignore 보강

**Files:**
- Modify: `.gitignore`

**Step 1: 누락 패턴 추가**

다음 줄이 없으면 추가(이미 있으면 스킵):

```
# Repo cleanup: test/build artifacts
test-config/
test-logs/
test-results/
logs/
.worktrees/
demo/.next/
demo/node_modules/
```

- 참고: `coverage/`는 이미 .gitignore에 있음.

**Step 2: 검증**

```bash
git status
```
- test-config, test-logs, logs 등이 추적 대상으로 나오지 않아야 함.

**Step 3: 커밋**

```bash
git add .gitignore
git commit -m "chore: extend .gitignore for test-config, test-logs, logs, demo artifacts, worktrees"
```

---

### Task 1.3: 루트 config/, static/, prompts/ 역할 확인

**Files:**
- Read: `AGENTS.md`, `README.md`
- List: `config/`, `static/`, `prompts/` 내용

**Step 1: 디렉터리 내용 및 빌드 참조 확인**

```bash
ls -la config/ static/ prompts/ 2>/dev/null
grep -r "config/\|static/\|prompts/" package.json src/ --include="*.ts" --include="*.json" 2>/dev/null | head -30
```

**Step 2: 문서와 일치 여부 확인**

- AGENTS.md/README에 “config, static, prompts는 …” 설명이 있으면 유지. 없으면 docs/plans/ko/2026-03-03-repo-cleanup-design.md에 “유지(빌드/실행에서 사용)” 또는 “이동 검토” 한 줄 기록만 추가하고 실제 이동은 하지 않음.

**Step 3: 커밋(문서만 변경한 경우)**

```bash
git add docs/plans/ko/2026-03-03-repo-cleanup-design.md
git commit -m "docs: note config/static/prompts role in cleanup design"
```

---

## Phase 2: scripts/ · tasks/

### Task 2.1: scripts/ 인벤토리 작성

**Files:**
- Create: `docs/plans/ko/2026-03-03-scripts-inventory.md` (또는 design 문서 하위 섹션)
- Read: `package.json` (scripts 필드), `docs/operations/ko/scripts-index.md`

**Step 1: npm·문서에 등록된 스크립트 목록 추출**

```bash
cd /home/jee1lee/git/memento
node -e "const p=require('./package.json'); Object.entries(p.scripts||{}).forEach(([k,v])=>{ const m=(v+'').match(/scripts\/([^\s]+)/); if(m) console.log(m[1]); });"
```

**Step 2: scripts/ 디렉터리 전체 목록과 비교**

```bash
ls scripts/
```

- 등록된 파일 → “유지”. 미등록 파일 → “archive 후보” 또는 “삭제 후보”로 표시.

**Step 3: 인벤토리 문서에 표 작성**

- 컬럼: 파일명, npm/문서 등록 여부, 권장(유지/archive/삭제), 비고.

**Step 4: 커밋**

```bash
git add docs/plans/ko/2026-03-03-scripts-inventory.md
git commit -m "docs: add scripts inventory for repo cleanup"
```

---

### Task 2.2: scripts/archive 생성 및 미사용 스크립트 이동

**Files:**
- Create: `scripts/archive/` (디렉터리)
- Modify: `docs/operations/ko/scripts-index.md` (archive 안내 추가)

**Step 1: archive 디렉터리 생성**

```bash
mkdir -p scripts/archive
```

**Step 2: 인벤토리에서 “archive”로 표시한 파일만 이동**

- 예: `direct-sql-migration.sql`, `restore-legacy.ps1`, `restore-legacy.sh` 등(scripts-index에서 이미 “삭제 또는 archive 이동 검토”로 언급된 항목).
- 이동 시: `git mv scripts/<파일> scripts/archive/`

**Step 3: scripts-index.md에 archive 안내 추가**

- “이전 경로 → scripts/archive/” 테이블 또는 문단 추가.

**Step 4: 검증**

```bash
npm run build
npm run db:check-migration
```
Expected: 성공. (이동한 스크립트는 npm 스크립트에서 참조되지 않아야 함.)

**Step 5: 커밋**

```bash
git add scripts/archive docs/operations/ko/scripts-index.md
git commit -m "chore: move one-off scripts to scripts/archive and update scripts-index"
```

---

### Task 2.3: tasks/ 메타 가이드 정리

**Files:**
- Read: `tasks/README.md`, `tasks/meta/create-prd.md`, `tasks/meta/generate-tasks.md`, `tasks/meta/process-task-list.md`
- Modify: `docs/README.md` (tasks 링크가 메타 가이드 위치를 반영하도록, 필요 시)

**Step 1: 메타 가이드 이동 또는 유지 결정**

- 옵션 A: `tasks/` 내에 `tasks/meta/` 생성 후 create-prd.md 등 이동.
- 옵션 B: `docs/plans/ko/` 또는 `docs/guides/ko/`로 이동 후 tasks/README에서 링크로 안내.

**Step 2: 적용**

- 적용: 메타 가이드는 `tasks/meta/`로 이동 완료.

**Step 3: tasks/README.md 업데이트**

- “기타 파일” 섹션에서 메타 가이드 새 위치 링크로 수정.

**Step 4: 커밋**

```bash
git add tasks/ docs/
git commit -m "chore: relocate tasks meta guides and update tasks/README"
```

---

## Phase 3: 문서·tests·demo·services

### Task 3.1: docs/README.md 깨진 링크 수정

**Files:**
- Modify: `docs/README.md`
- Create(선택): `docs/reference/ko/file-location-audit.md` (최소 버전), `docs/plans/ko/2026-02-28-file-location-audit-improvements.md` (없음 안내 또는 요약)

**Step 1: 누락 문서 확인**

```bash
test -f docs/reference/ko/file-location-audit.md && echo "exists" || echo "missing"
test -f docs/plans/ko/2026-02-28-file-location-audit-improvements.md && echo "exists" || echo "missing"
```

**Step 2: docs/README.md 링크 수정**

- `file-location-audit.md` 링크: 파일 없으면 “(문서 없음 — 2026-03-03 정리 설계 참고)” 괄호 안내로 바꾸거나, 최소 문서 생성 후 링크 유지.
- `2026-02-28-file-location-audit-improvements.md` 링크: 파일 없으면 “(문서 없음)” 또는 “2026-03-03-repo-cleanup-design으로 대체” 안내로 수정.

**Step 3: 최소 대체 문서 생성(선택)**

- `docs/reference/ko/file-location-audit.md`: 제목 + “본 문서는 2026-03-03 저장소 정리 설계에서 통합됨. [design.md](./design.md) 참고.” 한 줄.

**Step 4: 커밋**

```bash
git add docs/README.md docs/reference/ko/file-location-audit.md docs/plans/ko/
git commit -m "docs: fix broken links and add placeholder for file-location-audit"
```

---

### Task 3.2: tests/ vs src/test/ 역할 명시

**Files:**
- Modify: `AGENTS.md` 또는 `docs/guides/ko/developer-guide.md`

**Step 1: 한 줄 추가**

- AGENTS.md “테스트 가이드라인” 섹션에 추가:
  - “루트 `tests/`: 통합 테스트·픽스처(필요 시). `src/test/`: E2E·시나리오 테스트(test-*.ts 등).”

**Step 2: 커밋**

```bash
git add AGENTS.md
git commit -m "docs: clarify tests/ vs src/test/ in AGENTS.md"
```

---

### Task 3.3: demo/, services/ 사용 여부 및 .gitignore

**Files:**
- Read: `demo/package.json`(있다면), `services/agent` 내용
- Modify: `.gitignore` (이미 Task 1.2에서 demo/.next, demo/node_modules 추가했다면 스킵)

**Step 1: 사용 여부 확인**

```bash
grep -r "demo/\|services/" package.json docs/ AGENTS.md README.md 2>/dev/null | head -20
```

**Step 2: 결정 문서화**

- docs/plans/ko/2026-03-03-repo-cleanup-design.md에 “demo: 유지(또는 archive 검토). services: 유지(또는 archive 검토).” 한 줄 추가.

**Step 3: .gitignore 재확인**

- demo/.next, demo/node_modules, logs 등 이미 추가했으면 추가 작업 없음.

**Step 4: 커밋**

```bash
git add docs/plans/ko/2026-03-03-repo-cleanup-design.md
git commit -m "docs: record demo/services retention decision in cleanup design"
```

---

## Phase 4: 최종 검증

### Task 4.1: 전체 검증 및 docs/README 링크 확인

**Step 1: 빌드·테스트**

```bash
cd /home/jee1lee/git/memento
npm run build
npm test
```
Expected: 모두 성공.

**Step 2: docs/README.md 링크 수동 확인**

- docs/README.md에서 수정한 링크 클릭 또는 해당 파일 존재 여부 확인.

**Step 3: 커밋(추가 변경 있으면)**

- Phase 3·4에서 남은 변경이 있으면 커밋.

---

## 실행 옵션

계획은 `docs/plans/ko/2026-03-03-repo-cleanup-implementation-plan.md`에 저장되었습니다. 실행 방식은 두 가지입니다.

1. **Subagent-Driven (이 세션)** — 태스크마다 새 서브에이전트를 할당하고, 태스크 사이에 리뷰하며 빠르게 반복합니다.
2. **Parallel Session (별도 세션)** — 새 세션에서 executing-plans 스킬로 워크트리 열고, 체크포인트 단위로 일괄 실행합니다.

원하시는 쪽을 알려주시면 그에 맞춰 진행하겠습니다.
