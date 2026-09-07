# Quickstart: verify #925 gate

```bash
# Unit tests (primary)
npm test -- scripts/lib/production-audit-report.spec.ts

# File-arg smoke with error fixture (expect non-zero)
node -e 'require("fs").writeFileSync("/tmp/audit-err.json", JSON.stringify({error:{code:"E503",summary:"audit service unavailable"}}))'
node scripts/check-production-audit-fixable.mjs /tmp/audit-err.json; echo exit:$?

# Live production audit (may exit 0 with Accepted High if fixAvailable:false)
node scripts/check-production-audit-fixable.mjs
```
