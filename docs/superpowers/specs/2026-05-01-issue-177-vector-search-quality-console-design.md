# Issue #177: `vector-search-quality-metrics.ts` console 제거

## 맥락

- 대상: `packages/memento-core/src/test/helpers/vector-search-quality-metrics.ts`
- slop-detector가 **실행 코드**의 `console.error` / `console.warn` / `console.log`(`printQualityAlert` 내)를 Critical로 보고함.
- 파일은 `src/test/helpers`이지만, 이슈 범위는 **콘솔 직접 호출 제거**이며 God 함수 분리는 별도 이슈로 미룸.

## 설계 결정

1. **`printQualityAlert`의 콘솔 출력**을 `@memento/core` 공용 `logger`(`shared/utils/logger.js`)로 교체한다.
   - `critical` → `logger.error`
   - `warning` → `logger.warn`
   - 그 외(info) → `logger.info`
2. **PII 마스킹·MCP 모드·CLI quiet**는 기존 `logger` 구현을 그대로 활용한다.
3. **통합 테스트**에서 `console` 스파이를 `logger` 스파이로 바꾸고, 감지 시 `warn`/`error`/`info` 중 하나 이상 호출되면 통과하도록 완화한다(심각도에 따라 분기).

## 대안 및 기각

| 접근 | 장점 | 단점 | 결론 |
|------|------|------|------|
| A. `logger` 사용 | 프로젝트 관례, 마스킹 일관 | `logger`가 `mcpLogger`에 의존 | **채택** |
| B. `process.stderr.write` 직접 | 의존 최소 | 관례 이탈, 마스킵 미적용 | 기각 |
| C. 출력 콜백 주입 | 테스트 용이 | 공개 API 변경 범위 큼 | 이슈 범위 초과 |

## 검증

- `packages/memento-core`에서 `test-vector-search-quality-with-consolidation` 관련 Vitest 통과
- `npm run lint` (해당 파일 포함)
