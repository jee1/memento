# Quickstart: Epic #785 spec artifacts

구현은 `tasks.md` Phase 3부터. 이 문서는 재현·검증 명령만 적는다.

```bash
# 계약 테스트 (CI)
npm test -- \
  packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts \
  packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts \
  scripts/agent-memory-production-adapter.spec.ts \
  scripts/agent-memory-benchmark.spec.ts \
  npm run quality:locomo:test

# 합성 production 경로
npm run quality:agent-memory:production

# 로컬 LoCoMo 1,536 (원본 커밋 금지, 단독 실행)
npm run quality:locomo:acquire
npm run build -w @memento/core
npx tsx scripts/agent-memory-benchmark.ts \
  --locomo .local/locomo/locomo10.json \
  --production \
  --output docs/_work/testing/locomo/latest/results.json
```

Gate (동일 fixture, injection 전략이 사용자 대면 기준): Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, category 회귀 없음.
