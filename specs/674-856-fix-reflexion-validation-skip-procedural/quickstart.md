# Quickstart: verify #856 fix

```bash
# Focused regression
npm test -- packages/memento-core/src/tools/__tests__/base-tool-handle-failure-validation.spec.ts
npm test -- packages/memento-core/src/domains/monitoring/services/__tests__/failure-detector.spec.ts
npm test -- packages/memento-core/src/infrastructure/__tests__/reflexion-reflection-recorder-task-goal.spec.ts

# Gates
npm run lint && npm run type-check
```

Manual smoke (optional): MCP `remember` without `type` → reject, no new
`Reflexion: remember 실패 기록` row with truncated content as `task_goal`.
