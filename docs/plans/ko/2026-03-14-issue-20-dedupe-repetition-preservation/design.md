# 이슈 #20 — 설계 (Plan)

SDD **Plan** 단계 산출물. 메모리 뱅크(Structure, Tech, Product)와 헌칙을 전제로 한 설계·아키텍처 정리.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 중복 제거 및 기억 압축 (반복 보존 정책) |
| **문서 유형** | DESIGN (Plan) |
| **날짜** | 2026-03-14 |
| **관련 이슈** | [#20](https://github.com/jee1/memento/issues/20) |
| **기준 명세** | [spec.md](./spec.md) |
| **Memory Bank** | [structure.md](./structure.md), [tech.md](./tech.md), [product.md](./product.md) |

---

## 1. 설계 원칙 (헌칙)

- **반복 = 중요도**: 유사 기억을 병합할 때 “몇 번 반복되었는지” 정보를 삭제하지 않고 메타데이터로 승격한다.
- **저장 효율 + 기억 효율**: 물리적 행 수는 줄이되, recall 품질을 위해 num_times·last_mentioned_at을 보존·활용한다.
- **#88·#89·#90와 정합**: Fact 메타(#88), 비동기 워커(#89), dedupe(#90)와 정책·위치만 맞추고, 중복 구현을 피한다.

---

## 2. 아키텍처 개요

- **즉시 기록**: `remember` 호출 시 기존처럼 memory_item 1건 즉시 저장. 변경 없음.
- **백그라운드 병합**: #89 워커(또는 #90 dedupe 파이프라인)에서 주기/이벤트 기반으로:
  1) 유사 기억 그룹 탐지(임베딩 유사도·텍스트 정규화 등 기존 기준 활용),
  2) 대표 1건 선정,
  3) 대표에 num_times 누적·last_mentioned_at 갱신,
  4) 병합 대상 N-1건 soft-delete 또는 merged_into_id 참조 저장(선택).
- **회수**: 기존 recall/하이브리드 검색에 #88 boost 공식(num_times, last_mentioned_at)이 반영되면, 반복된 기억이 더 잘 노출됨. 본 기능은 “병합 시 메타 갱신”과 “#88 랭킹과의 연동 확인”에 초점을 둠.

---

## 3. 컴포넌트 역할

| 컴포넌트 | 역할 |
|----------|------|
| **#89 워커 / #90 dedupe** | 유사도 기반 그룹 탐지, 대표 선정, 병합 실행. **본 기능**: 병합 시 대표 항목에 num_times·last_mentioned_at 갱신 로직 추가. |
| **memory_item (스키마)** | #88에서 num_times, last_mentioned_at 등 Fact 메타 컬럼 확장. 본 기능은 해당 컬럼을 읽고 씀. |
| **recall/랭킹** | #88 구현에서 num_times·last_mentioned_at을 사용한 boost 적용. 본 기능은 “반복 보존된” 항목이 해당 boost를 받는지 검증. |

---

## 4. 데이터 흐름

1. **저장**: remember → memory_item 1건 INSERT (기존).
2. **병합(워커)**: 유사 그룹 탐지 → 대표 선정 → 대표 UPDATE (num_times += (N-1) 또는 = N, last_mentioned_at = max(…)) → (선택) 병합 대상 soft-delete 또는 merged_into_id 설정.
3. **회수**: recall → 기존 검색 + #88 boost(num_times, last_mentioned_at) → 정렬 → 반환.

---

## 5. 의존성

- **#88 Fact 메타데이터**: num_times, last_mentioned_at 스키마·마이그레이션. 본 기능은 #88 완료 후 또는 동시 구현 시 해당 컬럼을 사용.
- **#89 비동기 Augmentation**: 워커가 “중복 제거·압축”을 수행하는 위치. 본 기능의 병합·메타 갱신은 해당 워커에 통합.
- **#90 Triples/KG dedupe**: memory_item 수준 병합이 #90과 별도라면, 정책만 맞춤(예: 동일 유사도 임계값·대표 선정 규칙).

---

## 6. 위험·완화

| 위험 | 완화 |
|------|------|
| #88 미완료 시 num_times 등 미존재 | CON-1: #88 반영 후에만 병합·랭킹 로직 활성화. 조건부 분기 또는 feature flag. |
| 병합 빈도·범위로 인한 부하 | #89 워커의 배치 주기·한도 설계에 맡김. 본 명세는 “한 번 병합할 때 무엇을 하는지”만 정의. |

---

**다음 단계**: [tasks.md](./tasks.md) (원자 작업 분해), [implementation-plan.md](./implementation-plan.md) (Phase·검증)
