# Quickstart: Validate FTS OR + prefix* (#807)

**Feature**: `specs/660-807-fts-or-prefix`  
**Purpose**: Runnable checks that the shared FTS query builder emits OR+prefix and that short multi-concept queries get non-zero text candidates — without deploying.

## Prerequisites

- Node.js ≥24 (`nvm use` / `.nvmrc`)
- `npm install` at repo root
- Optional: local DB for live counts (do **not** commit LoCoMo / production dumps)

See also: [contracts/fts-query-combinator.md](./contracts/fts-query-combinator.md), [research.md](./research.md)

## 1. Unit — query builder (required)

```bash
cd /home/jee1lee/orca/workspaces/memento/fix-search-fts-and-or-prefix-ablation
npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts
```

**Expect** (after implementation):

- Short multi-token query string contains ` OR ` and `*` on stems with length ≥ 2  
- 1-character stem has **no** trailing `*`  
- Long query still contains ` OR `, respects max token cap, and prefixes eligible stems  
- Empty / stopword-only still yields existing empty sentinel behavior  
- Punctuation / fake operators do not appear as FTS operators

## 2. Regression — text candidates > 0 (required when fixture lands)

```bash
# Path may match tasks.md; example:
npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/fts-or-prefix-candidates.spec.ts
```

**Expect**: Synthetic corpus where no single memory contains all query terms → `text_candidate_count > 0` and partial-match memories included. Morphology fixture: body has 조사-fused token, query is stem → memory in text candidates.

## 3. Docs sanity

```bash
rg -n "짧은 AND|FTS_OR_ABOVE|prefix" docs/agents/search-ranking.md
```

**Expect**: Combinator paragraph describes short OR + prefix*, not “짧은 AND”.

## 4. Ablation record

Fill [fts-query-ablation.md](./fts-query-ablation.md) with measured rows before flipping the default in review. If precision not absorbed → **reject** and keep prior behavior (note reason).

## 5. Optional English gate

Use the existing nightly / approved bench command already used for search quality (do not invent a new threshold). Record pass/fail in the ablation table.

## 6. Completion gates

```bash
npm run lint && npm run type-check
# targeted tests above, then broader search suite as needed
npm test -- packages/memento-core/src/domains/search/
# after production code changes:
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```
