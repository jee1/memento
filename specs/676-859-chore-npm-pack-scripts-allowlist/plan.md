# Implementation Plan: npm tarball scripts allowlist

**Branch**: `feature/chore-build-files-scripts-tarball-.ts-130` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/676-859-chore-npm-pack-scripts-allowlist/spec.md`
**Issue**: [#859](https://github.com/jee1/memento/issues/859)

## Summary

루트 `package.json` `files` 의 `"scripts"` 디렉터리 항목을 **설치된 패키지 런타임에 필요한 파일만**으로 바꾼다.
이슈 초안 + #860 클로저:

```json
"files": [
  "dist",
  "scripts/auto-setup.js",
  "scripts/lib/cli-runtime.js",
  "scripts/lib/postinstall-db-init.js",
  "prompts",
  "config",
  "README.md", "README.en.md", "INSTALL.md", "INSTALL.en.md",
  "LICENSE", "package.json", "package-lock.json"
]
```

`scripts/lib/npm-pack-scripts-allowlist.js` 에 허용 경로 상수와 `findDisallowedScriptPaths(paths)` 를 두고,
`verify-npm-pack-bundle.js` 가 tarball 엔트리 검사 직후 호출해 위반 시 비0.
단위 테스트로 RED→GREEN 후 `files` 축소 → `verify-pack-bundle` 통합 확인.

## Technical Context

**Language/Version**: Node.js ≥24, ESM JavaScript  
**Primary Dependencies**: 없음 (신규 패키지 금지)  
**Storage**: N/A  
**Testing**: Vitest (`scripts/lib/*.spec.ts`), `node scripts/verify-npm-pack-bundle.js`  
**Target Platform**: npm pack / publish CI  
**Project Type**: root package packaging hygiene  
**Performance Goals**: N/A  
**Constraints**: #857 no `.ts` in postinstall path; #860 DB smoke 유지; graphify if shipping scripts change  
**Scale/Scope**: ~3–4 files (`package.json`, allowlist module + spec, `verify-npm-pack-bundle.js`)

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | allowlist 순수 함수 TDD; `files` 변경은 게이트가 RED로 고정한 뒤 |
| Backward compatibility MCP | II (MUST) | PASS | MCP 계약 불변; install runtime scripts 유지 |
| Schema/migration | III (MUST) | N/A | DB 스키마 없음 |
| Quality gates | IV (MUST) | PASS | lint / type-check / 관련 test + verify-pack-bundle; graphify on shipped script change |
| Observability | V (SHOULD) | PASS | 위반 경로를 stderr 로 나열 |
| Additional Constraints | | PASS | Node 24 ESM; no LoCoMo |

## Project Structure

### Documentation (this feature)

```text
specs/676-859-chore-npm-pack-scripts-allowlist/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
├── checklists/
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
package.json                              # files allowlist
scripts/lib/npm-pack-scripts-allowlist.js # pure check + ALLOWED list
scripts/lib/npm-pack-scripts-allowlist.spec.ts
scripts/verify-npm-pack-bundle.js         # call allowlist after tar parse
```

## Complexity Tracking

없음.

## Execution Strategy

1. TDD allowlist module (unit).
2. Wire into verify-npm-pack-bundle (still RED on real pack until files shrink — or unit green first then files).
3. Shrink `package.json` `files`.
4. Run verify-pack-bundle + targeted vitest.
5. Review vs spec; no commit/push unless asked.

Human checkpoints: user authorized full Speckit pipeline (`진행해줘` + canonical auto-advance).
