# CI test:ci 타임아웃·지연 대응 가이드

GitHub Actions에서 테스트가 오래 걸리거나 타임아웃으로 통과하지 못할 때의 **근본적 해결**과 보조 대안을 정리한 문서입니다.

## 근본적 해결 (현재 적용)

**원칙**: 시간을 늘리거나 테스트를 스킵하는 것은 회피에 불과함. **실행 구조를 바꿔** wall-clock 시간을 줄이고 중복을 제거함.

### 1. 패키지별 병렬 job 분할

- **이전**: 한 개의 test job에서 `lint → type-check → test:ci(전체 436+) → build → test:ci(client)` 순차 실행.  
  → client 테스트가 루트 `test:ci`에 이미 포함되어 있는데 이어서 한 번 더 실행되는 **중복** 발생.  
  → 총 소요 시간 = lint + typecheck + (전체 테스트) + build + (client만 다시).

- **현재**: 
  - **lint-typecheck**: lint + 콘솔/retry 검사 + type-check (한 job).
  - **test-root**, **test-core**, **test-server**, **test-client**, **test-search-quality**: 위 job 통과 후 **동시에** 5개 테스트 job 실행.
  - 각 테스트 job은 **해당 영역만** 실행 (`test:ci:root`, `test:ci:core`, `test:ci:server`, `test:ci -w @memento/client`, `test:vector-search-quality:ci`).
  - **중복 제거**: 루트 test:ci로 “전체”를 한 번에 돌리지 않고, 영역별로 나눠 한 번씩만 실행.
  - **test-search-quality** (#665): 랭킹·벡터 검색 benchmark 회귀 감지. 랭킹 가중치 변경 PR에서 실패 시 merge 차단.
  - **nightly category-report** (#731): 매주 `quality:benchmark:category-report`를 실행하고, 필수 카테고리의 평가 가능한 Ground Truth가 없거나 MRR이 하나라도 0.5 미만이면 실패.

- **효과**:  
  - 총 소요 시간 ≈ **lint-typecheck 시간 + max(test-root, test-core, test-server, test-client)**.  
  - 이전처럼 “전체 테스트 + client 한 번 더”가 아니라, 가장 느린 하나의 테스트 job 시간만큼만 추가됨.

### 2. 사용 스크립트

- `test:ci` — 로컬에서 전체 한 번에 실행할 때 (기존과 동일).
- `test:ci:root` — 루트 `tests/` 전용 (Vitest).
- `test:ci:core` — `packages/memento-core/src/`.
- `test:ci:server` — `packages/memento-server/src/`.
- 클라이언트 — CI에서는 `npm run build` 후 `npm run test:ci -w @memento/client` 한 번만 실행.

### 3. job별 타임아웃

- lint-typecheck: 15분  
- test-root / test-core: 각 45분  
- test-server: 20분  
- test-client: 25분 (build 포함)  
- test-search-quality: 45분 (`test:vector-search-quality:ci` + `quality:benchmark:category-report`, JUnit/JSON 리포트)

필요 시 각 job의 `timeout-minutes`만 조정하면 됨.

### 4. Vitest CI exclude inventory (`vitest.config.ts` L49–62)

PR job(`test:ci:*`)은 `CI=true`일 때 아래 패턴을 **자동 제외**합니다.  
**만료 정책**: 2026-09-01까지 분기별(또는 exclude 변경 시) 재검토. 만료 전에 PR gate 복원 또는 nightly subset 확대 여부를 결정합니다.

| 패턴 | 제외 대상 | 사유 | 대체 job / 실행 경로 | 검토 만료 |
|------|-----------|------|----------------------|-----------|
| `**/test/**/*db*.{test,spec}.{js,ts}` | DB 직접 접근 테스트 | wall-clock·SQLite 의존 | `nightly-tests.yml` → `test-integration-subset` | 2026-09-01 |
| `**/test/**/*database*.{test,spec}.{js,ts}` | database 명명 테스트 | 동일 | nightly integration subset | 2026-09-01 |
| `**/test/**/*integration*.{test,spec}.{js,ts}` | 통합 테스트 | 느림·환경 의존 | nightly `test-integration-subset` (핵심 3건 직접 실행) | 2026-09-01 |
| `**/test/**/*m1*.{test,spec}.{js,ts}` | M1 마일스톤 스위트 | 레거시·무거움 | nightly 확대 후보 (미포함) | 2026-09-01 |
| `**/test/**/*performance*.{test,spec}.{js,ts}` | 성능 벤치마크 | 변동·시간 | 로컬 / 수동 benchmark | 2026-09-01 |
| `**/test/**/*error-handling*.{test,spec}.{js,ts}` | 에러 핸들링 E2E | 긴 tail 시나리오 | nightly 확대 후보 | 2026-09-01 |
| `packages/memento-core/src/domains/monitoring/services/quality-assurance/*.spec.ts` | QA 모니터링 스위트 | CI wall-clock | 로컬 `vitest` 직접 실행 | 2026-09-01 |
| `**/migration-runner.integration.spec.ts` | 마이그레이션 통합 | DB·스키마 전체 | nightly `test-integration-subset` | 2026-09-01 |

**환경 변수 스킵** (workflow `env`, PR 기본값):

| 변수 | PR (`ci.yml`) | Weekly (`nightly-tests.yml`) |
|------|---------------|------------------------------|
| `SKIP_DB_TESTS` | `true` | `false` |
| `SKIP_INTEGRATION_TESTS` | `true` | `false` |

**검색 품질 benchmark**는 exclude 대상이 아니며, PR gate **`test-search-quality`** job에서 `npm run test:vector-search-quality:ci`로 항상 실행합니다 (#665).
카테고리 리포트도 Vitest exclude 대상이 아니며 weekly **`nightly-tests.yml`**의 `test-search-quality` job에서 별도 blocking gate로 실행합니다 (#731). 이 gate를 PR로 승격할지, nightly 범위를 조정할지는 exclude inventory와 함께 **2026-09-01**까지 재검토합니다.

---

## 현황 참고

- **테스트 규모**: 루트 `tests/` 약 225, memento-core 약 197, memento-server 13, memento-client 1 (총 약 436).
- **이미 적용된 완화**: `SKIP_DB_TESTS`, `SKIP_INTEGRATION_TESTS`, `vitest.config.ts`의 CI 전용 exclude(일부 db/integration/performance 등).

---

## 원인 파악 (실패 시)

1. **실패 유형**: Actions 로그에서  
   - Job/Step **timeout**  
   - 특정 **테스트 실패**  
   - **OOM / Runner killed**  
   구분.
2. **아티팩트**: 각 테스트 job은 실패 시 `test-results-*` 아티팩트를 업로드하므로, 어떤 영역에서 실패했는지·어떤 테스트가 느린지 확인 가능.

---

## 보조적 대안 (추가로 필요할 때)

- **Vitest CI 최적화**: OOM이 나면 `maxWorkers` 축소, `pool: 'threads'` 유지.
- **CI 전용 exclude 확대**: 벤치마크·매우 무거운 스위트만 CI에서 추가 제외 (가능하면 최소한으로).
- **변경 기반 선택 테스트**: `vitest --changed` 또는 turbo/Nx로 변경된 패키지·파일만 테스트 (도입 시 문서/스크립트 정리 필요).

---

## 참고

- GitHub Actions: [Job timeout](https://docs.github.com/en/actions/learn-github-actions/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes)
- Vitest: [Configuration](https://vitest.dev/config/), [Pool options](https://vitest.dev/guide/features.html#pool-options)
