# 이슈 #21 Phase B — Memory Bank: Tech

SDD **Plan** 단계의 **Memory Bank** 문서 2/3. Phase B 기술 스택·캐시·제약을 정의한다.

---

## 1. 기술 스택

- **언어·런타임**: TypeScript, Node.js ≥ 20 (기존 memento-core와 동일).
- **DB**: SQLite, better-sqlite3. 기존 meta_memory_stats, memory_item 사용. Phase B 선택 시 failure_avoidance_rule 테이블 추가(마이그레이션 018).
- **캐시**: 프로세스 내 메모리(단일 서버 인스턴스). 재시작 시 소실 허용, 다음 meta_memory_introspection job으로 복구.
- **기존 활용**: MetaMemoryIntrospectionService, BatchScheduler, recall-tool, get-meta-memory-stats-tool.

---

## 2. 캐시 설계

- **저장 시점**: `runMetaMemoryIntrospection()` 성공 시, `MetaMemoryIntrospectionScanResult` + `scanned_at`(ISO 8601) 저장.
- **조회 시점**: recall/get_meta_memory_stats 응답 생성 시, get_introspection_summary 도구 호출 시.
- **저장소**: 인메모리(Map 또는 단일 객체). BatchScheduler 인스턴스 필드 또는 공유 서비스(예: IntrospectionScanCache)로 접근.
- **TTL**: 없음. 다음 스케줄 실행까지 유지. 프로세스 재시작 시 빈 상태.

---

## 3. 스키마 전제

- **meta_memory_stats** (마이그레이션 011): memory_id, recall_count, success_count, failure_count, avg_confidence, last_recalled_at 등. Phase B는 읽기만.
- **(선택) failure_avoidance_rule**: Phase B 후반에서 규칙 저장 시 018 마이그레이션 추가. 계획서 Task 1 참조.

---

## 4. 제약

- **실시간 runScan 금지**: hint·get_introspection_summary는 캐시만 참조. 매 요청 runScan으로 부하를 늘리지 않음.
- **하위 호환**: introspection_hint는 선택 필드. 기존 클라이언트는 무시 가능.
- **Memento에 LLM 미도입**: 규칙 추출은 외부 LLM. Memento는 저장·조회·스캔 결과 제공만.

---

*도입 기술·캐시·제약 변경 시 이 문서를 먼저 갱신한다.*
