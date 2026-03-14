# 이슈 #20 — Memory Bank: Structure

SDD **Plan** 단계의 **Memory Bank** 문서 1/3. 시스템 아키텍처·컴포넌트 관계·위치를 정의한다.

---

## 1. 구조 원칙

- **기능 위치**: “중복 제거 + 반복 보존”은 **기존 워커/파이프라인 확장**으로 둔다. 별도 서비스/패키지를 만들지 않음.
- **코드 위치**: `packages/memento-core` 내, 기존 도메인·인프라 구조를 따른다.
  - 병합·메타 갱신 로직: `src/domains/` 또는 `src/workers/` 하위(기존 consolidation·batch 워커와 동일 레이어).
  - recall 랭킹: 기존 `hybrid-search-engine`, `search-ranking` 또는 #88 구현 위치와 동일.

---

## 2. 컴포넌트 관계

```
remember (MCP/CLI)
    → memory_item INSERT (즉시, 기존)
    → (나중에) 워커가 유사도 스캔

#89 워커 / #90 dedupe 파이프라인
    → 유사 그룹 탐지
    → 대표 선정
    → [본 기능] 대표 UPDATE (num_times, last_mentioned_at)
    → (선택) 병합 대상 soft-delete / merged_into_id

recall / 검색 엔진
    → [본 기능] #88 boost(num_times, last_mentioned_at) 반영
    → 정렬·반환
```

---

## 3. 디렉터리/파일 (참조)

- **스키마·마이그레이션**: `packages/memento-core/src/infrastructure/database/` — #88에서 num_times, last_mentioned_at 추가.
- **워커·배치**: `packages/memento-core/src/workers/` 또는 `src/domains/` 내 배치 job — 병합 시 메타 갱신 호출.
- **검색·랭킹**: `packages/memento-core/src/domains/search/` — #88 boost 연동.

구체 파일명은 #89·#90 구현 계획과 통합 시 확정.

---

*Tasks/Implement 시 아키텍처·구조 변경 시 이 문서를 먼저 갱신한다.*
