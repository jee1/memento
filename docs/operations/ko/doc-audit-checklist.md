# 문서 전수 검수 체크리스트

스펙: [doc-sync-automation-design.md](../../superpowers/specs/2026-05-03-doc-sync-automation-design.md)

각 항목은 처리 시 `[x]`로 표시한다. 보류 시 이슈 번호를 옆에 적는다.

## 사람 유지 문서 (SSOT)

- [ ] 루트 `README.md`, `README.en.md`
- [ ] `docs/README.md`
- [ ] `AGENTS.md`, `DEVELOPMENT_RULES.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `GEMINI.md`
- [ ] `CHANGELOG.md` (릴리스 절차와 모순 없는지)
- [ ] `docs/guides/` (ko/en)
- [ ] `docs/api/` (ko/en)
- [ ] `docs/architecture/`, `docs/operations/`, `docs/reference/`, `docs/integrations/`
- [ ] `packages/*/README.md`, `apps/*/README.md`
- [ ] `docs/superpowers/specs/`, `docs/superpowers/plans/` (제품 문서와 충돌 시 제품 문서 우선)

## 생성·파생 문서

- [ ] `graphify-out/` — 재생성 후 diff만 반영, 임의 수동 편집 최소화
- [ ] `packages/memento-core/graphify-out/` — 동일

## 마무리

- [ ] `npm run docs:audit-links` 통과
- [ ] `npm run docs:verify-npm-scripts` 통과 (오탐이면 스크립트 상단 ALLOWLIST에 경로·스크립트명 근거와 함께 추가)
- [ ] PR 본문에 워크플로 문서의 요약 항목 포함
