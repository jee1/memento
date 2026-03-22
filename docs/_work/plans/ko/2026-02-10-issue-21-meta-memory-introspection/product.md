# 이슈 #21 Phase B — Memory Bank: Product

SDD **Plan** 단계의 **Memory Bank** 문서 3/3. Phase B 비즈니스 맥락·기존 기능과의 연관을 정리한다.

---

## 1. 제품 관점

- **시그널 전달**: Memento를 쓰는 LLM이 “기억 품질 문제가 있다”는 것을 **기존 도구 응답**으로 자연스럽게 인지하고, 필요 시 상세 요약 도구를 호출하게 한다.
- **자기 성찰 활용**: 에이전트가 저신뢰·고실패 요약을 바탕으로 사용자에게 경고하거나, 실패 회피 규칙을 참고해 제안할 수 있게 한다.
- **규칙 보관**: 실패 회피 규칙을 Memento가 보관해, 외부 LLM이 “제안”을 만들 때 회수할 수 있게 한다. (추출은 외부, 저장·조회는 Memento.)

---

## 2. 기존 기능과의 연관

| 기능 | 연관 |
|------|------|
| **recall** | 응답에 introspection_hint 추가(저신뢰/고실패 있을 때). 기존 검색·메타 통계 동작은 그대로. |
| **get_meta_memory_stats** | 동일하게 응답에 introspection_hint 추가. |
| **meta_memory_introspection job** | 실행 결과를 캐시에 저장. hint·get_introspection_summary의 유일한 데이터 소스. |
| **MetaMemoryIntrospectionService.runScan** | 기존 그대로. 스케줄러가 호출하고 결과를 캐시에 넣음. |
| **get_introspection_summary (신규)** | 캐시만 읽어 상세 요약·ID 목록 반환. |
| **실패 회피 규칙 (선택)** | Memento가 저장·조회. 외부 LLM이 추출 후 저장 도구로 등록, 제안 시 조회. |

---

## 3. 목표 사용자·시나리오

- **에이전트(LLM)**: recall/get_meta_memory_stats 사용 중 “기억 품질 힌트”를 받고, 필요 시 get_introspection_summary로 상세를 가져와 사용자에게 경고 또는 제안.
- **클라이언트(오케스트레이터)**: 고실패 메모리 내용을 바탕으로 외부 LLM으로 규칙 문장 추출 후, Memento에 규칙 저장 도구로 등록.
- **운영**: (기존과 동일) admin runJob('meta_memory_introspection')으로 스캔 수동 실행 가능; Phase B에서는 그 결과가 캐시를 갱신해 hint·도구에 반영됨.

---

*목표·범위·기존 기능 연관 변경 시 이 문서를 먼저 갱신한다.*
