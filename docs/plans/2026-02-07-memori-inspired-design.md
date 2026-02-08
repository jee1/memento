# Memori 레퍼런스 흡수 설계 (검토 반영)

**일자**: 2026-02-07  
**목적**: [MemoriLabs/Memori](https://github.com/MemoriLabs/Memori)의 메모리 모델·스키마·파이프라인 아이디어를 memento 설계에 흡수. (Memori SDK를 그대로 붙이지 않고, “제품화된 스키마/파이프라인/귀속 모델”을 레퍼런스 아키텍처로 활용.)

---

## 검토 요약

- **결론**: 정리하신 6개 항목과 적용 순서는 **타당**하며, 코드베이스(스키마·owner_id·relation·트리플)와 정합적임.
- **보완**: (1) memento는 이미 `owner_id`(≈ entity)와 `memory_relation`·`memory_item`의 subject/predicate/object가 있으므로, 1번은 **process_id·session_id 확장**, 3번은 **전용 KG 테이블·dedupe**로 구체화. (2) 6번(SQL-native)은 별도 이슈보다 **1·2번 구현 시 마이그레이션·스키마 버전 관리**로 흡수 권장.
- **이슈 단위**: 아래 5개 이슈로 나누어 하나씩 진행하는 것을 권장.

---

## 1) Attribution: entity / process / session 분리

**Memori**: 메모리를 **누구(entity)**의 **어떤 에이전트/프로그램(process)**가 만든 **어떤 작업 흐름(session)**인지로 구분.

**memento 현재**: `memory_item.owner_id`만 있음 (Issue #57 Phase 2 D, 다중 에이전트). `process_id`, `session_id` 없음.

**적용 방향**:
- 메모리 저장의 기본 키를 **(entity_id, process_id, session_id)** 개념으로 확장.
- `owner_id`를 entity에 대응시키고, `process_id`, `session_id` 컬럼(또는 동등한 식별자) 추가.
- “내 기억” vs “특정 도구/에이전트가 만든 운영기억” 혼합 방지.
- Anchor(A/B/C) 슬롯을 process 또는 session 레벨로 매핑 가능하게 설계.

**Issue #87 구현 후 (Anchor 설계 검토):** 앵커는 현재 `agent_id` per slot. process_id 도입 후 (1) process_id = agent_id 동일 값 사용, (2) 앵커 맵 키를 (agent_id, process_id) 또는 session_id로 확장하는 옵션을 별도 이슈에서 검토 권장.

---

## 2) Facts를 1급 객체로 + 메타데이터

**Memori**: 대화에서 Fact를 추출해 entity에 귀속, embedding + num_times + last_time 등 메타 저장.

**memento 적용**:
- Semantic의 최소 단위를 **Fact로 정규화** (전용 테이블 또는 memory_item type='semantic' 확장).
- Fact에 표준 메타: `num_times`, `last_mentioned_at`, `source_session_id`, `confidence`, `importance_score`.
- 콘솔리데이션 점수도 Fact/Relation 단위로 부착 가능하도록.

**Issue #88 반영 완료 (2026-02-08):** memory_item에 Fact 메타 컬럼 추가(마이그레이션 017), remember 시 저장, recall 시 num_times·last_mentioned_at 가중 적용.

---

## 3) 비동기 Augmentation(무지연) 파이프라인

**Memori**: 대화 시점에는 지연 없이, 백그라운드에서 augmentation으로 메모리 생성.

**memento 적용**:
- MCP 서버에서 **기록**과 **정제/추출** 분리:
  1. 대화/이벤트는 즉시 저장(append-only).
  2. 워커가 나중에 Fact/Triple/요약/중복제거/콘솔리데이션 수행.
- 프로덕션 안정성을 위해 이 구조를 명시적으로 도입.

---

## 4) Semantic Triples + KG 테이블 분리 + dedupe

**Memori**: (subject, predicate, object) 트리플 저장·중복제거·knowledge graph 구성.

**memento 현재**: `memory_item`에 subject/predicate/object, triple_extracted 등(migration 008), `memory_relation` 테이블 존재.

**적용 방향**:
- **지식그래프용 전용 테이블**(또는 memory_relation 확장)에서 트리플 저장·dedupe.
- Relation Graph / meta-memory와 연동해 “관계” 축 강화.
- 사용자 선호·규칙·관계를 트리플로 모델링해 recall 정확도 향상.

---

## 5) Process Attributes로 회수 필터링 정교화

**Memori**: process가 주로 다루는 주제/속성을 저장해, 해당 process에 맞는 fact를 우선 선택.

**memento 적용**:
- process별 **주제/속성** 메타 저장 (전용 테이블 또는 기존 process 식별자와 연결).
- recall 시 **(query 유사도) × (process-attribute 적합도)** 스코어링.
- procedural의 workflow_name/skill_name과 결합해 “재정/투자” vs “코드리뷰” 등 도메인별 우선순위 반영.

---

## 6) DB 중심(SQL-native) + 스키마 진화

**현재**: memento는 이미 SQLite·마이그레이션 번호제·schema.sql 유지.

**적용 포인트**:
- RDB 중심 + 필요한 곳만 벡터 인덱싱 유지.
- 스키마 버전 테이블(예: `schema_version`)을 제품 레벨로 명시해 진화 이력 관리.
- 1·2번 구현 시 마이그레이션 규칙에 포함해 별도 대형 이슈로 만들지 않아도 됨.

---

## 추천 적용 순서 (이슈 단위)

1. **Attribution(entity/process/session) 도입**
2. **Fact 테이블·메타 표준화**
3. **비동기 Augmentation 워커 분리**
4. **Triple/KG 전용 저장 + dedupe**
5. **Process Attribute로 회수 스코어링**

---

## GitHub 등록 현황 및 진행 순서 검토

### 등록된 이슈 (2026-02-07)

| 순서 | 이슈 번호 | 제목 |
|------|-----------|------|
| 1 | [#87](https://github.com/jee1/memento/issues/87) | feat(memori): Attribution 모델 도입 — entity/process/session 분리 |
| 2 | [#88](https://github.com/jee1/memento/issues/88) | feat(memori): Fact 1급 객체화 및 메타데이터 표준화 |
| 3 | [#89](https://github.com/jee1/memento/issues/89) | feat(memori): 비동기 Augmentation 파이프라인 (즉시 기록 + 워커 정제) |
| 4 | [#90](https://github.com/jee1/memento/issues/90) | feat(memori): Semantic Triples·KG 전용 저장소 및 dedupe |
| 5 | [#91](https://github.com/jee1/memento/issues/91) | feat(memori): Process Attribute로 recall 스코어링 고도화 |

### 진행 순서 검토 (등록된 Memori 이슈 기준)

**권장 순서: #87 → #88 → #89 → #90 → #91**

- **#87 (Attribution) 먼저**: `process_id`, `session_id`가 없으면 #88 Fact의 `source_session_id`, #90 KG의 entity/process/session 귀속, #91 Process Attribute의 “process별” 메타가 정의될 대상이 없음. 스키마·툴의 기본 축을 먼저 넣는 것이 맞음.
- **#88 (Fact·메타) 두 번째**: Fact 1급 객체와 `num_times`·`last_mentioned_at` 등 메타는 recall·콘솔리데이션의 공통 기반. 비동기 워커(#89)가 “무엇을 정제할지”(Fact 단위)를 알 수 있게 함.
- **#89 (비동기 Augmentation) 세 번째**: 즉시 기록 + 워커 정제 파이프라인은 #87·#88이 반영된 저장 구조를 전제로 할 때 의미가 있음. 기존 batch-scheduler·triple-extraction-batch-job과 통합하는 단계.
- **#90 (Triple/KG + dedupe) 네 번째**: KG 전용 저장·dedupe는 #87의 entity/process/session 귀속과 맞추고, #89 워커가 트리플 추출·중복제거를 수행하는 흐름과 맞추면 됨.
- **#91 (Process Attribute) 마지막**: process별 주제/속성과 recall 스코어링은 **#87에서 process_id가 도입된 뒤** 가능함. 다른 Memori 이슈에 직접 의존하지 않지만, 효과를 내려면 #87 완료 후 진행하는 것이 좋음.

**의존성 요약**:
- #88, #90, #91 → #87 (Attribution)에 간접·직접 의존.
- #89 → #87·#88 반영 후 파이프라인 설계가 명확해짐.
- #90 ↔ #89: 워커가 Triple 추출·dedupe를 담당하므로 #89와 함께 설계하면 일관됨.

**다른 열린 이슈와의 관계**:
- **#78** (Triple 추출 파이프라인 고도화): #90(KG·dedupe)과 영역이 겹침. #90 진행 시 청킹/클러스터링/그래프 병합 등은 #78과 통합 검토 권장.
- **#20** (중복 제거·기억 압축): #90 dedupe, #89 워커의 중복제거와 연결해 정책·위치만 정하면 됨.
- **#21** (메타-기억·자기 성찰): #88 Fact 메타·#91 Process Attribute와 연동 가능한 장기 목표로 두면 됨.

---

## Memori vs memento 관점

- **Memori**: LLM 호출을 가로채 자동으로 기억 생성·회수하는 SDK 색채.
- **memento**: 에이전트 생태계(MCP)·다양한 메모리 타입·콘솔리데이션/포겟팅이 강점.
- Memori의 장점은 “제품화된 스키마/파이프라인/귀속 모델”을 **레퍼런스 아키텍처로 흡수**하는 데 활용.

---

## GitHub 이슈 등록용 (복사하여 사용)

아래 5개를 각각 새 Issue로 등록한 뒤, 하나씩 진행하면 됨.

### ISSUE 1: Attribution(entity/process/session) 도입

**Title**: `feat(memori): Attribution 모델 도입 — entity/process/session 분리`

**Body** (아래를 그대로 사용 가능):

```markdown
## 목표
Memori 레퍼런스에 따라 메모리를 (entity, process, session) 축으로 구분해 저장·회수하여 메모리 오염을 줄이고 recall 품질을 높인다.

## 배경
- 현재 `memory_item`에는 `owner_id`만 있음 (Issue #57 Phase 2 D).
- process(에이전트/프로그램), session(작업 흐름) 구분이 없어 “내 기억”과 “특정 도구가 만든 기억”이 섞일 수 있음.

## 범위
- [ ] 스키마: `memory_item`에 `process_id`, `session_id` (또는 동등 식별자) 추가. `owner_id` = entity 대응 유지.
- [ ] remember/remember_procedure/recall: entity_id(owner_id), process_id, session_id 저장·필터 지원.
- [ ] 앵커 슬롯을 process/session 레벨로 매핑 가능하도록 설계 검토.
- [ ] 마이그레이션·하위 호환(기존 owner_id만 있는 데이터) 유지.

## 참고
- 설계: `docs/plans/2026-02-07-memori-inspired-design.md`
- Memori: https://memorilabs.ai/docs/advanced-augmentation/
```

---

### ISSUE 2: Fact 테이블·메타 표준화

**Title**: `feat(memori): Fact 1급 객체화 및 메타데이터 표준화`

**Body**:

```markdown
## 목표
Semantic 메모리의 최소 단위를 Fact로 정규화하고, 언급 횟수/최근 언급/출처/신뢰도 등 메타를 표준화해 recall·콘솔리데이션 품질을 높인다.

## 배경
- Memori는 대화에서 Fact를 추출해 entity에 귀속하고, num_times, last_time, embedding 등 메타를 저장함.
- memento는 semantic type이 있으나 Fact 전용 테이블·표준 메타가 없음.

## 범위
- [ ] Fact 단위 저장: 전용 테이블 또는 memory_item type='semantic' 확장에 Fact 정규화.
- [ ] 표준 메타: `num_times`, `last_mentioned_at`, `source_session_id`, `confidence`, `importance_score` (기존 importance와 정합).
- [ ] 콘솔리데이션 점수를 Fact/Relation 단위로 부착 가능하도록.
- [ ] recall/검색 시 메타 활용(예: num_times·last_mentioned 가중).

## 참고
- 설계: `docs/plans/2026-02-07-memori-inspired-design.md`
```

---

### ISSUE 3: 비동기 Augmentation 파이프라인

**Title**: `feat(memori): 비동기 Augmentation 파이프라인 (즉시 기록 + 워커 정제)`

**Body**:

```markdown
## 목표
대화/이벤트는 지연 없이 즉시 저장하고, Fact/Triple/요약/중복제거/콘솔리데이션은 백그라운드 워커에서 수행하는 파이프라인을 도입한다.

## 배경
- Memori는 “무지연”을 강조하며 augmentation을 비동기로 수행함.
- 프로덕션에서 안정적으로 메모리를 굴리려면 기록과 정제를 분리하는 것이 유리함.

## 범위
- [ ] 즉시 저장: 대화/이벤트 append-only 저장 경로 유지 또는 명시.
- [ ] 워커: Fact 추출, Triple 추출, 요약, 중복제거, 콘솔리데이션을 배치/큐 기반으로 실행.
- [ ] 기존 batch-scheduler·triple-extraction-batch-job 등과 통합 검토.
- [ ] 실패 재시도·모니터링 고려.

## 참고
- 설계: `docs/plans/2026-02-07-memori-inspired-design.md`
```

---

### ISSUE 4: Triple/KG 전용 저장 + dedupe

**Title**: `feat(memori): Semantic Triples·KG 전용 저장소 및 dedupe`

**Body**:

```markdown
## 목표
(subject, predicate, object) 트리플을 지식그래프용으로 전용 저장하고, 중복제거(dedupe)를 적용해 Relation Graph·meta-memory와 연동한다.

## 배경
- Memori는 Fact에서 트리플을 만들어 KG를 구성함.
- memento는 이미 memory_item에 subject/predicate/object, memory_relation 테이블이 있음. 역할 구분(메모리 항목 vs 정규화된 트리플 저장소) 및 dedupe를 명확히 함.

## 범위
- [ ] KG 전용 테이블 또는 memory_relation 확장: 트리플 저장·entity/process/session 귀속.
- [ ] 트리플 dedupe: 동일 (subject, predicate, object) 정규화·병합 정책.
- [ ] Relation Graph·앵커·검색과 연동.
- [ ] 사용자 선호·규칙·관계 등 트리플 모델링으로 recall 정확도 향상.

## 참고
- 설계: `docs/plans/2026-02-07-memori-inspired-design.md`
- 기존: migration 005(relation), 008(triple on memory_item).
```

---

### ISSUE 5: Process Attribute 회수 스코어링

**Title**: `feat(memori): Process Attribute로 recall 스코어링 고도화`

**Body**:

```markdown
## 목표
process(에이전트)별로 주제/속성을 저장하고, recall 시 (query 유사도) × (process-attribute 적합도) 스코어링으로 회수 품질을 높인다.

## 배경
- Memori는 process가 다루는 주제/속성을 저장해 해당 process에 맞는 fact를 우선 선택함.
- memento의 procedural workflow_name/skill_name과 결합하면 도메인별 우선순위 반영 가능.

## 범위
- [ ] process별 주제/속성 메타 저장 (전용 테이블 또는 process 식별자와 연결).
- [ ] recall 시 process-attribute 적합도 반영: 스코어 = f(유사도, process_적합도).
- [ ] workflow_name/skill_name과의 통합 검토 (procedural과 일관된 네이밍·저장 위치).
- [ ] 선택: 에이전트/도구별 프롬프트 템플릿과 결합해 “재정 에이전트” vs “코드리뷰 에이전트” 등 구분.

## 참고
- 설계: `docs/plans/2026-02-07-memori-inspired-design.md`
- 선행: ISSUE 1 (Attribution)에서 process_id 도입 후 진행 권장.
```

---

위 5개 이슈를 등록한 뒤 **1 → 2 → 3 → 4 → 5** 순서로 진행하면, 의존성을 만족하면서 단계적으로 Memori 레퍼런스를 흡수할 수 있다.
