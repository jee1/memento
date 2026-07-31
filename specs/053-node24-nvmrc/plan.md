# Implementation Plan: Node 24 .nvmrc + 로컬 가이드

**Branch**: `issue-701-node24-nvmrc` | **Spec**: `specs/053-node24-nvmrc/spec.md`

## Architecture

문서·tooling only. 런타임 코드 변경 없음.

## Approach

1. 루트 `.nvmrc`에 `24` 기록 (CI/engines와 동일 major, 과도한 patch pin 지양).
2. KO troubleshooting에 "로컬 검증" 섹션 추가; EN quick guide도 동일 요점 보강.
3. AGENTS.md §3.1 Gotchas에 Docker/로컬 Node 정합 한 줄(`.nvmrc` + PATH 주의) 추가.

## Test Strategy

Constitution structural/docs exception: 문서·설정 파일이므로 CI 기존 스위트가 회귀 신호. 수동: `node -v`, `cat .nvmrc`.

## Risks

- Cursor/agent PATH가 nvm을 가리면 `.nvmrc`만으로는 자동 전환이 안 됨 → 문서에 명시.
