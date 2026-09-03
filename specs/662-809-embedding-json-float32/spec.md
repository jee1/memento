# Feature Specification: 임베딩 JSON 텍스트 → Float32 바이너리 저장

**Feature Branch**: `feature/perf-embedding-json-float32-233mb-45mb`
**Spec Directory**: `specs/662-809-embedding-json-float32`
**Created**: 2026-09-01
**Status**: Draft (ready for `/speckit.plan`)
**Issue**: [#809](https://github.com/jee1/memento/issues/809)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #755, #804, #805, #806, #807
**Input**: User description: "https://github.com/jee1/memento/issues/809 — perf(embedding): 임베딩 JSON → Float32 바이너리 저장"

## Problem Statement

`memory_embedding` 테이블이 벡터를 **JSON 텍스트 배열**로 저장한다. 384차원 minilm 1행 실측:

| 항목 | 값 |
|---|---:|
| 저장 바이트 | 8,062 |
| float32 이론값 (384×4) | 1,536 |
| 팽창 배율 | **5.2×** |

격리(#804) **이전**에는 27,578행·233MB였고, 격리 **이후**(2026-08-25 실측)에는 4,580행·38MB·DB 전체 127MB다. JSON→float32 전환 시 절감은 **약 31MB**(38→7MB)이며, 이슈 제목의 233→45MB는 격리 전 전제다. 에픽 #803의 "DB 300MB 미만"은 격리만으로 **이미 달성**(127MB)됐다.

그럼에도 `memory_embedding`은 DB의 **가장 큰 단일 테이블**(127MB 중 30%)이며, 검색·통합·앵커 등 여러 경로에서 행마다 JSON 파싱 비용과 I/O 낭비가 발생한다.

## Goals

- 임베딩 **값은 동일**, **표현만** Float32 `BLOB`으로 전환해 저장·I/O·CPU 낭비를 줄인다.
- 기존 행을 **재임베딩 없이** 마이그레이션하고, 벡터 검색 결과가 전후 동일함을 검증한다.
- `sqlite-vec` 가상 테이블(`memory_item_vec_*`)과 메타데이터(`precision`, `normalized`) 정합을 맞춘다.
- 마이그레이션은 #755 패턴(단일 트랜잭션)으로 원자성을 보장한다.

## Non-Goals

- 임베딩 모델·차원·제공자 변경 또는 재계산
- 검색 랭킹 가중치·임계값·#806/#807 알고리즘 변경
- MCP 도구 응답 형식 변경(벡터는 내부 저장소 전용)
- `memory_forgetting_event` 등 다른 대형 테이블 최적화(#810 등 후속)
- 프로덕션 DB를 커밋하거나 공개 문서에 절대 경로·원문 노출
- 마이그레이션 완료 후 JSON 임베딩 dual-read 유지

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 운영 DB가 작아지고 백업·배포가 가벼워진다 (Priority: P1)

DB 운영자는 마이그레이션 후 `memory_embedding` 테이블과 전체 DB 크기가 줄어든 것을 확인한다. 백업 파일·Docker 이미지에 실리는 DB 용량과 디스크 I/O 부담이 낮아져야 한다.

**Why this priority**: 저장 공간과 I/O가 직접적인 운영 비용이다. 격리 후에도 `memory_embedding`이 DB의 최대 테이블이므로 효과가 남아 있다.

**Independent Test**: 마이그레이션 전후 `dbstat`(또는 동등한 크기 측정)로 `memory_embedding`·전체 DB 바이트를 비교하면 통과다.

**Acceptance Scenarios**:

1. **Given** 격리 후 규모의 라이브 DB(약 4,580행), **When** 마이그레이션·`VACUUM` 후 크기를 측정하면, **Then** `memory_embedding`은 60MB 미만이다.
2. **Given** 동일 DB, **When** 전체 크기를 측정하면, **Then** DB 전체는 300MB 미만을 유지한다(에픽 #803 기준; 격리 후에도 회귀 없음).
3. **Given** 마이그레이션 전 백업, **When** 마이그레이션을 실행하면, **Then** 실패 시 롤백으로 기존 JSON 형식 데이터가 보존된다.

---

### User Story 2 - 검색 결과가 마이그레이션 전과 같다 (Priority: P1)

검색 품질 담당자는 동일 쿼리 집합에 대해 마이그레이션 전후 top-10 기억 ID와 순서가 일치함을 확인한다. 저장 형식만 바뀌었을 뿐 의미적 검색 동작은 변하지 않아야 한다.

**Why this priority**: 바이너리 전환은 무손실 재인코딩이 전제다. 결과가 달라지면 데이터 손상 또는 vec 인덱스 불일치다.

**Independent Test**: 고정 쿼리·DB 스냅샷으로 전후 top-10을 diff하면 통과다.

**Acceptance Scenarios**:

1. **Given** 마이그레이션 직전 DB 스냅샷과 고정 쿼리 세트, **When** 전후 각각 recall(또는 동등 벡터 검색)을 실행하면, **Then** top-10 memory ID와 순서가 100% 일치한다.
2. **Given** 여러 임베딩 제공자(minilm·openai·tfidf 등)가 공존하는 DB, **When** 제공자별 대표 쿼리를 실행하면, **Then** 각 제공자 경로에서도 top-10이 전후 일치한다.
3. **Given** 마이그레이션 완료 DB, **When** `memory_item_vec_*` 행 수와 `memory_embedding` 필터 조건 행 수를 대조하면, **Then** vec 인덱스 cardinality 불일치가 0건이다.

---

### User Story 3 - 검색 지연이 개선되거나 최소한 나빠지지 않는다 (Priority: P2)

에이전트·운영자는 recall 호출 지연이 JSON 파싱 제거로 개선되거나, 최소한 기존 baseline(117~180ms)을 넘지 않음을 확인한다.

**Why this priority**: CPU 절감이 체감 성능으로 이어져야 한다. 다만 측정 환경 편차가 크므로 P1 검색 정확성 다음 순위다.

**Independent Test**: 동일 환경에서 마이그레이션 전후 recall p50/p95를 비교하면 통과다.

**Acceptance Scenarios**:

1. **Given** 동일 하드웨어·DB·쿼리 워밍업 후, **When** recall 20회 이상을 측정하면, **Then** p95가 180ms를 초과하지 않거나, 전 대비 10% 이상 개선된다.
2. **Given** 마이그레이션 후 DB, **When** 검색 hot path에서 임베딩을 읽으면, **Then** JSON 텍스트 파싱 없이 바이너리 뷰로 벡터를 얻는다.

---

### User Story 4 - 메타데이터가 실제 벡터와 일치한다 (Priority: P2)

운영자는 `precision`·`normalized` 컬럼이 실제 저장 정밀도·노름과 일치함을 확인한다. 특히 `normalized=0`인데 L2 norm≈1.0인 불일치를 수정한다.

**Why this priority**: 잘못된 메타데이터는 이후 정규화·제공자 분기·진단을 오염시킨다. 저장 형식 변경과 함께 정리하는 것이 자연스럽다.

**Independent Test**: 마이그레이션 후 샘플 행에서 `precision=32`, `normalized`가 실제 norm과 일치하면 통과다.

**Acceptance Scenarios**:

1. **Given** float32 BLOB으로 저장된 행, **When** `precision` 컬럼을 읽으면, **Then** 32(또는 명세된 float32 코드)와 일치한다.
2. **Given** L2 norm이 1.0에 가까운 벡터(|norm − 1.0| < 1e−5), **When** `normalized`를 확인하면, **Then** 1(또는 true)로 기록되어 있다.

---

### Edge Cases

- **JSON이 아닌 빈·손상 문자열**: 마이그레이션은 실패를 기록하고 트랜잭션 롤백; 부분 적용 금지.
- **차원 불일치**: `dim`/`dimensions`와 BLOB 길이(×4) 또는 JSON 파싱 결과 길이가 다르면 해당 행 거부 → 마이그레이션 전체 중단·롤백.
- **레거시 `[]` 빈 배열**: 행은 **skip** — `dim=0`, `dimensions=0`으로 저장하고 vec 트리거 필터(`dimensions = N`, N>0)에 의해 vec 적재에서 **자동 제외**. skip 건수는 마이그레이션 리포트에 기록.
- **NaN·Inf in JSON**: 파싱된 float 중 NaN 또는 ±Inf가 하나라도 있으면 해당 행 거부 → 마이그레이션 전체 중단·롤백(원자성).
- **엔디안**: BLOB은 **little-endian** float32 시퀀스(Node `Float32Array`/`Buffer` 기본). big-endian 플랫폼에서도 LE로 직렬화·역직렬화.
- **다중 제공자·projection_type**: UNIQUE `(memory_id, embedding_provider, projection_type)` 유지; 행별 독립 재인코딩.
- **vec 트리거 `json_extract` 의존**: BLOB 전환 후 `json_extract(NEW.embedding,'$')`는 무효. 트리거·재적재는 **`NEW.embedding` BLOB을 vec에 직접 전달**하도록 갱신.
- **vec 재적재 cutover 순서**: 단일 트랜잭션 성공 → 트랜잭션 **밖**에서 (1) 모든 vec 테이블 전량 DROP+재생성 또는 TRUNCATE+재적재, (2) `recreateVecTriggers`. 트랜잭션 중 vec 재적재는 트리거 OFF 상태이므로 cutover 후 일괄 수행.
- **신규 INSERT/UPDATE**: 마이그레이션 후 신규 기록도 BLOB만 허용; JSON 쓰기 경로 제거.
- **읽기 경로 dual-read 없음**: big-bang cutover — 마이그레이션 완료 후 JSON.parse 기반 임베딩 읽기 경로는 **제거**. 롤백 시에만 JSON 형식 live 테이블 유지.
- **`PRAGMA foreign_keys` OFF**: #804 교훈 — 마이그레이션 세션에서 FK ON 확인; vec orphan 검증 포함.
- **실패 후 `memory_embedding__new` 잔존**: #755 — 단일 트랜잭션 실패 시 live 테이블·트리거·`__new` staging 모두 롤백; 성공 시에만 rename으로 `__new` 소멸.
- **VACUUM 타이밍**: 크기 측정(SC-001/002)은 마이그레이션 **성공 후** 별도 단계에서 `VACUUM` 실행 뒤 수행. `VACUUM`은 트랜잭션 밖(마이그레이션 atomicity와 분리).
- **동시 쓰기**: 마이그레이션은 **서버 기동 시** `migrate.ts` 경로에서만 실행. MCP stdio·HTTP admin이 동일 DB에 쓰는 중이면 마이그레이션 거부 또는 운영 절차상 단독 기동 필수(배포 전 MCP 중지).
- **Admin embedding map**: HTTP 응답 스키마·MCP 계약 불변. 내부 read adapter가 BLOB→number[] 변환; 기존 JSON.parse 호출부 갱신.
- **테스트 fixture·CI**: 합성 DB fixture는 BLOB 형식 또는 마이그레이션 헬퍼로 생성; JSON 문자열 fixture는 마이그레이션 spec·round-trip 테스트에서 갱신.
- **normalized≈1.0 정의**: L2 norm에 대해 **|norm − 1.0| < 1e−5** 이면 `normalized=1`로 교정; 그 외는 `normalized=0`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `memory_embedding.embedding`은 float32 little-endian `BLOB`으로 저장해야 하며, JSON 텍스트 배열 저장은 신규·갱신 경로에서 금지된다.
- **FR-002**: 마이그레이션은 기존 JSON 값을 파싱해 동일 float32 값으로 BLOB에 재인코딩해야 하며, **재임베딩(모델 재호출)을 수행해서는 안 된다**.
- **FR-003**: 마이그레이션의 create/copy/drop/rename 및 vec 관련 트리거 DROP은 **단일 `db.transaction()`** 안에서 원자적으로 수행되어야 한다 (#755). 성공 후 vec 트리거 재생성은 트랜잭션 밖.
- **FR-004**: 마이그레이션 실행 전 **DB 백업**과 `npm run db:pre-docker-deploy` 무결성 점검이 완료되어야 한다. 미통과 시 실행을 거부한다.
- **FR-005**: 모든 임베딩 **읽기 hot path**는 JSON.parse 없이 BLOB→Float32Array(또는 동등 뷰)로 벡터를 얻어야 한다.
- **FR-006**: `sqlite-vec` 가상 테이블(`memory_item_vec`, `memory_item_vec_*`)은 BLOB 저장과 **정합**을 유지해야 한다. insert/update 트리거·재적재 경로가 BLOB을 vec에 **직접** 적재함을 검증한다(`json_extract` 사용 금지).
- **FR-007**: 마이그레이션 전후 고정 쿼리 세트에 대해 **top-10 memory ID·순서가 100% 일치**해야 한다.
- **FR-008**: `precision` 컬럼은 실제 저장 정밀도(float32 → 32)와 일치해야 한다.
- **FR-009**: L2 norm **|norm − 1.0| < 1e−5** 인 벡터는 `normalized` 메타데이터가 1(true)로 기록되어야 한다. 마이그레이션 시 일괄 교정 가능.
- **FR-010**: 마이그레이션·`VACUUM` 후 `memory_embedding` 테이블 크기는 **60MB 미만**이어야 한다(격리 후 규모 DB 기준).
- **FR-011**: 마이그레이션·`VACUUM` 후 **전체 DB**는 **300MB 미만**을 유지해야 한다.
- **FR-012**: recall(또는 동등 대표 검색) p95는 **180ms를 초과하지 않거나** 마이그레이션 전 대비 **10% 이상** 개선되어야 한다(동일 환경·워밍업 전제).
- **FR-013**: 스키마·마이그레이션·타입 정의·테스트 fixture를 **동기** 갱신해야 한다 (Constitution III).
- **FR-014**: MCP recall/remember 등 **공개 도구 계약**과 검색 응답 형식은 변경하지 않는다 (Constitution II). 변경은 내부 저장·직렬화에 한정.
- **FR-015**: 마이그레이션 실패 시 live `memory_embedding`과 데이터 행이 **롤백**되어 JSON 형식이 보존되어야 한다.
- **FR-016**: vec 트리거(`buildVecTriggerSql`)와 `repopulateVecTable`은 **`NEW.embedding` / `embedding` BLOB을 vec `embedding` 컬럼에 직접 전달**해야 하며, `json_extract(..., '$')`를 사용하지 않는다.
- **FR-017**: 마이그레이션 트랜잭션 성공 후, 트랜잭션 **밖**에서 **모든** 존재 vec 테이블을 전량 재적재한 뒤 `recreateVecTriggers`를 호출해야 한다.
- **FR-018**: JSON `[]`(빈 배열) 행은 BLOB 없이 `dim=0`, `dimensions=0`으로 이관하고 vec 필터에서 제외한다. skip 건수는 마이그레이션 리포트(로그)에 출력한다.
- **FR-019**: BLOB 직렬화는 **little-endian** float32 바이트 순서를 사용한다(Node `Float32Array`/`Buffer` 기본).
- **FR-020**: JSON 파싱 결과에 **NaN 또는 ±Inf**가 포함된 행은 거부하고, 마이그레이션 전체를 롤백한다.
- **FR-021**: 마이그레이션 완료 후 임베딩 읽기 경로에서 **JSON dual-read를 제거**한다. BLOB만 읽는다(롤백된 DB는 JSON 유지).
- **FR-022**: 마이그레이션은 **서버 기동 시 migrate 경로**에서만 실행한다. 배포·운영 절차상 MCP/HTTP가 동일 DB에 쓰지 않도록 하며, 동시 쓰기 경합 시 마이그레이션을 거부하거나 단독 기동을 요구한다.
- **FR-023**: Admin embedding map HTTP 응답 형식은 변경하지 않는다. 내부 adapter가 BLOB→number[] 변환을 담당한다.
- **FR-024**: `VACUUM`은 마이그레이션 트랜잭션 **성공 후** 별도 단계에서 실행하며, SC-001/002 크기 측정은 `VACUUM` 이후 수행한다.
- **FR-025**: CI·로컬 테스트 fixture 중 JSON 문자열 임베딩은 BLOB 형식 또는 마이그레이션 round-trip 헬퍼로 갱신해야 한다.

### Key Entities

- **memory_embedding**: 기억별 임베딩 저장 행. `embedding`(BLOB), `dim`, `dimensions`, `embedding_provider`, `projection_type`, `precision`, `normalized`, `model`, `version`.
- **memory_item_vec_***: sqlite-vec 가상 인덱스. `memory_embedding.id`를 rowid로 참조.
- **마이그레이션 트랜잭션**: JSON→BLOB 테이블 재구성 + vec 트리거 DROP의 원자 단위.
- **마이그레이션 cutover 후처리**: vec 전량 재적재 + 트리거 재생성 + (선택) VACUUM.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 마이그레이션·`VACUUM` 후 `memory_embedding` dbstat < 60MB.
- **SC-002**: 마이그레이션·`VACUUM` 후 전체 DB < 300MB.
- **SC-003**: 고정 쿼리 세트 top-10 전후 일치율 100%.
- **SC-004**: vec cardinality 진단(`memory_embedding` 필터 대비 vec 행 수) 불일치 0건.
- **SC-005**: recall p95 ≤ 180ms 또는 전 대비 ≥10% 개선(동일 환경 측정 기록).
- **SC-006**: 마이그레이션 실패 주입 테스트에서 live 테이블·행 수 survival (#755 회귀).
- **SC-007**: `npm run lint`, `npm run type-check`, `npm test` 통과 (Constitution IV).
- **SC-008**: 샘플 N≥100 행에서 `precision=32` 및 |norm−1.0|<1e−5 → `normalized=1` 일치율 100%.
- **SC-009**: 마이그레이션 리포트에 empty-`[]` skip 건수가 기록된다.

## Scope

### In Scope

- `memory_embedding.embedding` 컬럼 TEXT(JSON) → BLOB(float32) 스키마·마이그레이션
- 기존 행 JSON→BLOB 재인코딩 (재임베딩 없음)
- 읽기 경로 JSON.parse 제거 → 바이너리 뷰 (dual-read 없음)
- vec 트리거·`json_extract` 의존 제거 및 BLOB 직접 적재
- cutover 후 vec 전량 재적재 + 트리거 재생성
- `precision`·`normalized` 메타데이터 정합
- 마이그레이션 전 백업·무결성 점검·`VACUUM` 후 크기 측정
- top-10 동일성·vec cardinality·atomicity 회귀 검증
- Admin embedding map 내부 adapter 갱신

### Out of Scope

- #805·#806·#807 검색 품질·랭킹 변경
- `memory_forgetting_event` 등 다른 테이블 (#810)
- 임베딩 모델 업그레이드·차원 변경
- MCP/API 응답 스키마 변경
- 에픽 #803 "DB 300MB" 달성 자체(이미 127MB — 본 작업은 유지·회귀 방지)
- 라이브 DB 파일·절대 경로 커밋
- rolling dual-read·점진적 cutover

## Assumptions

- JSON→float32 재인코딩은 부동소수점 값을 보존한다(동일 파서·동일 endian).
- 격리 후 규모(≈4,580행·38MB)가 현재 운영 baseline이다; 233MB·27k행은 역사적 참고만.
- 절대 절감 ≈31MB이지만 I/O·CPU·백업 이득은 여전히 가치 있다.
- vec 트리거의 `json_extract(NEW.embedding, '$')`는 BLOB 전환 시 **반드시** `NEW.embedding` 직접 전달로 교체한다.
- sqlite-vec `vec0(embedding float[N])`는 float32 BLOB 입력을 수용한다(JSON 텍스트가 아님).
- #755 atomic rebuild 패턴이 본 마이그레이션의 필수 템플릿이다.
- recall 117~180ms baseline은 이슈 작성 시점 측정치; 환경 차는 artifact에 기록한다.
- empty `[]` 행은 극소수이며 vec 검색 대상이 아니다.

## Dependencies

- **#755**: memory_embedding rebuild 원자성 — 동일 migrate.ts 패턴
- **#804**: 격리 후 행 수·크기 전제 갱신 (이슈 코멘트 2026-08-25)
- **#803**: 에픽 — DB 크기·품질 맥락
- **AGENTS.md §3.1**: `db:pre-docker-deploy`, memory_embedding migrate rebuild, vec trigger 재생성 순서

## Open Questions

| # | 질문 | 결론 | 반영 위치 |
|---|------|------|-----------|
| Q1 | 격리 후에도 우선순위가 있는가? | **있다.** 절감 31MB로 축소됐지만 최대 테이블·JSON parse CPU·I/O 낭비는 남음. #805/#806 대비 우선순위는 medium(이슈 라벨) — 본 스펙은 착수 가능으로 기록. | Problem Statement, Assumptions |
| Q2 | rolling dual-read vs big-bang cutover? | **big-bang cutover(단일 마이그레이션 트랜잭션)**. #755 패턴과 일치; dual-read는 범위·복잡도만 증가. 실패 시 롤백으로 JSON 유지. 마이그레이션 성공 후 JSON read path 제거(FR-021). | FR-003, FR-015, FR-021, Edge Cases |
| Q3 | vec 트리거를 어떻게 BLOB에 맞출 것인가? | **`json_extract` 제거, BLOB 직접 전달.** `buildVecTriggerSql`/`repopulateVecTable`에서 `SELECT NEW.id, NEW.embedding`(또는 `embedding` 컬럼)으로 vec에 적재. 트랜잭션 성공 후 **모든** vec 테이블 전량 재적재 → `recreateVecTriggers`(트랜잭션 밖). | FR-006, FR-016, FR-017, Edge Cases |
| Q4 | 60MB·300MB SC는 격리 후에도 유효한가? | **유효.** 38→7MB 예상 + VACUUM; 전체 127MB→~100MB대. 60MB/300MB는 여유 있는 상한. | SC-001, SC-002 |
| Q5 | normalized 일괄 수정 범위? | **마이그레이션 시 |norm−1.0|<1e−5이면 normalized=1로 교정.** 신규 write path도 동일 규칙. | FR-009, US4, Edge Cases |
| Q6 | empty `[]` 행 처리? | **skip — dim=0/dimensions=0, vec 제외, 리포트에 건수 기록.** | FR-018, SC-009, Edge Cases |
| Q7 | NaN/Inf 처리? | **행 거부 → 마이그레이션 전체 롤백.** | FR-020, Edge Cases |
| Q8 | 엔디안? | **little-endian float32 (Node 기본).** | FR-001, FR-019, Edge Cases |
| Q9 | 동시 쓰기·마이그레이션 타이밍? | **기동 시 migrate.ts만.** MCP/HTTP 동시 쓰기 금지(운영 절차 또는 거부). | FR-022, Edge Cases |
| Q10 | Admin embedding map? | **내부 BLOB adapter, HTTP/MCP 계약 불변.** | FR-023, Edge Cases |
| Q11 | VACUUM vs atomicity? | **VACUUM은 트랜잭션 밖, 성공 후 SC 측정 전 실행.** | FR-024, Edge Cases |
| Q12 | 성능 gate 정의? | **p95 ≤180ms OR ≥10% 개선 vs baseline.** | FR-012, SC-005, US3 |

## Brainstorm Log

### 2026-09-01 — specify 초안 (#809)

- 이슈 본문·#804 격리 코멘트·schema/trigger `json_extract` 의존·#755 atomic pattern을 반영.
- 스펙은 구현 파일명 없이 요구·측정·범위 위주(659-806 선례).
- `[NEEDS CLARIFICATION]` 0건 — Q1~Q5 코드·이슈 실측으로 해소.

### 2026-09-01 — brainstorm session 1 (boundary)

- **empty `[]`**: skip, dim=0, vec 필터 제외, 리포트 건수 → FR-018, SC-009.
- **dimension mismatch**: BLOB byte length ÷ 4 vs dim/dimensions 불일치 시 전체 롤백.
- **NaN/Inf**: 단일 행이라도 발견 시 atomic rollback → FR-020.
- **endian**: LE float32 only → FR-019.
- **normalized≈1.0**: |norm−1.0| < 1e−5 → FR-009, Q5 구체화.

### 2026-09-01 — brainstorm session 2 (error)

- **partial migration**: #755 단일 트랜잭션; `__new` staging 포함 전체 롤백.
- **vec cutover**: 트랜잭션 중 트리거 OFF → 성공 후 전 vec 테이블 전량 repopulate → recreateVecTriggers.
- **malformed JSON**: parse 실패 = migration fail + rollback.
- **Q3 resolved**: BLOB direct pass, no json_extract.

### 2026-09-01 — brainstorm session 3 (scale & performance)

- **concurrent writes**: startup-only migrate; MCP/HTTP 단독 기동 요구 → FR-022.
- **VACUUM**: post-txn, pre-SC measurement → FR-024.
- **perf gate**: p95 ≤180ms OR ≥10% improvement → FR-012, SC-005.
- **legacy dual-read removal**: post-cutover JSON paths removed → FR-021.

### 2026-09-01 — brainstorm session 4 (security & UX)

- **Admin embedding map**: internal adapter only; no public contract change → FR-023.
- **test fixtures**: JSON string fixtures must migrate to BLOB or helper → FR-025.
- **MCP recall/remember**: unchanged (Constitution II) — FR-014 재확인.
- **migration report**: skip counts observable; no absolute DB paths in logs (AGENTS.md).
