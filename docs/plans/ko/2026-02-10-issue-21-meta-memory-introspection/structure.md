# 이슈 #21 Phase B — Memory Bank: Structure

SDD **Plan** 단계의 **Memory Bank** 문서 1/3. Phase B 컴포넌트·위치·관계를 정의한다.

---

## 1. 구조 원칙

- **기능 위치**: introspection_hint·get_introspection_summary·캐시는 **기존 recall/get_meta_memory_stats/스케줄러** 확장. 별도 패키지 없음.
- **코드 위치**: `packages/memento-core` 내, 기존 도메인·인프라 구조 유지.
  - 캐시: 스케줄러 근처 또는 메모리 도메인 서비스 레이어(단일 프로세스 메모리 캐시).
  - hint 주입: recall-tool, get-meta-memory-stats-tool 응답 생성 직전에 캐시 읽어 hint 필드 추가.
  - get_introspection_summary: 신규 도구, memory 또는 monitoring 도메인 하위.

---

## 2. 컴포넌트 관계

```
BatchScheduler (meta_memory_introspection job)
    → MetaMemoryIntrospectionService.runScan(db, {})
    → [Phase B] 결과를 캐시에 저장 (scanned_at = now)

recall 도구
    → (기존) 검색·메타 통계 기록·응답 생성
    → [Phase B] 응답 반환 직전: 캐시에서 스캔 결과 읽기 → 저신뢰/고실패 > 0이면 introspection_hint 부여

get_meta_memory_stats 도구
    → (기존) MetaMemoryService.getStats → 응답
    → [Phase B] 응답 반환 직전: 동일하게 캐시 읽어 introspection_hint 부여

get_introspection_summary 도구 (신규)
    → 캐시에서 최근 스캔 결과 읽기
    → { summary, lowConfidenceMemoryIds, highFailureMemoryIds, scanned_at? } 반환
```

---

## 3. 디렉터리/파일 (참조)

- **캐시**: 스케줄러 내부 또는 `src/domains/memory/services/` — 최근 스캔 결과 보관. (예: `IntrospectionScanCache` 또는 BatchScheduler 인스턴스 필드.)
- **recall 도구**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts` — 응답에 hint 추가.
- **get_meta_memory_stats 도구**: `packages/memento-core/src/domains/monitoring/tools/get-meta-memory-stats-tool.ts` — 응답에 hint 추가.
- **get_introspection_summary 도구**: `packages/memento-core/src/domains/memory/tools/` 또는 `domains/monitoring/tools/` — 신규 파일.
- **스케줄러**: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` — runMetaMemoryIntrospection 완료 후 캐시 갱신.

구체 파일명은 구현 시 확정.

---

*Tasks/Implement 시 구조 변경 시 이 문서를 먼저 갱신한다.*
