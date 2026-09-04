# Quickstart: #811 verification

```bash
npm run build
npm run memory:repair-triple-sentences   # dry-run; no named-export SyntaxError

# Targeted tests (adjust paths if tasks rename files)
npm test -- packages/memento-server/src/server/utils/mcp-tool-call-error.spec.ts
npm test -- packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts
npm test -- packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.spec.ts

npm run lint && npm run type-check
```

Diagnostic recall: pass `auto_set_anchor: false` (see `docs/agents/agent-workflow.md`).
