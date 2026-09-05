# Quickstart (verify #854 fix)

```bash
# focused regression
npm test -- packages/memento-core/src/shared/utils/__tests__/pii-masker-phone-boundary.spec.ts

# related existing phone coverage
npm test -- packages/memento-core/src/shared/utils/__tests__/pii-masker-integration.spec.ts \
  packages/memento-core/src/shared/utils/__tests__/pii-masker-env-control.spec.ts

# one-liner sanity (optional)
node --input-type=module -e '
import { PIIMasker } from "./packages/memento-core/dist/shared/utils/pii-masker.js";
console.log(PIIMasker.mask("mem_1788581911067_d7yc4k698").masked);
console.log(PIIMasker.mask("010-1234-5678").masked);
'
```

Expect: first line original id; second `[PHONE]`.
