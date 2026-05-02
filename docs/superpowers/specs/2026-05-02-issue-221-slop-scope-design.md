# 설계: 이슈 #221 — slop-detector 저장소 범위·설정 정리

**상태**: 승인됨 (CI 하드 게이트 제외, 설정·문서 중심)  
**날짜**: 2026-05-02  
**이슈**: [GitHub #221](https://github.com/jee1/memento/issues/221)

---

## 1. 배경·문제

[`ai-slop-detector`](https://pypi.org/project/ai-slop-detector/)로 JS/TS를 스캔할 때 **분석 루트(`--project`)에 따라 결과가 크게 달라진다**. 루트 전체(`.`)를 쓰면 `.worktrees/`, `demo/.next/` 등이 포함되어 파일 수가 불필요하게 늘고, 번들·워크트리 복제본이 Critical로 잡혀 **실제 코드베이스 신호 대비 노이즈**가 커진다.

이슈 #162에서 `.slopconfig.yaml`로 빌드·캐시·`graphify-out` 등은 제외했으나, **git worktree 디렉터리(`**/.worktrees/**`)** 는 명시되지 않았다.

`--gate` 사용 시 Python 파일이 없으면 상단 요약의 LDR/DDC가 0으로 나와 Gate 표시가 오해를 부를 수 있으므로, **`--js` 스캔 시에는 JS/TS Analysis 블록을 주된 해석 기준**으로 삼는다.

---

## 2. 목표·비목표

### 2.1 목표

- 루트 `.slopconfig.yaml`의 `ignore`에 **`**/.worktrees/**`** 를 추가하여, 로컬 워크트리 체크아웃이 루트 전체 스캔에 섞이지 않게 한다.
- `DEVELOPMENT_RULES.md`에 **권장 `slop-detector` 명령**(패키지·`static/js`·루트)과 **`--gate` 해석 주의**, **`--config .slopconfig.yaml` 사용**을 문서화한다.
- 프로덕션 코드 중 Critical 후보는 **별도 리팩터링 없이** 아래 표로 백로그를 고정한다(후속 이슈에서 처리).

### 2.2 비목표

- **GitHub Actions 등 CI에 slop 하드 게이트 추가** — 도구가 pip 기반이고 `--gate` 요약이 JS 전용 스캔에서 혼동될 수 있어, 본 이슈에서는 제외한다. 후속 이슈에서 워크플로·기준선을 논의한다.
- 기본 `.slopconfig`에서 `*.spec.ts`·`src/test/**` 등을 **대량 무시하지 않는다** — Vitest 패턴 오탐과 품질 신호의 균형은 팀 정책에 맞춰 **선택적으로 로컬 전용 설정**으로 조정한다(본 저장소 기본값 변경 아님).

---

## 3. 설계

### 3.1 `.slopconfig.yaml` 변경

| 추가 패턴 | 이유 |
|-----------|------|
| `**/.worktrees/**` | git worktree로 추가 체크아웃된 트리는 소스 복제본이며 루트 `--project .` 시 노이즈·중복 분석 유발 |

기존 #162 패턴(`**/node_modules/**`, `**/.next/**`, `graphify-out/**` 등)은 유지한다. `demo/.next`는 이미 `**/.next/**`로 포함된다.

### 3.2 문서 (`DEVELOPMENT_RULES.md`)

품질 게이트 소절의 필수 항목(검증 필수, 실패 우선 테스트) **다음**에 **「선택적 정적 스캔 (slop-detector)」** 소절을 추가한다.

- 설치: `pip install ai-slop-detector`
- 권장:
  - `slop-detector --project packages --js --config .slopconfig.yaml`
  - 필요 시: `slop-detector --project static/js --js --config .slopconfig.yaml`
  - 루트: `slop-detector --project . --js --config .slopconfig.yaml`
- `--gate`: 상단 비-Python 요약과 불일치 가능 → **JS/TS Analysis 구간을 우선 참고**
- CI 필수 게이트 편입은 하지 않음(본 이슈).

### 3.3 프로덕션 Critical 후보 백로그 (리팩터링 본 이슈 범위 아님)

| 우선 검토 파일 |
|----------------|
| `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts` |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` |
| `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` |
| `packages/memento-core/src/domains/memory/tools/recall-tool.ts` |
| `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts` |

---

## 4. 검증

- `.slopconfig.yaml`에 `**/.worktrees/**` 가 포함되었는지 확인한다.
- (도구가 설치된 환경에서) 위 문서의 명령이 오류 없이 실행되는지 선택적으로 확인한다.

---

## 5. 출처

- 이슈 #221 본문, #162 설계(`docs/superpowers/specs/2026-05-01-issue-162-slopconfig-design.md`)
- 브레인스토밍: CI 게이트 **미포함** 합의
