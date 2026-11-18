Changed
- 로컬 테스트 병렬 수를 코어의 1/4(2~6개)로 올리고(CI 는 2 유지, `VITEST_MAX_WORKERS` 로 조정), `*.nightly.spec.ts` 를 로컬에서도 기본 제외한다(`VITEST_INCLUDE_NIGHTLY=1` 로 포함). 바뀐 범위만 도는 `npm run test:changed` 를 더하고, 임시 경로를 `Date.now()` 만으로 짓던 테스트 13개 파일에 `process.pid` 를 더해 병렬 충돌을 막는다 (#1775)
