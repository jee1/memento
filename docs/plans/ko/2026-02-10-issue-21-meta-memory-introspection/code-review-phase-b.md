# 이슈 #21 Phase B — 코드 리뷰

**브랜치**: `feat/issue-21-phase-b-introspection-signal`  
**기준**: `main` 대비 1 commit (8d16ea5)  
**리뷰 일자**: 2026-03-15

---

## 1. 요약

Phase B에서 **introspection_hint**(recall·get_meta_memory_stats)와 **get_introspection_summary** 도구, **IntrospectionScanCache** 및 배치 스케줄러 연동이 구현되었다. 명세(spec-phase-b.md) 및 tasks.md와 일치하며, 테스트와 타입·의존성 주입이 잘 정리되어 있다.

---

## 2. 명세·요구사항 준수

| 요구사항 | 상태 | 비고 |
|----------|------|------|
| REQ-PB-1 recall에 introspection_hint | ✅ | 저신뢰/고실패 1건 이상일 때만 포함 |
| REQ-PB-2 get_meta_memory_stats에 hint | ✅ | 동일 조건 |
| REQ-PB-3 hint는 캐시에서만 | ✅ | 매 요청 runScan 호출 없음 |
| REQ-PB-4 hint 스키마 (summary, low_confidence_count, high_failure_count, scanned_at) | ✅ | summary에 권장 문구 추가 |
| REQ-PB-5 get_introspection_summary 도구 | ✅ | 캐시 기반 반환 |
| REQ-PB-6 반환 형식 (요약·ID 목록·scanned_at) | ✅ | 캐시 비어 있으면 안내 메시지 |
| REQ-PB-7 캐시 비어 있으면 runScan으로 채우지 않음 | ✅ | 빈 결과/안내만 반환 |
| 스케줄 기반 캐시 | ✅ | runMetaMemoryIntrospection 성공 시만 set |

---

## 3. 강점

- **관심사 분리**: 캐시(IntrospectionScanCache), 스케줄러(캐시 set), 도구(캐시 get·hint 부여) 역할이 명확하다.
- **선택적 의존성**: `context.services?.introspectionScanCache`로 캐시 미제공 시에도 동작하며, get_introspection_summary는 캐시 없을 때 안내 메시지로 응답한다.
- **스키마 일관성**: `MetaMemoryIntrospectionScanResult` 타입을 그대로 사용해 스캔 결과와 캐시·도구 응답이 맞춰져 있다.
- **테스트**: 캐시 get/set/clear, 도구 정의·캐시 없음·캐시 있음 시나리오를 단위 테스트로 커버한다.
- **문서화**: Issue #21 Phase B 주석과 bootstrap/tools/types의 JSDoc으로 의도가 드러난다.

---

## 4. 개선 제안

### 4.1 Minor: hint summary 중복 문구

**위치**: `recall-tool.ts`, `get-meta-memory-stats-tool.ts`

`cachedScan.result.summary`에 이미 요약이 있는데, 두 도구 모두 동일하게 `" 자세한 내용은 get_introspection_summary 호출 권장."`을 이어 붙이고 있다. 명세의 “summary: LLM이 그대로 사용할 수 있는 한 문장”과는 맞고, 현재도 문제는 없으나 나중에 문구 변경 시 두 곳을 같이 수정해야 한다.

**제안**: 공통 유틸로 한 번만 정의해 두거나, 상수로 빼 두면 유지보수에 유리하다.

```ts
// 예: shared/constants 또는 도메인 내
const INTROSPECTION_HINT_SUFFIX = ' 자세한 내용은 get_introspection_summary 호출 권장.';
```

### 4.2 Minor: IntrospectionScanCache 동시성

**위치**: `introspection-scan-cache.ts`

캐시는 단일 필드 대입(`this.cached = { result, scanned_at }`)으로, Node 단일 스레드에서는 race가 없다. 다만 `runMetaMemoryIntrospection`(스케줄러)이 set하는 동안 다른 요청이 get하면 이전 스냅샷을 보게 되므로, “최근 완료된 스캔” 기준으로는 이미 올바른 동작이다. 별도 lock은 필요 없어 보이고, 문서에 “프로세스 내 메모리, 재시작 시 비어 있음”만 명시된 것도 적절하다.

**제안**: 변경 없음. 다만 배치와 도구가 다른 프로세스에 분리되는 구조가 생기면 캐시 공유 방식(예: Redis)을 다시 설계할 필요는 있음.

### 4.3 Minor: get_introspection_summary 응답 키 일관성

**위치**: `get-introspection-summary-tool.ts`

도구 응답은 `lowConfidenceMemoryIds`, `highFailureMemoryIds`, `scanned_at`(스네이크 아님)을 쓰고, introspection_hint는 `low_confidence_count`, `high_failure_count`, `scanned_at`을 쓴다. 명세에서 hint는 “low_confidence_count, high_failure_count”로 정의되어 있으므로 hint 쪽은 맞고, get_introspection_summary는 ID 목록을 주므로 camelCase 유지가 타입/기존 스캔 결과와도 맞다. 다만 API 사용처에서 “한쪽은 snake_case, 한쪽은 camelCase”를 인지해야 한다.

**제안**: 명세(spec-phase-b.md) 또는 API 문서에 “get_introspection_summary는 camelCase, recall/get_meta_memory_stats의 introspection_hint는 low_confidence_count 등 snake_case”라고 한 줄 적어 두면 좋다.

### 4.4 Nice-to-have: 캐시 미설정 시 로그

**위치**: `get-introspection-summary-tool.ts`

캐시가 없을 때 “스캔 결과가 없습니다…” 메시지로 충분히 안내되고 있다. 디버깅 시 “캐시 인스턴스가 아예 없음”과 “캐시는 있지만 비어 있음”을 구분하고 싶다면, `context.services?.introspectionScanCache`가 없을 때만 debug 수준 로그를 남기는 정도를 고려할 수 있다. 필수는 아니다.

---

## 5. 종합 평가

- **Merge 권장**: 그대로 머지해도 무방하다.
- **필수 수정**: 없음.
- **권장 (반영 완료)**: 4.1 summary 접미사 → `shared/constants/introspection-constants.ts`의 `INTROSPECTION_HINT_SUFFIX`로 추출함. 4.3 명세에 API 네이밍(snake vs camel) 문단 추가함.

Phase B 범위(캐시, hint, get_introspection_summary, 스케줄 연동)는 명세와 tasks를 잘 반영했고, 테스트와 타입으로 품질이 확보되어 있다.
