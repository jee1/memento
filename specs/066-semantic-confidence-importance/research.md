# Phase 0 Research: semantic confidence와 conversion 경계

## 1. 기존 스키마 재사용

**Decision**: `memory_item.confidence`, `importance`, `num_times`, `owner_id`, `project_id`, `origin_source`,
SPO 필드와 triple extraction 상태 필드를 그대로 사용한다. 신규 migration, schema version bump, backfill은
하지 않는다.

**Rationale**: canonical schema와 기존 migration 017/030에 필요한 필드가 이미 있다. 문제는 필드 부재가
아니라 자동 semantic 생성/병합 경로가 confidence를 쓰지 않는 것이다.

**Alternatives considered**: evidence count/importance history 신규 컬럼은 현재 `num_times`와 최신 episodic
importance 규칙으로 충분하고, scoped KG unique migration과 historical NULL backfill은 범위 밖이다.

## 2. 정규화와 confidence 계산

**Decision**: 기존 `PredicateCanonicalizer`, `EntityLinker`, 현재 confidence 배점(0.3/0.3/0.4)을 재사용하되,
한 triple당 하나의 `NormalizedTripleSnapshot`만 만들고 downstream 전체가 재사용한다.

**Rationale**: 현재 scoring, similarity, CRUD가 각각 canonicalize/link를 반복해 서로 다른 결과를 볼 수 있다.
사양은 배점 재설계를 제외하고 snapshot 일관성만 요구한다.

**Alternatives considered**: 공개 `Triple` 타입 변경과 호출 간 normalization cache는 계약·수명 복잡도를
늘리므로 제외한다.

## 3. 저장 게이트와 importance

**Decision**: 저장은 `confidence > threshold`일 때만 허용한다. aggregate confidence는 `num_times` 기반 동일
가중 평균, importance는 `latest episodic importance * aggregate confidence`이며 기존 반복 boost는 aggregate가
정확히 `1`이고 base가 양수일 때만 적용한다.

**Rationale**: strict 경계가 0.7 점수 파편을 막고, quality multiplier가 낮은 confidence의 높은 원본
importance 상속을 제한한다. explicit `0`은 `?? 0.5`로만 기본화해야 보존된다.

**Alternatives considered**: `>=` threshold, 별도 discount coefficient, 모든 반복에 boost는 승인된 경계나
YAGNI 원칙과 충돌한다.

## 4. 후보 eligibility와 전역 KG

**Decision**: 후보는 active semantic, null-safe same owner/project, automatic provenance, 유효한 SPO/confidence/
num_times 조건을 먼저 만족해야 한다. exact structural match가 similar보다 우선하며 동률은 `created_at`, ID다.
전역 KG 대표가 부적격이면 해당 row를 바꾸지 않고 scoped semantic 후보 검색/생성으로 진행한다.

**Rationale**: 기존 predicate-only 후보 조회는 다른 tenant와 사용자 작성 memory를 읽고 병합할 수 있다.
기존 KG의 global SPO unique는 유지해야 하므로 representative ownership 없이도 scoped semantic row는 존재할 수
있어야 한다.

**Alternatives considered**: 애플리케이션 사후 scope 필터는 scope 밖 content를 읽고, KG 대표 overwrite는
다른 scope의 대표권을 침해하며, composite unique migration은 범위 밖이다.

## 5. embedding과 similarity

**Decision**: DB prefilter 뒤 필요한 후보만 비교하고, input subject/object embedding은 triple 준비 동안 각각
한 번 계산해 재사용한다. similarity는 유한한 `[0,1]`이고 `score >= threshold`일 때 일치다. 필요한 비교를
완료할 수 없으면 신규 생성 근거가 없으므로 그 triple만 operational skip한다.

**Rationale**: 입력 embedding 반복 생성은 비용이 크고, 판정 불가를 mismatch로 취급하면 중복 semantic을
만든다.

**Alternatives considered**: 실패 시 무조건 신규 생성과 persistent embedding cache를 제외한다.

## 6. coalescing과 결과 대사

**Decision**: normalized SPO 중복과 동일 target으로 수렴한 occurrence를 invocation 안에서 합친다. target별
최고 confidence 하나만 primary에 반영하고, 첫 입력 위치 순서로 처리한다. 모든 입력 위치는 created,
updated, skipped, duplicate 중 하나다.

**Rationale**: 한 episodic 호출은 한 semantic target에 한 evidence occurrence만 제공해야 `num_times`와
aggregate가 입력 중복에 의해 부풀지 않는다.

**Alternatives considered**: raw SPO dedupe는 normalization 뒤 같아지는 triple을 잡지 못하고, 전부 반영하면
한 source의 중복이 독립 증거가 된다.

## 7. transaction 경계

**Decision**: fallible 계산은 write transaction 밖에서 끝내고, 짧은 conversion commit에 source 재검증,
semantic/KG primary, source success tuple만 넣는다. candidate가 stale이면 transaction을 끝낸 뒤 한 번만
재판정하고 새 transaction에서 재시도한다.

**Rationale**: SQLite WAL lock 시간을 제한하면서 source 성공과 semantic primary의 원자성을 지킨다. 기존
async transaction helper는 같은 DB의 겹친 호출에 callback을 중첩할 수 있으므로, 외부 await가 없는 짧은
DB 원자 구간과 conditional changes 검사가 single-winner 근거가 되어야 한다.

**Alternatives considered**: LLM/embedding의 transaction 포함, semantic과 source의 분리 commit, 전역
mutex/lease를 제외한다.

## 8. 자동 진입점 공통화

**Decision**: remember augmentation, `ConvertEpisodicToSemanticTool`, `TripleExtractionBatchJob`이 하나의 작은
internal episodic conversion coordinator를 사용한다. 기존 semantic service API와 도구 응답은 유지한다.

**Rationale**: 세 경로가 source status, confidence average, failure 의미를 각각 구현해 drift가 이미 있다.
한 source conversion unit을 재사용하는 것이 가장 작은 root-cause 수정이다.

**Alternatives considered**: 세 caller 개별 패치와 public conversion framework/factory를 제외한다.

## 9. 후속 작업과 관측

**Decision**: relation direction/type는 primary 전 검증한다. 실제 `extracted_from`, `supported_by`, semantic
embedding, statistics는 commit 뒤 모두 시도해 settle하고, 서로의 실패가 primary/result/source success를
바꾸지 않게 한다. duplicate relation은 metadata 갱신 없는 no-op이다.

**Rationale**: 계약 오류는 write 전에 막아야 하지만 operational side effect는 durable primary를 롤백하거나
전체 retry를 만들면 안 된다.

**Alternatives considered**: fire-and-forget과 relation/embedding의 primary transaction 포함을 제외한다.

## 10. batch policy, retry와 clock

**Decision**: execute 진입 시 scalar/backoff 배열을 복사해 default/validate하고, retry eligibility용 wall clock과
timeout용 monotonic elapsed clock을 분리한다. status/retry/due validation 뒤 `created_at`, ID 순으로 batch limit을
채운 고정 candidate set을 사용한다. source는 직렬 처리한다.

**Rationale**: 현재 limit 후 retry filtering은 due가 아닌 앞 행이 뒤의 처리 가능 행을 굶긴다. exact 24-hour
duration과 고정 set은 결정성과 timeout 의미를 보장한다. 새 index 없이 ordered iteration으로 충분하다.

**Alternatives considered**: source별 config 재평가, `Math.floor(daysBetween)`, candidate top-up, parallelism 확대를
제외한다.

## 11. batch error/result contract

**Decision**: genuine pre-commit failure만 conditional failure-state transaction으로 failed/abandoned와 retry를
증가시킨다. stale/losing attempt는 skipped, job-level fatal은 durable prefix만 보존한다. 모든 반환은 fresh
Date/array/Map을 가지며 source 합계 invariant를 만족한다.

**Rationale**: 반환값은 durable 사실만 표현해야 전체 자동 retry가 evidence를 중복 반영하지 않는다.

**Alternatives considered**: chunk 잔여 길이의 failed 합성, deep-freeze/serialization, cached DB-bound semantic
service를 제외한다.

## 12. 테스트와 데이터 취급

**Decision**: canonical in-memory DB helper와 deterministic fake dependencies/clocks를 사용한다. 운영 분포는
read-only aggregate로만 확인하고 raw/derived corpus는 커밋하지 않는다. 기존 2,473줄 service spec에 모든
케이스를 더하지 않고 quality persistence와 batch contract를 focused spec으로 분리한다.

**Rationale**: 현재 batch spec의 축약 schema와 real extractor 의존은 경계/동시성 테스트를 불안정하게 한다.
새 focused specs가 실패 원인을 작게 유지한다.

**Alternatives considered**: production rows를 fixture로 저장하거나 schema 변화 없는 migration test를 추가하지
않는다.

