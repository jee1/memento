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
  - **test-root**, **test-core**, **test-server**, **test-client**, **test-agent-integration**, **test-assistant**, **test-scripts**: 위 job 통과 후 **동시에** 7개 테스트 job 실행.
  - 각 PR 테스트 job은 **해당 영역만** 실행 (`test:ci:root`, `test:ci:core`, `test:ci:server`, client/agent-integration/assistant workspace의 `test:ci`, `test:ci:scripts`).
  - **중복 제거**: 루트 test:ci로 “전체”를 한 번에 돌리지 않고, 영역별로 나눠 한 번씩만 실행.
  - **weekly test-search-quality** (#665, #731): `nightly-tests.yml`에서 매주 `npm run test:vector-search-quality:ci`와 `npm run quality -- benchmark category-report`를 실행한다. 필수 카테고리의 평가 가능한 Ground Truth가 없거나 MRR이 하나라도 0.5 미만이면 nightly job이 실패하며, 현재 PR merge gate는 아님.

- **효과**:  
  - 총 소요 시간 ≈ **lint-typecheck 시간 + max(7개 병렬 테스트 job의 실행 시간)**.
  - 이전처럼 “전체 테스트 + client 한 번 더”가 아니라, 가장 느린 하나의 테스트 job 시간만큼만 추가됨.

### 2. 사용 스크립트

- `test:ci` — 로컬에서 전체 한 번에 실행할 때 (기존과 동일).
- `test:ci:root` — 루트 `tests/` 전용 (Vitest).
- `test:ci:core` — `packages/memento-core/src/`.
- `test:ci:server` — `packages/memento-server/src/`.
- 클라이언트 — CI에서는 `npm run build` 후 `npm run test:ci -w @jee1/memento-client` 한 번만 실행.
- 에이전트 통합 — `npm run test:ci -w @memento/agent-integration`.
- 어시스턴트 — 필요한 workspace dist와 client를 빌드한 뒤 `npm run test:ci -w @jee1/memento-assistant`.
- 운영 스크립트 — core를 빌드한 뒤 `npm run test:ci:scripts`.

### 3. job별 타임아웃

- lint-typecheck: 15분  
- test-root / test-core: 각 45분  
- test-server / test-agent-integration / test-scripts: 각 20분
- test-client / test-assistant: 각 25분 (필요한 build 포함)
- weekly test-search-quality: 45분 (`npm run test:vector-search-quality:ci` + `npm run quality -- benchmark category-report`, JUnit/JSON 리포트; `nightly-tests.yml`)

필요 시 각 job의 `timeout-minutes`만 조정하면 됨.

### 4. Vitest CI exclude inventory (`vitest.base.ts`)

공통 설정은 일반 CI에서 **`**/*.nightly.spec.ts`만 자동 제외**합니다. `VITEST_INCLUDE_NIGHTLY=1`이면 이 제외도 해제됩니다. 파일명에 `db`, `database`, `integration`, `performance`, `m1`, `error-handling`이 들어간 일반 spec은 별도 패턴으로 제외하지 않으며 PR의 해당 영역 job에서 수집됩니다.

`ci.yml`은 현재 `SKIP_DB_TESTS=true`, `SKIP_INTEGRATION_TESTS=true`를 환경 변수로 제공하지만, 이는 Vitest 수집 제외 패턴이 아닙니다. 개별 spec이 그 변수를 명시적으로 읽어 skip하도록 작성된 경우에만 해당 spec 내부 동작에 영향을 줍니다.

**검색 품질 benchmark와 카테고리 리포트**는 weekly **`nightly-tests.yml`**의 `test-search-quality` job에서 각각 `npm run test:vector-search-quality:ci`와 `npm run quality -- benchmark category-report`로 실행합니다 (#665, #731). 현재 PR merge gate는 아니며, PR로 승격할지나 nightly 범위를 조정할지는 exclude inventory와 함께 **2026-09-01**까지 재검토합니다.

---

## 현황 참고

- **PR 테스트 토폴로지**: `lint-typecheck` 뒤 root/core/server/client/agent-integration/assistant/scripts 7개 영역 job을 병렬 실행.
- **CI 전용 파일 제외**: 일반 PR 수집에서는 `*.nightly.spec.ts`만 제외하며, ordinary DB·integration·performance spec은 수집 대상.

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
