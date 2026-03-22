# Issue #57 Phase 2 로드맵

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) — Procedural Memory Phase 2 (LLM 요약·고급 버전 관리·성능 최적화)  
**범위**: 이슈 #57 중 미구현 기능 4종을 우선순위에 따라 단계별 구현.

---

## 우선순위 및 단계

| 단계 | 항목 | 설명 | 설계/구현 문서 |
|------|------|------|----------------|
| **1** | **A) 고급 버전 관리** | 버전 필드/테이블, diff 조회, rollback, recall 버전·비교 옵션 | [procedural-version-management](../2026-02-05-procedural-version-management/design.md) |
| **2** | **C) 독립 remember_procedure 툴** | 전용 엔드포인트, 검증/로깅/권한 분리 | [remember-procedure](../2026-02-05-remember-procedure/design.md) (완료) |
| **3** | **B) 성능 최적화** | 캐싱(steps-only 뷰 등), FTS/JSON 인덱스, recall 프로파일링 | [design-b-performance.md](./design-b-performance.md), [implementation-plan.md](./implementation-plan.md) (구현 완료) |
| **4** | **D) 다중 에이전트** | privacy_scope/ownership 확장안 조사·설계 → 필요 시 구현 | [design-d-multi-agent.md](./design-d-multi-agent.md), [implementation-plan.md](./implementation-plan.md) (구현 완료) |

**참고**: LLM 추출기(플러그 가능 + 규칙 fallback)는 별도 설계·구현 완료. [procedural-llm-extractor](../2026-02-05-procedural-llm-extractor/design.md) 참고.

---

## 진행 방식

- 각 단계별로 설계 문서 작성 후 구현 계획 수립.
- 단계 1(A) 설계부터 진행하며, 섹션별 검토 후 문서 확정.
