# Quickstart: verify scripts allowlist

```bash
# Unit
npm test -- scripts/lib/npm-pack-scripts-allowlist.spec.ts

# Full pack gate (includes allowlist + #860 DB smoke)
npm run verify-pack-bundle

# Skip empty-temp only (allowlist still runs)
MEMENTO_PACK_SMOKE=0 npm run verify-pack-bundle
```

Expected: no `package/scripts/**/*.ts` in packed tarball; only the three allowed script files.
