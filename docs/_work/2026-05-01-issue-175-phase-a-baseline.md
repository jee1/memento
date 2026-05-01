# Issue #175 — Bootstrap refactor baseline

**Date:** 2026-05-01

## Issue #175 Phase A — baseline

`wc -l packages/memento-core/src/bootstrap.ts packages/memento-core/src/bootstrap/*.ts`

```text
  146 packages/memento-core/src/bootstrap.ts
   39 packages/memento-core/src/bootstrap/anchor-stack.ts
   52 packages/memento-core/src/bootstrap/batch-telemetry-relation.ts
   15 packages/memento-core/src/bootstrap/failure-reflexion.ts
   67 packages/memento-core/src/bootstrap/monitoring-schedulers.ts
  109 packages/memento-core/src/bootstrap/runtime-diagnostics-sampler.ts
   31 packages/memento-core/src/bootstrap/search-and-embedding.ts
   65 packages/memento-core/src/bootstrap/write-and-meta.ts
  524 합계
```

`sed -n '/export async function initializeServices/,/^}$/p' packages/memento-core/src/bootstrap.ts | wc -l`

```text
75
```

Phase B is deferred until the Phase A verification gate in Task 4 of `docs/superpowers/plans/2026-05-01-issue-175-bootstrap-verify.md` is satisfied.


## Quality gates (lint / type-check / test)

Commands run from worktree root on 2026-05-01.

### `npm run lint`

- **Exit code:** `0`
- **Errors:** ESLint reported **0 errors** (232 warnings total: `lint:ts` then `lint:js`).

Last ~30 lines of combined lint output:

```text
  3403:10  warning  Found existsSync from package "fs" with non literal argument at index 0     security/detect-non-literal-fs-filename
  3404:7   warning  Found mkdirSync from package "fs" with non literal argument at index 0      security/detect-non-literal-fs-filename
  3412:7   warning  Found writeFileSync from package "fs" with non literal argument at index 0  security/detect-non-literal-fs-filename
  3508:7   warning  Found writeFileSync from package "fs" with non literal argument at index 0  security/detect-non-literal-fs-filename

/home/jee1lee/git/memento/.worktrees/issue-175-bootstrap-refactor/scripts/check-legacy-script-usage.ts
   70:17  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp
  123:17  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp

/home/jee1lee/git/memento/.worktrees/issue-175-bootstrap-refactor/scripts/check-path-traversal.ts
  117:21  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp
  249:37  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp

/home/jee1lee/git/memento/.worktrees/issue-175-bootstrap-refactor/scripts/check-pii-masking.ts
  114:21  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp

/home/jee1lee/git/memento/.worktrees/issue-175-bootstrap-refactor/scripts/check-sql-injection.ts
  283:17  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp
  295:19  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp
  395:17  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp

/home/jee1lee/git/memento/.worktrees/issue-175-bootstrap-refactor/tests/integrations/smoke.spec.ts
  10:14  warning  Found non-literal argument to RegExp Constructor  security/detect-non-literal-regexp

✖ 232 problems (0 errors, 232 warnings)


> memento-mcp-server@1.17.0 lint:js
> eslint "static/js/**/*.js"

```

### `npm run type-check`

- **Exit code:** `0`
- **Result:** Pass — all workspace packages completed TypeScript checks (`@memento/core`, `memento-server`, `@memento/client`, `experimental-example`).

Full output (small run):

```text
> memento-mcp-server@1.17.0 type-check
> npm run type-check -w @memento/core && npm run type-check -w memento-server && npm run type-check -w @memento/client && npm run type-check -w experimental-example


> @memento/core@1.17.0 type-check
> tsc --declaration --emitDeclarationOnly


> memento-server@1.17.0 type-check
> tsc --noEmit


> @memento/client@0.1.0 type-check
> tsc --declaration --emitDeclarationOnly


> experimental-example@0.0.1 type-check
> tsc --noEmit
```

### `npm test`

- **Exit code:** `0`
- **Result:** Pass — Vitest **312** test files passed; **4122** tests passed, **1** skipped (**4123** total); duration **131.24s** (transform/collect/test phases as reported by Vitest).

Last ~30 lines of output:

```text
2026-05-01T05:32:46.849Z | INFO | [recall] Recall 도구 호출됨: | {"tool":"recall","message":"Recall 도구 호출됨","timestamp":"2026-05-01T05:32:46.849Z","params":{"query":"experimental-example","limit":5}}
2026-05-01T05:32:46.850Z | WARN | [recall] ⚠️  recall: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 향후 버전에서는 필수 파라미터가 됩니다.: | {"tool":"recall","message":"⚠️  recall: 'type' 파라미터가 지정되지 않았습니다. 기본값 'episodic'을 사용합니다. 향후 버전에서는 필수 파라미터가 됩니다.","timestamp":"2026-05-01T05:32:46.850Z"}
2026-05-01T05:32:46.850Z | INFO | [recall] 파라미터 파싱 완료: | {"tool":"recall","message":"파라미터 파싱 완료","timestamp":"2026-05-01T05:32:46.850Z","query":"experimental-example","type":"episodic","agent_id":"default","limit":5}
2026-05-01T05:32:46.850Z | WARN | [recall] memory_item 검색 시 agent_id 파라미터는 무시됩니다: | {"tool":"recall","message":"memory_item 검색 시 agent_id 파라미터는 무시됩니다","timestamp":"2026-05-01T05:32:46.850Z","agent_id":"default"}
2026-05-01T05:32:46.850Z | INFO | [recall] 하이브리드 검색 실행: | {"tool":"recall","message":"하이브리드 검색 실행","timestamp":"2026-05-01T05:32:46.850Z","query":"experimental-example","vectorWeight":0.6,"textWeight":0.4}
2026-05-01T05:32:46.851Z | DEBUG | 하이브리드 검색 시작 | {"searchId":"search_[PHONE]851_mskz82sl4","query":"experimental-example"}
2026-05-01T05:32:46.851Z | DEBUG | 하이브리드 검색 단계: 적응형 가중치 계산 완료 | {"searchId":"search_[PHONE]851_mskz82sl4","data":{"vectorWeight":0.6,"textWeight":0.4,"originalVector":0.6,"originalText":0.4}}
2026-05-01T05:32:46.851Z | DEBUG | 하이브리드 검색 단계: 텍스트 검색 시작 | {"searchId":"search_[PHONE]851_mskz82sl4","data":{"query":"experimental-example"}}
[2026-05-01T05:32:46.852Z] [SERVER] [INFO] FTS5 사용 가능
2026-05-01T05:32:46.854Z | DEBUG | 하이브리드 검색 단계: 텍스트 검색 완료 | {"searchId":"search_[PHONE]851_mskz82sl4","data":{"resultCount":1,"searchTime":"2.89ms"}}
2026-05-01T05:32:46.854Z | DEBUG | 하이브리드 검색 단계: 벡터 검색 시작 | {"searchId":"search_[PHONE]851_mskz82sl4","data":{"query":"experimental-example","embeddingAvailable":true}}
[2026-05-01T05:32:46.855Z] [SERVER] [INFO] VEC (Vector Search) 사용 가능
2026-05-01T05:32:46.856Z | DEBUG | 하이브리드 검색 단계: VEC 벡터 검색 - 검색할 provider 없음 | {"searchId":"search_[PHONE]851_mskz82sl4","data":{"detectedProviders":[],"providerFilter":[]}}
2026-05-01T05:32:46.858Z | INFO | 하이브리드 검색 완료 | {"searchId":"search_[PHONE]851_mskz82sl4","resultCount":1,"queryTime":6.958088}
2026-05-01T05:32:46.859Z | INFO | [recall] 검색 완료: | {"tool":"recall","message":"검색 완료","timestamp":"2026-05-01T05:32:46.859Z","resultCount":1,"executionTime":8,"searchType":"hybrid"}
❌ MiniLM 임베딩 생성 실패: model is not a function
[2026-05-01T05:32:46.865Z] [SERVER] [INFO] VEC (Vector Search) 사용 가능
2026-05-01T05:32:46.867Z | WARN | [remember] 기존 기억 조회 실패: | {"tool":"remember","message":"기존 기억 조회 실패","timestamp":"2026-05-01T05:32:46.867Z","error":"no such column: embedding"}
2026-05-01T05:32:46.868Z | INFO | [remember] 테스트 환경: Triple 추출 작업을 즉시 실행합니다: | {"tool":"remember","message":"테스트 환경: Triple 추출 작업을 즉시 실행합니다","timestamp":"2026-05-01T05:32:46.868Z","memory_id":"mem_[PHONE]833_6xd74ws0o","job_name":"triple_extraction_mem_[PHONE]833_6xd74ws0o"}
2026-05-01T05:32:46.894Z | INFO | LLM provider initialized | {"preferredProvider":"ollama","llmModel":"llama3","initializedProviders":["openai","gemini","ollama"]}
2026-05-01T05:32:46.894Z | INFO | TripleExtractionService: LLM 클라이언트 초기화 완료 | {"preferredProvider":"ollama","initializedProviders":["openai","gemini","ollama"]}
2026-05-01T05:32:46.895Z | INFO | [remember] Triple 추출 완료 (Triple 없음): | {"tool":"remember","message":"Triple 추출 완료 (Triple 없음)","timestamp":"2026-05-01T05:32:46.894Z","memory_id":"mem_[PHONE]833_6xd74ws0o","failure_reason":"llm_unavailable","retry_count":1}
2026-05-01T05:32:47.015Z | WARN | telemetry write failed | {"error":"The database connection is not open"}
 ✓ apps/experimental-example/src/index.spec.ts  (1 test) 270ms

 Test Files  312 passed (312)
      Tests  4122 passed | 1 skipped (4123)
   Start at  14:30:35
   Duration  131.24s (transform 5.45s, setup 3.25s, collect 33.02s, tests 158.65s, environment 70ms, prepare 23.93s)

```

**Overall:** PASS
