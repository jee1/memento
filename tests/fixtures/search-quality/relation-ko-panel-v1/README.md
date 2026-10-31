# relation-ko-panel-v1 (#1555)

관계 BFS 검색 효용 측정용 **합성** 한국어 패널. agent_panel gold 75건 동결(2차 판정). 사람 gold 아님.

산출물: `reviewer-a|b/answers.json`, `ground-truth.json`, `panel-result.json`, `fixture-seals.json`, `protocol.md`.

재생성(개발용):

```bash
npx tsx scripts/generate-relation-ko-panel-v1.ts
```

검증:

```bash
npx vitest run tests/relation-ko-panel-fixture.spec.ts
```
