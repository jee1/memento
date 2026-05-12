# 문서 전수 검수 체크리스트

스펙: [doc-sync-automation-design.md](../../superpowers/specs/2026-05-03-doc-sync-automation-design.md)

각 항목은 처리 시 `[x]`로 표시한다. 보류 시 이슈 번호를 옆에 적는다.

## 스냅샷 문서 (수정 금지)

아래는 **개발 당시 시점을 고정한 기록**이다. 전수 갱신·드리프트 정리 작업에서 **내용을 수정하지 않는다.** (후속 결정은 `docs/guides/` 등 살아 있는 문서나 새 이슈·새 경로의 기록으로 남긴다.)

- `docs/superpowers/specs/`, `docs/superpowers/plans/`
- 루트 `specs/`, 루트 `tasks/`

## 사람 유지 문서 (SSOT)

- [ ] 루트 `README.md`, `README.en.md`
- [ ] `docs/README.md`
- [ ] `AGENTS.md`, `DEVELOPMENT_RULES.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `GEMINI.md`
- [ ] `CHANGELOG.md` (릴리스 절차와 모순 없는지)
- [ ] `docs/guides/` (ko/en)
- [ ] `docs/api/` (ko/en)
- [ ] `docs/architecture/`, `docs/operations/`, `docs/reference/`, `docs/integrations/`
- [ ] `packages/*/README.md`, `apps/*/README.md`

## 생성·파생 문서

- [ ] `graphify-out/` — 재생성 후 diff만 반영, 임의 수동 편집 최소화
- [ ] `packages/memento-core/graphify-out/` — 동일

## 마무리

- [ ] `npm run docs:audit-links` 통과
- [ ] `npm run docs:verify-npm-scripts` 통과 (오탐이면 스크립트 상단 ALLOWLIST에 스크립트명 근거와 함께 추가)
- [ ] PR 본문에 워크플로 문서의 요약 항목 포함
