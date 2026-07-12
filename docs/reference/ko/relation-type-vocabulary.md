# 관계 타입 표준

## 목적

이 문서는 `memory_relation`의 표준 관계 어휘와 MCP/HTTP 공개 계약을 정의합니다. 새 코드와 새 데이터는 이 문서를 기준으로 작성합니다. 관계는 항상 `source_id --[relation_type]--> target_id` 방향을 가집니다.

## 공개 표준 어휘

| 표준 유형 | 카테고리 | 적용 기억 | 방향과 의미 | 기본 검색 부스트 |
|---|---|---|---|---:|
| `CAUSES` | Causal | episodic | source가 target의 원인 | 1.2 |
| `DEPENDS_ON` | Structural | semantic, procedural | source가 target을 전제 또는 의존 | 1.1 |
| `FOLLOWS` | Temporal | episodic, procedural | source가 target 뒤에 발생 또는 실행 | 1.0 |
| `CONTRASTS_WITH` | Semantic | episodic, semantic | source와 target이 대조 또는 충돌 | 0.9 |
| `REFERENCES` | Semantic | working, episodic, semantic, procedural | source가 target을 참조 | 0.8 |
| `BELONGS_TO` | Structural | episodic, semantic | source가 target의 구성원 또는 부분 | 1.0 |
| `VERSION_OF` | Structural | procedural | source가 target을 대체하는 더 새 절차 버전 | 1.0 |

`VERSION_OF`는 새 버전에서 이전 버전으로 향합니다. 예를 들어 `proc-v3 --[VERSION_OF]--> proc-v2`입니다. 같은 `version_series_id` 안에서만 버전 계보로 해석합니다.

## 내부 provenance 유형

| 유형 | 용도 | 공개 입력 |
|---|---|---|
| `extracted_from` | 의미 기억이 원본 기억에서 추출됐음을 나타내는 내부 근거 에지 | 금지 |
| `supported_by` | 한 기억이 다른 기억의 근거로 쓰였음을 나타내는 내부 근거 에지 | 금지 |

두 유형은 `RelationType` 및 레지스트리에 존재하지만, `add_relation`, `remove_relation`, 시각화 필터의 공개 열거형에는 포함하지 않습니다. `applicable_types`가 빈 배열인 것은 수동/공개 선택 대상이 아니라는 뜻입니다.

## AKB 후보와 기존 유형 매핑

| AKB 후보 또는 레거시 이름 | 표준 유형 | 정책 |
|---|---|---|
| `supersedes` | `VERSION_OF` | 새 버전 source에서 이전 버전 target으로 기록 |
| `contradicts`, `contradicts` | `CONTRASTS_WITH` | 새 `memory_relation` 쓰기에서는 표준 이름만 허용 |
| `part_of` | `BELONGS_TO` | source가 부분, target이 전체 |
| `derived_from` | `DEPENDS_ON` | 역사적 `memory_link` 별칭만 변환 |
| `cause_of` | `CAUSES` | 역사적 `memory_link` 별칭만 변환 |
| `version_of` | `VERSION_OF` | 역사적 `memory_link` 별칭; 현재 절차 버전 저장 경로에서만 사용 |
| `implements` | 없음 | 현재는 더 구체적인 계약을 만들지 않고 `REFERENCES`를 사용 |

`implements`는 사용 사례, 방향, 검색/망각 효과를 별도 설계하지 않은 상태이므로 새 관계 유형을 추가하지 않습니다. 새 유형은 `RelationType`, 레지스트리 시드, MCP 열거형, 마이그레이션, 랭킹 영향을 한 변경으로 추가해야 합니다.

## 별칭과 폐기 정책

새 `memory_relation` 데이터와 MCP/HTTP 공개 입력은 표의 대문자 표준 유형만 허용합니다. 기존 `memory_link`의 snake_case 값은 읽기와 과거 데이터 마이그레이션을 위해 유지하되, 새 공개 쓰기에는 허용하지 않습니다.

| 단계 | 상태 |
|---|---|
| 현재 | 새 공개 쓰기는 대문자 표준 유형만 허용; 레거시 snake_case는 기존 `memory_link`에서만 유지 |
| 다음 호환성 검토 | `memory_link` 의존 경로가 제거되거나 대체된 시점에 별칭 읽기 지원을 재평가 |
| 제거 | 사전 데이터 마이그레이션과 릴리스 노트 없이는 제거하지 않음 |

## 랭킹과 망각 설계 초안

현재 관계 부스트는 레지스트리의 `search_boost`만 사용합니다. 아래는 후속 구현을 위한 계약 초안이며, 이 문서만으로 recall 또는 망각 동작은 바뀌지 않습니다.

- `VERSION_OF`: 같은 `version_series_id`에서 더 새 절차가 존재하면 이전 버전을 후보에서 감점하거나 낮은 우선순위로 표시할 수 있다. 명시적 버전 에지가 없는 기억은 숨기지 않는다.
- `CONTRASTS_WITH`: 대조 관계만으로 기억을 자동 억제하거나 망각하지 않는다. 충돌하는 후보를 함께 제시할 때 관계 기여를 설명할 수 있다.
- 추후 `score_breakdown`에는 선택적 `relation_contribution`을 추가한다. 이 값은 적용된 관계 유형, 연결된 기억 ID, 가산 또는 감산 점수를 포함하며, 계산되지 않은 경우 생략한다.

## 구현 정합성

- 타입·카테고리·기본 부스트: `packages/memento-core/src/shared/types/relation.ts`
- 신규 DB 시드: `005-relation-engine-schema.sql`
- 기존 DB 보강: `038-relation-type-registry-seeds.ts`
- 공개 API: [RelationGraph API](../../api/ko/relation-graph-api.md)
