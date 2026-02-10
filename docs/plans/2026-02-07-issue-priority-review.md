# Memento 등록 이슈 진행 우선순위 검토

**일자**: 2026-02-07  
**대상**: GitHub 열린 이슈 전체 (OPEN 상태 13건)

---

## 1. 열린 이슈 목록 (현재)

| 번호 | 제목 | 라벨 | 생성일 |
|------|------|------|--------|
| [#87](https://github.com/jee1/memento/issues/87) | feat(memori): Attribution 모델 도입 — entity/process/session 분리 | - | 2026-02-07 |
| [#88](https://github.com/jee1/memento/issues/88) | feat(memori): Fact 1급 객체화 및 메타데이터 표준화 | - | 2026-02-07 |
| [#89](https://github.com/jee1/memento/issues/89) | feat(memori): 비동기 Augmentation 파이프라인 (즉시 기록 + 워커 정제) | - | 2026-02-07 |
| [#90](https://github.com/jee1/memento/issues/90) | feat(memori): Semantic Triples·KG 전용 저장소 및 dedupe | - | 2026-02-07 |
| [#91](https://github.com/jee1/memento/issues/91) | feat(memori): Process Attribute로 recall 스코어링 고도화 | - | 2026-02-07 |
| [#82](https://github.com/jee1/memento/issues/82) | [FEATURE] 개인 지식 축적 Agent - 사고의 침전 과정 모델링 | enhancement | 2026-01-19 |
| [#81](https://github.com/jee1/memento/issues/81) | [FEATURE] 개발자용 AI 기억 백엔드 MVP - 프로젝트 컨텍스트 기억 시스템 | enhancement | 2026-01-19 |
| [#80](https://github.com/jee1/memento/issues/80) | [FEATURE] 기억 진화 데모 - 시간 경과에 따른 기억 변화 시각화 | enhancement | 2026-01-19 |
| [#78](https://github.com/jee1/memento/issues/78) | [FEATURE] kg-gen 유사 기능 보강: Triple 추출 파이프라인 고도화 | enhancement | 2026-01-17 |
| [#21](https://github.com/jee1/memento/issues/21) | [FEATURE] '메타-기억' (Meta-Memory) 기반 자기 성찰 기능 | enhancement | 2025-11-05 |
| [#20](https://github.com/jee1/memento/issues/20) | [FEATURE] 중복 제거 및 기억 압축 저장 기능 | enhancement | 2025-11-05 |
| [#18](https://github.com/jee1/memento/issues/18) | [FEATURE] 맥락 기반 기억 재생 및 자동 리뷰 기능 | enhancement | 2025-11-05 |
| [#17](https://github.com/jee1/memento/issues/17) | [FEATURE] 기억 시각화 대시보드 (Memory Map) | enhancement | 2025-11-05 |

---

## 2. 우선순위 원칙

- **기반 스키마·파이프라인 우선**: 다른 기능이 의존하는 스키마(Attribution, Fact 메타)와 파이프라인(비동기 워커, KG)을 먼저 확립.
- **의존성 순서 준수**: process_id 없이는 Process Attribute(#91)가 의미 없음. Fact 메타(#88) 없이는 메타-기억(#21)의 신뢰도·last_accessed 등이 표준화되지 않음.
- **중복 이슈 통합**: #20(중복 제거), #78(Triple 파이프라인)은 Memori 계열 #89·#90과 범위가 겹치므로, Memori 스트림 진행 시 흡수하거나 직후 통합.
- **제품/데모는 핵심 안정화 후**: 개발자 MVP(#81), 기억 진화 데모(#80), 개인 지식 Agent(#82)는 “저장·회수·정제”가 갖춰진 뒤 진행 시 효과가 큼.

---

## 3. 권장 진행 순서 (티어별)

### Tier 1 — 기반 (가장 먼저)

| 순서 | 이슈 | 이유 |
|------|------|------|
| 1 | **#87** Attribution (entity/process/session) | #88·#90·#91의 전제. process_id·session_id 없으면 이후 Memori 계열과 #81(프로젝트별 기억) 설계가 불안정함. |

---

### Tier 2 — 저장·메타·파이프라인 (Memori 핵심)

| 순서 | 이슈 | 이유 |
|------|------|------|
| 2 | **#88** Fact 1급·메타데이터 표준화 | recall·콘솔리데이션·#21(메타-기억)의 공통 기반. num_times, last_mentioned_at 등 표준 메타 도입. |
| 3 | **#89** 비동기 Augmentation 파이프라인 | 즉시 기록 + 워커 정제. #88 반영 구조 위에서 동작시키는 것이 자연스러움. #20(중복 제거)의 “백그라운드 병합”은 이 워커에 통합 가능. |
| 4 | **#90** Triple/KG 전용 저장 + dedupe | #87 귀속과 #89 워커(트리플 추출·dedupe)와 맞춤. **#78**(kg-gen 유사 Triple 파이프라인)은 #90 진행 시 청킹/클러스터링/그래프 병합으로 통합 검토 권장. |

**#20(중복 제거)·#78(Triple 파이프라인)**  
- #20: #89 워커에서 “중복 제거·압축” 정책으로 흡수하거나, #90 dedupe와 정책만 맞춰 별도 구현.  
- #78: #90과 함께 Triple 파이프라인 고도화로 처리하면 이슈 중복을 줄일 수 있음.

---

### Tier 3 — 회수 고도화

| 순서 | 이슈 | 이유 |
|------|------|------|
| 5 | **#91** Process Attribute recall 스코어링 | #87에서 process_id 도입 후 진행. (query 유사도) × (process 적합도) 스코어링으로 회수 품질 향상. |

---

### Tier 4 — 메타-기억·자기 성찰

| 순서 | 이슈 | 이유 |
|------|------|------|
| 6 | **#21** 메타-기억(Meta-Memory) 기반 자기 성찰 | 이슈에서 “매우 중요 (핵심 기능)”으로 표시됨. #88 Fact 메타(confidence, last_accessed 등)와 스키마 정합. M1 스캔·신뢰도 평가·실패 패턴 추출은 #89 워커와 연동 가능. |

---

### Tier 5 — 제품·데모 (핵심 안정화 후)

| 순서 | 이슈 | 이유 |
|------|------|------|
| 7 | **#81** 개발자용 AI 기억 백엔드 MVP | 프로젝트별 Core/Episodic/Procedural 기억. #87(프로젝트≈entity/process 구분) 반영 후 설계가 명확해짐. |
| 8 | **#80** 기억 진화 데모 | 망각·통합·진화 시각화. Tier 1~3이 갖춰지면 “같은 질문에 대한 답변 변화” 데모가 설득력 있음. |
| 9 | **#82** 개인 지식 축적 Agent | 사고의 침전·반복/연결/반성. #88 Fact·#89 워커·#21 메타-기억과 잘 맞음. 제품 꾸러미로는 #81·#80 이후가 무난함. |

---

### Tier 6 — UX·시각화 (필요 시 병렬 또는 후순위)

| 순서 | 이슈 | 이유 |
|------|------|------|
| 10 | **#18** 맥락 기반 기억 재생·자동 리뷰 | importance·last_accessed 기반 리뷰. #88 메타·#21 메타-기억과 연동 가능. 스케줄러·큐는 #89와 공유 검토. |
| 11 | **#17** 기억 시각화 대시보드 (Memory Map) | 2D/3D 벡터 시각화. 데모(#80)나 개발자 MVP(#81)와 함께 진행해도 됨. |

---

## 4. 요약: 한 줄 진행 순서

```
#87 → #88 → #89 → #90 → #91 → #21 → #81 → #80 → #82 → #18 → #17
```

**통합 검토**  
- **#20** (중복 제거): #89·#90 진행 시 워커/정책으로 흡수.  
- **#78** (Triple 파이프라인 고도화): #90과 함께 청킹·클러스터링·그래프 병합으로 처리.

---

## 5. 의존성 다이어그램 (개념)

```
#87 Attribution
    ├─→ #88 Fact 메타
    ├─→ #90 KG/dedupe (entity/process/session 귀속)
    └─→ #91 Process Attribute

#88 Fact 메타
    ├─→ #89 워커 (Fact 단위 정제)
    └─→ #21 메타-기억 (신뢰도·last_accessed 등)

#89 비동기 워커
    ├─→ #90 (트리플 추출·dedupe 수행 주체)
    └─→ #20 (중복 제거 정책 흡수 가능)

#90 KG/dedupe
    └─→ #78 (파이프라인 고도화와 통합 검토)

#87, #88, #89
    └─→ #81 개발자 MVP (프로젝트별 기억 설계 안정)
```

---

이 순서로 진행하면 기반 스키마·파이프라인을 먼저 확보한 뒤, 회수 품질·메타-기억·제품/데모 순으로 확장할 수 있다.
