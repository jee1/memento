# 이슈 #21 Phase B — Task (원자 단위 작업)

SDD **Task** 단계 산출물. Phase B를 원자 단위(Atomic Unit) 작업으로 분해한 목록.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 메타-기억 자기 성찰 Phase B |
| **문서 유형** | TASK (원자 작업) |
| **기준 명세** | [spec-phase-b.md](./spec-phase-b.md) |
| **요구사항** | [requirements.md](./requirements.md) |

---

## 원자 작업 목록

각 작업은 한 가지 완료 조건·한 관심사를 가진다. 구현·리뷰 시 이 목록을 기준으로 한다.

### T-PB-1: 스캔 결과 캐시 도입

| 항목 | 내용 |
|------|------|
| **목표** | meta_memory_introspection job 실행 시 runScan 결과를 프로세스 내 캐시에 저장하고, scanned_at(ISO 8601)을 부여한다. |
| **산출물** | 캐시 저장소(인메모리)·BatchScheduler에서 runMetaMemoryIntrospection 성공 시 캐시 갱신 로직. |
| **명세 매핑** | REQ-PB-8, REQ-PB-9, UC-PB-3. |
| **완료 조건** | job 실행 후 캐시에 최신 스캔 결과와 scanned_at이 들어 있음. 단위 테스트 또는 통합 테스트로 검증. |

---

### T-PB-2: recall 응답에 introspection_hint 부여

| 항목 | 내용 |
|------|------|
| **목표** | recall 도구 응답 생성 시, 캐시를 읽어 저신뢰 또는 고실패가 1건 이상이면 최상위에 introspection_hint(summary, low_confidence_count, high_failure_count, scanned_at)를 붙인다. |
| **산출물** | recall-tool.ts 수정: 캐시 조회 → 조건 충족 시 hint 객체 추가. |
| **명세 매핑** | REQ-PB-1, REQ-PB-3, REQ-PB-4, UC-PB-1. |
| **완료 조건** | 저신뢰/고실패가 있을 때 recall 응답에 introspection_hint 포함; 0건일 때 미포함. AC-PB-1. |

---

### T-PB-3: get_meta_memory_stats 응답에 introspection_hint 부여

| 항목 | 내용 |
|------|------|
| **목표** | get_meta_memory_stats 도구 응답 생성 시, T-PB-2와 동일 조건·스키마로 introspection_hint를 붙인다. |
| **산출물** | get-meta-memory-stats-tool.ts 수정. |
| **명세 매핑** | REQ-PB-2, REQ-PB-3, REQ-PB-4, UC-PB-1. |
| **완료 조건** | 동일 조건으로 hint 포함. AC-PB-2. |

---

### T-PB-4: get_introspection_summary 도구 구현

| 항목 | 내용 |
|------|------|
| **목표** | MCP(및 HTTP) 도구 get_introspection_summary를 추가한다. 호출 시 캐시에서 최근 스캔 결과를 읽어 summary, lowConfidenceMemoryIds, highFailureMemoryIds, (선택)scanned_at을 반환한다. 캐시 비어 있으면 빈 결과 또는 안내. |
| **산출물** | get-introspection-summary-tool.ts(또는 동등), 도구 등록, MCP/HTTP 라우트 연동. |
| **명세 매핑** | REQ-PB-5, REQ-PB-6, REQ-PB-7, UC-PB-2. |
| **완료 조건** | 도구 호출 시 캐시 기반 결과 반환. 캐시 비어 있을 때 동작 정책 충족. AC-PB-3. |

---

### T-PB-5: 캐시 갱신·hint/도구 연동 검증

| 항목 | 내용 |
|------|------|
| **목표** | meta_memory_introspection job 실행 후 hint·get_introspection_summary가 새 스캔 결과를 반영하는지 검증한다. |
| **산출물** | 통합 테스트 또는 E2E: job 실행 → recall/get_meta_memory_stats/get_introspection_summary 호출 → 결과 일치. |
| **명세 매핑** | REQ-PB-8, AC-PB-4. |
| **완료 조건** | AC-PB-4 충족. |

---

### T-PB-6: 0건 시 hint 미포함(또는 정책) 검증

| 항목 | 내용 |
|------|------|
| **목표** | 저신뢰/고실패가 0건인 캐시 상태에서 recall·get_meta_memory_stats 호출 시 introspection_hint가 포함되지 않음(또는 명시적 0건 정책)을 검증한다. |
| **산출물** | 단위/통합 테스트. |
| **명세 매핑** | AC-PB-5. |
| **완료 조건** | AC-PB-5 충족. |

---

### T-PB-7: (선택) 실패 회피 규칙 스키마·저장·조회

| 항목 | 내용 |
|------|------|
| **목표** | failure_avoidance_rule 테이블(마이그레이션 018) 및 규칙 저장/조회 도구(또는 get_introspection_summary 확장)를 구현한다. 추출은 외부 LLM, Memento는 저장·조회만. |
| **산출물** | 018 마이그레이션, 저장 도구(예: add_failure_avoidance_rule), 조회 경로. |
| **명세 매핑** | REQ-PB-10, REQ-PB-11, UC-PB-4. |
| **완료 조건** | 규칙 등록·조회 가능. (Phase B 후반 또는 별도 PR.) |

---

### T-PB-8: 문서화 및 수용 기준 체크

| 항목 | 내용 |
|------|------|
| **목표** | Phase B 완료 시 spec-phase-b.md 수용 기준(AC-PB-1~5)이 모두 충족되었는지 체크하고, 필요 시 implementation-plan.md에 Phase B 섹션 또는 링크를 추가한다. |
| **산출물** | 체크리스트·구현 계획 보강. |
| **명세 매핑** | 전체 AC. |
| **완료 조건** | AC 항목별 검증 완료 기록. |

---

## 실행 순서 제안

1. T-PB-1 (캐시 도입)
2. T-PB-2, T-PB-3 (hint 부여)
3. T-PB-4 (get_introspection_summary)
4. T-PB-5, T-PB-6 (검증)
5. T-PB-7 (선택, 별도 또는 후반)
6. T-PB-8 (문서화)

---

*구현(Implement) 단계에서 위 작업을 기준으로 AI 생성·인간 검증을 수행한다.*
