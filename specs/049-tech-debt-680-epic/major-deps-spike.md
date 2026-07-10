# Major Dependency Upgrade Spike (TD-010 / #691)

**Status**: Deferred — spike notes only (no version bumps in this epic)

## Candidates

| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| vitest | 3.2.x | 4.1.x | Config API, coverage reporter |
| eslint | 8.57 | 10.x | Flat config required |
| zod | 3.25 | 4.x | Schema API breaks |
| openai | 4.x | 6.x | Client surface |
| typescript | 5.9 | 7.x | Compiler / lib |

## Recommended order

1. **vitest 4** — isolated branch, run full `npm test`, fix breaking reporter hooks
2. **eslint 10** — migrate to flat `eslint.config.js`, drop legacy `.eslintrc`
3. **@types/node 26** — align with Node 24+ runtime
4. **zod 4 + openai 6** — domain-by-domain schema migration

## Acceptance for future PR

- [ ] Dedicated issue per major (not bundled)
- [ ] CI green on all workspaces
- [ ] CHANGELOG breaking-deps section
