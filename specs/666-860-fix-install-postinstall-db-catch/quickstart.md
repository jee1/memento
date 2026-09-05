# Quickstart: 666-860 verification

```bash
# Unit (helper + static guards)
npm test -- scripts/lib/postinstall-db-init.spec.ts scripts/js-scripts-no-ts-import.spec.ts

# Pack + empty-temp smoke including DB file assert
node scripts/verify-npm-pack-bundle.js

# Skip heavy smoke if needed
MEMENTO_PACK_SMOKE=0 node scripts/verify-npm-pack-bundle.js
```

Expect: after full smoke, log includes DB path OK; exit 0.
