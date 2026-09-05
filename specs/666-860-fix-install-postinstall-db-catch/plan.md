# Implementation Plan: 설치 패키지 postinstall DB 초기화 실패가 catch 에 삼켜짐

**Branch**: `feature/fix-install-postinstall-db-catch` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/666-860-fix-install-postinstall-db-catch/spec.md`
**Issue**: [#860](https://github.com/jee1/memento/issues/860)

## Summary

`scripts/auto-setup.js` 의 DB 초기화가 `npx tsx packages/memento-core/src/.../init.ts` 를 호출한다.
tarball 에 `packages/` 가 없으므로 설치 환경에선 항상 실패하고, `catch` 가 경고만 남긴 채 종료 0 으로 넘어간다.

기술 접근:

1. **단일 런타임 진입점**: `@memento/core` 의 `initializeDatabase` / `closeDatabase` 를 동적 import 후 호출 (Q2). `packages/.../init.ts` + `tsx` 제거.
2. **실패 시 비0**: 해당 단계 실패를 swallow 하지 않고 `main` 실패 경로로 올려 `process.exit(1)` (Q1). 저장소 전용 `npm run db:init` 안내 문구 제거·대체 (Q4).
3. **스모크**: `verify-npm-pack-bundle.js` empty-temp install 에 임시 `DB_PATH` 를 넣고, postinstall 후 파일 존재 assert (Q3). `MEMENTO_PACK_SMOKE=0` 스킵 유지 (FR-007).

`init.ts` CLI 가드가 `endsWith('init.ts')` 라 `node dist/.../init.js` spawn 은 호출되지 않음 → 함수 import 가 올바른 경로.

## Technical Context

**Language/Version**: Node.js ≥24, ESM JavaScript (`scripts/*.js`)
**Primary Dependencies**: `@memento/core` (bundled), `better-sqlite3` (native, existing postinstall path)
**Storage**: SQLite file at `DB_PATH` (default `~/.memento/memory.db`; smoke overrides)
**Testing**: Vitest (unit for helper + static guard), `node scripts/verify-npm-pack-bundle.js` (integration smoke)
**Target Platform**: npm install / postinstall on Linux CI and end-user machines
**Project Type**: root package `memento-mcp-server` postinstall + pack gate
**Performance Goals**: N/A — install-time one-shot
**Constraints**: postinstall must not import `.ts` (#857); no new deps; graphify rebuild if production JS changes under scripts (scripts are shipped)
**Scale/Scope**: ~2–3 files (`auto-setup.js`, optional `scripts/lib/*`, `verify-npm-pack-bundle.js`) + 1–2 specs

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED: helper/unit + smoke assert before/with fix |
| Backward compatibility MCP | II (MUST) | PASS | MCP tool contracts untouched |
| Schema/migration | III (MUST) | N/A | no schema change; uses existing init |
| Quality gates | IV (MUST) | PASS | lint / type-check / test; graphify if shipping script change |
| Observability | V (SHOULD) | PASS | fail loudly with error log + non-zero exit |
| Additional Constraints | | PASS | Node 24 ESM; no LoCoMo |

## Project Structure

### Documentation (this feature)

```text
specs/666-860-fix-install-postinstall-db-catch/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
├── checklists/requirements.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
scripts/
├── auto-setup.js                 # DB init path + fail-hard
├── lib/postinstall-db-init.js    # (optional extract) call @memento/core init
├── lib/postinstall-db-init.spec.ts
├── verify-npm-pack-bundle.js     # DB_PATH + file exists after smoke install
└── js-scripts-no-ts-import.spec.ts  # regression still green
```

## Complexity Tracking

없음.

## Execution Strategy

- TDD on extracted `postinstall-db-init` helper (unit) then wire `auto-setup.js`.
- Smoke change in `verify-npm-pack-bundle.js` after unit green.
- Phase checkpoints: Setup → Foundational(helper) → US1/US2 → US3 smoke → Polish gates.
- Human checkpoints: user authorized full pipeline (`진행해줘` + Speckit canonical auto-advance).
