# Issue 209 Release Git128 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release 워크플로의 `git exit code 128` 실패 원인을 로그만으로 분류 가능하게 만들고, 재발 방지 최소 수정을 `release.yml`에 적용한다.

**Architecture:** `.github/workflows/release.yml` 단일 파일을 대상으로 checkout/ref-tag/permission 경계에 관측성과 fail-fast 가드를 추가한다. 기본 로그는 최소로 유지하고, `workflow_dispatch` 입력 플래그로만 상세 진단 로그를 활성화한다. 기존 publish/release 동작은 유지한다.

**Tech Stack:** GitHub Actions YAML, actions/checkout, actions/setup-node, bash, GitHub API(curl), npm

---

## File Structure Map

- Modify: `.github/workflows/release.yml`
  - 책임: release 파이프라인 실행, 버전/릴리즈 정보 추출, npm publish, 릴리즈 생성/스킵
  - 이번 변경: 디버그 입력값, 권한 명시, checkout fetch 정책 명시, preflight 진단/가드 스텝 추가
- Reference only: `.github/workflows/ci.yml`
  - 책임: PR/브랜치 CI 파이프라인. 이번 이슈에서는 수정하지 않음.

---

### Task 1: 워크플로 입력/권한/checkout 정책 추가

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `.github/workflows/release.yml` (문법/표현식 검증)

- [ ] **Step 1: 디버그 입력값과 최소 권한 정의를 먼저 실패 기준으로 작성**

```yaml
on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      debug_release:
        description: "Enable detailed release diagnostics"
        required: false
        default: "false"
        type: choice
        options: ["false", "true"]

permissions:
  contents: write
```

- [ ] **Step 2: 워크플로 문법이 현재 상태에서 깨지는지 먼저 확인**

Run: `npx prettier --check .github/workflows/release.yml`  
Expected: `All matched files use Prettier code style!` 또는 포맷 이슈 1건 이상 보고

- [ ] **Step 3: checkout 스텝에 fetch 정책 최소 구현 추가**

```yaml
- name: Checkout code
  uses: actions/checkout@v4
  with:
    fetch-depth: 0
    fetch-tags: true
```

- [ ] **Step 4: 문법/포맷 재검증**

Run: `npx prettier --check .github/workflows/release.yml`  
Expected: `All matched files use Prettier code style!`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add debug input, permissions, and checkout fetch policy"
```

---

### Task 2: checkout/ref/tag preflight 진단과 fail-fast 추가

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `.github/workflows/release.yml` (로컬 정적 검증 + Actions 수동 실행)

- [ ] **Step 1: 실패하는 진단 시나리오를 먼저 정의 (태그 미해결)**

```bash
# 실패 기준(수동 실행 시): TAG_NAME empty => E_TAG_RESOLUTION
# 성공 기준: TAG_NAME non-empty and starts with v
```

- [ ] **Step 2: checkout 직후 최소 진단 스텝 추가 (기본 로그)**

```yaml
- name: Preflight: repository context
  run: |
    echo "event=${{ github.event_name }}"
    echo "ref=${{ github.ref }}"
    echo "ref_type=${{ github.ref_type }}"
    echo "is_shallow=$(git rev-parse --is-shallow-repository)"
    echo "tag_count=$(git tag | wc -l)"
```

- [ ] **Step 3: 태그 정규화/검증 fail-fast 스텝 추가**

```yaml
- name: Preflight: resolve and validate tag
  id: preflight_tag
  run: |
    if [ "${{ github.event_name }}" = "release" ]; then
      TAG_NAME="${{ github.event.release.tag_name }}"
    else
      TAG_NAME="${GITHUB_REF#refs/tags/}"
      if [ -z "$TAG_NAME" ]; then
        TAG_NAME="${{ steps.version.outputs.tag_name }}"
      fi
    fi

    if [ -z "$TAG_NAME" ]; then
      echo "E_TAG_RESOLUTION: empty tag name"
      exit 1
    fi

    case "$TAG_NAME" in
      v*) ;;
      *) echo "E_TAG_RESOLUTION: invalid tag format: $TAG_NAME"; exit 1 ;;
    esac

    echo "tag_name=$TAG_NAME" >> $GITHUB_OUTPUT
```

- [ ] **Step 4: 로컬 정적 검증 + PR 푸시 후 수동 실행 확인**

Run: `npx prettier --check .github/workflows/release.yml`  
Expected: PASS

Run (manual in GitHub UI): `Release and Publish` workflow_dispatch 실행  
Expected: `Preflight: repository context`와 `Preflight: resolve and validate tag` 성공 또는 명확한 `E_TAG_RESOLUTION` 실패

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add checkout and tag resolution preflight guards"
```

---

### Task 3: GitHub API/권한 preflight와 조건부 상세 디버그 추가

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `.github/workflows/release.yml` (debug OFF/ON 수동 검증)

- [ ] **Step 1: 상세 디버그 활성 조건 실패/성공 기준 정의**

```bash
# debug_release=false: 상세 진단 스텝 skip
# debug_release=true: 상세 진단 스텝 run
```

- [ ] **Step 2: GitHub API 접근 preflight 스텝 추가 (민감정보 미출력)**

```yaml
- name: Preflight: GitHub API access
  run: |
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/${{ github.repository }}")

    if [ "$STATUS" -lt 200 ] || [ "$STATUS" -ge 300 ]; then
      echo "E_GH_API_ACCESS: status=$STATUS"
      exit 1
    fi

    echo "github_api_status=$STATUS"
```

- [ ] **Step 3: 조건부 상세 디버그 스텝 추가**

```yaml
- name: Debug diagnostics (conditional)
  if: github.event_name == 'workflow_dispatch' && inputs.debug_release == 'true'
  run: |
    echo "debug_release=true"
    git --version
    git remote -v
    git show-ref --tags | tail -n 20
```

- [ ] **Step 4: OFF/ON 수동 검증 실행**

Run (manual): workflow_dispatch with `debug_release=false`  
Expected: Debug diagnostics step skipped

Run (manual): workflow_dispatch with `debug_release=true`  
Expected: Debug diagnostics step executed with tag refs shown

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add API preflight and conditional diagnostics"
```

---

### Task 4: 기존 동작 회귀 확인 및 문서성 로그 정리

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: GitHub Actions run logs (release existing/missing)

- [ ] **Step 1: release 존재/미존재 분기 테스트 시나리오 정의**

```bash
# 시나리오 A: 기존 release 존재 -> "Skip Release creation" 경로
# 시나리오 B: release 미존재 -> "Create GitHub Release" 경로
```

- [ ] **Step 2: 에러 prefix를 기존 실패 가능 지점에 일관 적용**

```yaml
# 예시 패턴 (실제 위치에 맞게 적용)
echo "E_CHECKOUT_CONTEXT: ..."
echo "E_TAG_RESOLUTION: ..."
echo "E_GH_API_ACCESS: ..."
echo "E_NPM_AUTH: ..."
```

- [ ] **Step 3: 회귀 검증 실행**

Run (manual): release event for existing tag  
Expected: npm publish 완료 + release create skip

Run (manual): release event for new tag  
Expected: npm publish 완료 + release create 수행

- [ ] **Step 4: 최종 정적 체크**

Run: `npx prettier --check .github/workflows/release.yml`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): standardize error families and validate release paths"
```

---

## Spec Coverage Check

- 원인 확정: checkout/ref/tag/permission/API 축 preflight로 실패 축 분류 가능
- 재발 방지 최소 수정: fetch 정책 + fail-fast + 권한 명시
- 디버그 정책(B): 기본 최소 로그 + workflow_dispatch 조건부 상세 로그
- 기존 릴리즈 동작 유지: publish/create/skip 경로 회귀 검증 포함
- Node 24 전환 분리: 본 계획에서 구현 제외(후속 이슈)

## Placeholder Scan

- `TBD`, `TODO`, "적절히", "나중에" 표현 없음
- 각 Task에 파일 경로/명령/기대결과/커밋 메시지 명시됨

## Type/Name Consistency Check

- debug input 이름: `debug_release`로 통일
- 에러 prefix: `E_CHECKOUT_CONTEXT`, `E_TAG_RESOLUTION`, `E_GH_API_ACCESS`, `E_NPM_AUTH`로 통일
- 타겟 파일: `.github/workflows/release.yml`로 통일
