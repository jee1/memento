# Quickstart: verify #883 fixes

```bash
# Focused panel regressions
npm test -- packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
npm test -- packages/memento-server/src/server/dashboard-agent-sessions-panel.spec.ts

# Optional broader static contracts
npm test -- tests/static-design-contracts.spec.ts

# Gates before handoff
npm run lint && npm run type-check
```

Manual (optional, when Chromium available):

1. Review Queue: select A, throttle preview, select B — content/actions stay on B.
2. Agent Sessions: switch A→B quickly — detail stays B.
3. Resize to 390×844 — Anchor Map height > 0; tabs scrollable.
4. Sign in — sign-in form not visible alongside sign-out.
