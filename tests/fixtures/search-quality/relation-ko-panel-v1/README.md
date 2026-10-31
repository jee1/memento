# relation-ko-panel-v1 (#1555 1단계 재생성)

관계 BFS 검색 효용 측정용 **합성** 한국어 패널. agent_panel gold 없음(1차 75/75 판정본 폐기, protocol 참고).

재생성(개발용):

```bash
npx tsx scripts/generate-relation-ko-panel-v1.ts
```

검증:

```bash
npx vitest run tests/relation-ko-panel-fixture.spec.ts
```
