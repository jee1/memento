# Feature Specification: Epic #748 Tech-Debt (2026-08 운영·보안·배포)

**Feature Branch**: `060-chore-tech-debt-2026-08`  
**Created**: 2026-08-15  
**Status**: Implemented  
**Parent Epic**: #748  
**Input**: User description: "GitHub epic #748 — chore(tech-debt): 2026-08 운영·보안·배포 부채 해소. 데이터 손실·채널 격리 실패·배포 실패·거짓 CI green 위험이 큰 부채를 독립 소형 PR로 제거. 신규 기능·대형 재설계 없음."

---

## Goal

신규 기능·대규모 재설계 없이, **데이터 손실 / 정보 격리 실패 / 배포 실패 / 거짓 CI green** 위험이 높은 운영·보안·배포 부채를 자식 이슈 단위의 독립 소형 PR로 해소한다.

**Baseline (에픽 공통)**:
- `npm run check-debt-markers -- --production-only` 통과
- `npm run type-check` · `npm run lint` 통과
- production `src` 루트 7개 유지(에픽 기준)

각 이슈는 constitution **Test-First Delivery**에 따라 실패 재현/회귀 테스트 선행 → 수정 → 통과, 완료 전 **Quality Gates**(`lint` · `type-check` · 대상 테스트) 통과. production 코드 변경 시 graphify 재빌드. PR은 `Fixes #<sub-issue>` 및 `Part of #748`를 명시한다.

---

## Scope

| Issue | Title | Phase |
|-------|-------|-------|
| #752 | fix(pack): 배포 tarball 런타임 의존성 closure 검증 | P0 |
| #754 | fix(recall): 필터 wire contract 정렬 및 채널 격리 복원 | P0 |
| #750 | fix(scripts): monorepo 이동 후 운영 명령 import 경로 복구 | P0 |
| #755 | fix(db): memory_embedding 재구축 migration 원자성 보장 | P0 |
| #751 | fix(ci): nightly MigrationRunner 테스트 실제 실행 보장 | P0 |
| #756 | chore(security): fixable production 취약점 해소 및 audit gate 추가 | P0 |
| #753 | perf(embedding): metadata 보정을 hot path에서 migration으로 이동 | P1 |
| #749 | test(architecture): 의존 방향·runtime cycle 회귀 차단 | P1 |

---

## Non-Goals

- 완료된 에픽 #593 / #680 대형 파일 분해 재작업
- upstream 수정 없는 ML 의존성(onnxruntime / sharp 등) 강제 override
- 신규 프레임워크·불필요한 추상화·불필요한 bundler 도입
- package 구조 재설계 (#752)
- eslint / vitest major 업그레이드 (#756)
- 알고리즘·랭킹 공식 변경, Public API 의도적 breaking change

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - #752 배포 tarball 런타임 closure 검증 (Priority: P1)

배포 담당자가 `npm pack`으로 만든 tarball을 워크스페이스 없는 빈 임시 디렉터리에 설치해도 루트 bin(`dist/server`)이 런타임에 기동된다. 현재 `@memento/agent-integration`, `express-rate-limit`, `helmet`, `umap-js` 등 누락 external이 원인인 설치·기동 실패를 막고, `verify-npm-pack-bundle`이 `@memento/core`만이 아니라 **server 런타임 closure**까지 검증한다. (`@memento/agent-integration`은 registry에 없음을 전제로 한다.)

**Why this priority**: 배포 실패는 운영 중단으로 직결되며, CI가 pack을 “통과”해도 실제 설치가 깨지면 거짓 green이 된다.

**Independent Test**: 빈 temp에 pack 설치 + workspace-less bin smoke + 누락 external 회귀 테스트만으로 검증 가능. 다른 이슈와 무관.

**Acceptance Scenarios**:

1. **Given** 루트에서 `npm pack`으로 생성한 tarball, **When** 워크스페이스 없는 빈 temp에 설치하고 bin을 smoke 실행하면, **Then** 누락 런타임 의존성으로 실패하지 않는다.
2. **Given** server 런타임에 필요한 external이 package 메타데이터에서 빠지면, **When** `verify-npm-pack-bundle`(또는 동등 검증)을 실행하면, **Then** 실패하여 회귀를 차단한다.
3. **Given** 수정 완료 상태, **When** 대상 테스트 · `type-check` · `lint`를 실행하면, **Then** 모두 통과한다.

---

### User Story 2 - #754 recall 필터 wire contract·채널 격리 복원 (Priority: P1)

클라이언트가 `filters` 객체로 보낸 tags/type 등이 RecallTool에서 적용되고, `crossChannelRecall=off`일 때 다른 채널 기억이 0건으로 격리된다. 스킵된 `channel-isolation.e2e`를 다시 실행하고, assistant CI가 `test/`를 포함하도록 한다. 잘못된/누락 `filters`에 대해 공개 계약 호환을 유지한다.

**Why this priority**: 채널 격리 실패는 정보 유출·교차 오염이며, e2e/CI 스킵은 거짓 green을 만든다.

**Independent Test**: 필터 적용 단위/통합 테스트 + channel-isolation e2e unskip + assistant CI 경로 포함만으로 독립 검증.

**Acceptance Scenarios**:

1. **Given** 클라이언트가 `filters` 객체로 tags/type 등을 전송, **When** recall을 호출하면, **Then** RecallTool이 해당 필터를 적용한다(top-level만 읽는 불일치 해소).
2. **Given** `crossChannelRecall=off`와 다중 채널 데이터, **When** 한 채널에서 recall하면, **Then** 다른 채널 기억은 0건이다.
3. **Given** 이전엔 skip이던 channel-isolation e2e와 assistant `test/` 경로, **When** CI/로컬 게이트를 돌리면, **Then** e2e가 실행·통과하고 assistant CI가 `test/`를 포함한다.
4. **Given** malformed 또는 missing `filters`, **When** recall을 호출하면, **Then** 기존 API 호환 동작(문서화된 안전 처리)을 유지한다.

---

### User Story 3 - #750 monorepo 이후 운영 스크립트 import 경로 복구 (Priority: P1)

운영자가 등록된 npm 스크립트로 분석을 실행할 때, 사라진 루트 `src/` import로 인한 `ERR_MODULE_NOT_FOUND`가 없다. 테스트는 SQL을 재구현하지 않고 CLI/import 경로를 검증한다.

**Why this priority**: 운영 명령 불능은 장애 대응·점검을 막고, 테스트가 CLI를 우회하면 회귀가 숨는다.

**Independent Test**: 등록 npm 스크립트의 root `src` import 0건 검사 + `--help`/analyze smoke + CI smoke만으로 검증.

**Acceptance Scenarios**:

1. **Given** package.json에 등록된 운영 npm 스크립트, **When** import 경로를 검사하면, **Then** 존재하지 않는 루트 `src/` 참조가 0건이다.
2. **Given** 복구된 CLI, **When** `--help` 및 analyze 계열 smoke를 실행하면, **Then** 모듈 not found 없이 정상 종료한다.
3. **Given** 파라미터화된 CLI/import smoke 테스트, **When** CI가 해당 smoke를 실행하면, **Then** 통과한다(SQL 재구현 테스트로 대체하지 않음).

---

### User Story 4 - #755 memory_embedding 재구축 migration 원자성 (Priority: P1)

DB 운영자가 `memory_embedding` 재구축 migration을 실행할 때 create/copy/drop/rename이 **단일 트랜잭션**으로 묶여, 중간 실패 시 테이블이 드롭된 채 남지 않고 롤백으로 데이터가 보존된다. 성공·멱등성도 보장한다. (Constitution III: Schema and Migration Discipline)

**Why this priority**: 중간 실패 시 테이블 유실은 데이터 손실로 직결된다.

**Independent Test**: 실패 주입 롤백 + 성공/멱등 테스트만으로 독립 검증. graphify 재빌드 포함.

**Acceptance Scenarios**:

1. **Given** embedding 재구축 migration, **When** create → copy → drop → rename을 수행하면, **Then** 전 단계가 하나의 트랜잭션 안에서 실행된다.
2. **Given** copy 등 중간 단계 실패 주입, **When** migration이 중단되면, **Then** 롤백되어 기존 테이블·데이터가 온전하다.
3. **Given** 정상 DB, **When** migration을 성공 실행하고 재실행하면, **Then** 성공하며 멱등하다.
4. **Given** 수정 완료, **When** 대상 테스트 · lint · type-check · graphify를 수행하면, **Then** 게이트를 통과한다.

---

### User Story 5 - #751 nightly MigrationRunner 테스트 실제 실행 (Priority: P1)

nightly 담당자가 MigrationRunner 통합 테스트가 **실제로 수집·실행**되는지 확인할 수 있다. `CI=true`와 vitest 설정 때문에 0건 실행되던 상태를 제거하고, 0 tests는 스텝 실패로 취급한다. PR CI의 exclude 의도는 유지한다.

**Why this priority**: nightly가 0 tests로 green이면 마이그레이션 회귀가 감지되지 않는다(거짓 green).

**Independent Test**: nightly 워크플로/ vitest 설정 검증 + MigrationRunner 9건 수집 확인만으로 독립 검증.

**Acceptance Scenarios**:

1. **Given** nightly 환경, **When** MigrationRunner 관련 vitest를 수집하면, **Then** 9개 테스트가 수집·실행된다.
2. **Given** 어떤 이유로 해당 스위트가 0 tests를 보고하면, **When** CI 스텝이 종료되면, **Then** 실패로 처리된다.
3. **Given** PR CI, **When** 기존 exclude 의가 적용되면, **Then** PR 게이트의 제외 정책은 유지된다(nightly만 실실행 보장).

---

### User Story 6 - #756 fixable production 취약점·audit gate (Priority: P1)

보안 담당자가 production(`npm audit --omit=dev`)에서 fixable High/Moderate를 0으로 만들고, security 워크플로에 audit gate를 둔다. fixable 대상은 `@hono/node-server`, `hono`, `fast-uri`, `ip-address`, `protobufjs`의 **wanted** 범위만. upstream-blocked는 문서화한다.

**Why this priority**: 알려진 fixable 취약점과 gate 부재는 배포·공급망 리스크를 방치한다.

**Independent Test**: audit 전후 수치 + security workflow gate + smoke/gates만으로 검증. ML force override·eslint/vitest major는 Non-Goals.

**Acceptance Scenarios**:

1. **Given** production audit, **When** fixable High/Moderate를 해소하면, **Then** 해당 카운트가 0이다.
2. **Given** security 워크플로, **When** `npm audit --omit=dev` gate를 실행하면, **Then** 정책 위반 시 실패한다.
3. **Given** upstream-blocked 항목, **When** 문서를 확인하면, **Then** 차단 사유가 기록되어 있다.
4. **Given** 의존성 변경, **When** 관련 없는 major를 끌어오면, **Then** 범위 밖이므로 포함하지 않는다; smoke · lint · type-check 통과.

---

### User Story 7 - #753 embedding metadata 보정을 migration으로 이동 (Priority: P2)

시스템 관리자/런타임이 create·search·stats **hot path**에서 테이블 전역 `UPDATE`로 metadata 기본값을 고치지 않는다. bootstrap/migration에서 한 번 보정하고, 신규 행은 기본값을 가지며, legacy fixture·query-count 테스트로 회귀를 막는다.

**Why this priority**: P0 대비 성능·부하 부채이며, 격리·데이터 손실보다 우선순위는 낮다.

**Independent Test**: hot path query-count(테이블 전역 repair 0) + migration/legacy fixture 테스트로 독립 검증. graphify 포함.

**Acceptance Scenarios**:

1. **Given** 부트스트랩/마이그레이션, **When** 한 번 실행하면, **Then** legacy metadata 기본값 보정이 완료된다.
2. **Given** create/search/stats hot path, **When** 요청을 처리하면, **Then** 테이블 전역 repair `UPDATE`가 0회이다.
3. **Given** 신규 행, **When** 삽입하면, **Then** metadata 기본값이 적용된다.
4. **Given** legacy fixture + query-count 테스트, **When** 게이트를 실행하면, **Then** 통과한다.

---

### User Story 8 - #749 의존 방향·runtime cycle 회귀 차단 (Priority: P2)

아키텍처 담당자가 domain→infra, shared→infra/server 등 금지 방향과 runtime cycle 2건을 CI로 막는다. 기존 allowlist 위반만 근거와 함께 남기고, allowlist 무분별 증가는 실패하거나 리뷰를 요구한다. 단순 relation 패턴만 보던 테스트를 강화한다.

**Why this priority**: 구조 회귀 방지(P1). 즉각적 데이터/배포 장애보다 우선순위는 낮다.

**Independent Test**: architecture 테스트만으로 독립 검증. graphify 포함.

**Acceptance Scenarios**:

1. **Given** 허용 목록에 있는 기존 위반, **When** architecture 테스트를 실행하면, **Then** 근거(rationale)와 함께 통과한다.
2. **Given** 신규 domain→infra 또는 shared→infra/server 위반, **When** CI를 실행하면, **Then** 실패한다.
3. **Given** 기존 2 runtime cycles, **When** 수정 후 테스트를 실행하면, **Then** cycle이 제거된 상태로 통과한다.
4. **Given** allowlist 항목 추가, **When** 무분별히 증가시키면, **Then** 테스트가 실패하거나 명시적 리뷰 절차가 필요하다.

---

### Edge Cases

- **#752**: registry에 없는 `@memento/agent-integration`을 외부 설치만으로 해결할 수 없는 경우 — pack/bundle closure가 workspace 산출물을 포함하거나 동등하게 런타임에 제공해야 한다. 불필요한 bundler 도입은 Non-Goal.
- **#754**: `filters` 누락·부분·잘못된 타입; top-level과 `filters` 동시 존재 시 호환 규칙(기존 계약 유지, breaking 금지).
- **#750**: 스크립트가 간접 require/dynamic import로 옛 경로를 참조하는 경우도 “등록된 npm 스크립트 경로” 검사에 포함되어야 한다.
- **#755**: 트랜잭션 미지원/중첩 실패, 재실행(멱등), disk full 등 실패 주입 후에도 드롭된 빈 상태로 남지 않을 것.
- **#751**: PR CI exclude와 nightly include가 설정을 공유할 때, 한쪽에만 적용되도록 분리; “0 tests = green” 방지.
- **#756**: fixable이 아닌(upstream-blocked) High/Moderate; wanted 범위 밖 major를 끌어오지 말 것; onnxruntime/sharp force override 금지.
- **#753**: migration 미적용 legacy DB에 대한 최초 기동; hot path에서 조용히 전역 UPDATE가 되살아나는 회귀.
- **#749**: allowlist 우회용 문자열 트릭; cycle이 import type만으로 해소된 것처럼 보이지만 런타임 cycle이 남는 경우.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 `npm pack` tarball의 **server 런타임 의존성 closure**를 검증해야 하며, 누락 external이 있으면 검증이 실패해야 한다. (#752)
- **FR-002**: 워크스페이스 없는 환경에서 pack 설치 후 루트 bin smoke가 런타임 의존성 누락으로 실패하지 않아야 한다. (#752)
- **FR-003**: RecallTool은 클라이언트가 전송한 `filters` 객체의 필터를 적용해야 한다. (#754)
- **FR-004**: `crossChannelRecall=off`일 때 recall 결과는 다른 채널 기억을 포함하지 않아야 한다(0건). (#754)
- **FR-005**: `channel-isolation` e2e는 skip 없이 실행되어야 하고, assistant CI는 `test/`를 포함해야 한다. (#754)
- **FR-006**: malformed/missing `filters`에 대해 기존 공개 API 호환 동작을 유지해야 한다. (#754, Constitution II)
- **FR-007**: 등록된 운영 npm 스크립트는 존재하지 않는 루트 `src/`를 import하지 않아야 한다(0건). (#750)
- **FR-008**: 운영 CLI는 `--help`/analyze smoke 및 파라미터화된 import/CLI smoke로 검증되어야 하며, CI가 해당 smoke를 실행해야 한다. (#750)
- **FR-009**: `memory_embedding` 재구축의 create/copy/drop/rename은 단일 트랜잭션으로 원자적이어야 한다. (#755, Constitution III)
- **FR-010**: 재구축 migration 중간 실패 시 롤백되어 기존 데이터가 보존되어야 하며, 성공 경로는 멱등해야 한다. (#755)
- **FR-011**: nightly는 MigrationRunner 통합 테스트 9건을 실제로 수집·실행해야 한다. (#751)
- **FR-012**: 대상 스위트가 0 tests이면 CI 스텝이 실패해야 한다. PR CI의 exclude 의도는 유지해야 한다. (#751)
- **FR-013**: production audit에서 fixable High/Moderate는 0이어야 하며, security 워크플로에 `npm audit --omit=dev` gate를 두어야 한다. (#756)
- **FR-014**: fixable 해소는 `@hono/node-server`, `hono`, `fast-uri`, `ip-address`, `protobufjs`의 wanted 범위로 한정하고, upstream-blocked는 문서화해야 한다. (#756)
- **FR-015**: embedding metadata 기본값 보정은 bootstrap/migration에서 한 번 수행하고, create/search/stats hot path에서 테이블 전역 repair를 수행하지 않아야 한다. (#753)
- **FR-016**: 신규 행은 metadata 기본값을 가져야 하며, legacy fixture·query-count 회귀 테스트가 있어야 한다. (#753)
- **FR-017**: architecture 테스트는 금지 의존 방향(domain→infra, shared→infra/server 등) 신규 위반을 CI에서 실패시켜야 한다. (#749)
- **FR-018**: 기존 allowlist 위반은 rationale과 함께만 허용하고, runtime cycle 2건을 제거해야 하며, allowlist 무분별 증가는 실패 또는 리뷰를 요구해야 한다. (#749)
- **FR-019**: 각 자식 이슈는 실패 재현/회귀 테스트 선행 후 수정·통과해야 한다. (Constitution I)
- **FR-020**: 각 이슈 완료 전 대상 테스트 · `npm run type-check` · `npm run lint`가 통과해야 하며, production 코드 변경 시 graphify를 재빌드해야 한다. (Constitution IV, 에픽 done criteria)

### Key Entities

- **Pack runtime closure**: 루트 bin/`dist/server`가 런타임에 요구하는 패키지·워크스페이스 산출물 집합. `verify-npm-pack-bundle` 검증 대상.
- **Recall filters wire contract**: 클라이언트 `filters` 객체와 RecallTool 입력 해석 규칙; `crossChannelRecall`과 채널 경계.
- **memory_embedding rebuild migration**: create/copy/drop/rename 단계와 트랜잭션 경계; 실패 시 롤백 단위.
- **MigrationRunner nightly suite**: vitest 수집 대상 9건; PR exclude vs nightly include 정책.
- **Architecture allowlist**: 문서화된 예외 의존·cycle; 신규 위반·allowlist 증가 게이트.
- **Production audit baseline**: `--omit=dev` 기준 High/Moderate fixable 카운트와 upstream-blocked 기록.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 빈 temp에서 `npm pack` 설치 + workspace-less bin smoke가 런타임 의존성 누락 없이 성공한다. (#752)
- **SC-002**: `verify-npm-pack-bundle`(또는 동등)이 server 런타임 closure 누락을 회귀로 실패시킨다. (#752)
- **SC-003**: `crossChannelRecall=off`에서 타 채널 기억 0건; channel-isolation e2e unskip 통과; assistant CI가 `test/` 포함. (#754)
- **SC-004**: 등록 npm 스크립트의 루트 `src/` import 0건; CLI `--help`/analyze 및 CI smoke 통과. (#750)
- **SC-005**: embedding 재구축 실패 주입 후 데이터 온전(롤백); 성공·멱등 테스트 통과. (#755)
- **SC-006**: nightly가 MigrationRunner 테스트 9건을 실행하고, 0 tests 시 스텝 실패. (#751)
- **SC-007**: production fixable High/Moderate = 0; security workflow에 `audit --omit=dev` gate 존재; upstream-blocked 문서화. (#756)
- **SC-008**: hot path 테이블 전역 metadata repair 0회; migration/legacy·query-count 테스트 통과. (#753)
- **SC-009**: runtime cycle 2건 제거; 신규 금지 방향 위반 CI 실패; allowlist 증가는 실패 또는 리뷰 필요. (#749)
- **SC-010**: 에픽 하위 각 PR이 대상 테스트 · type-check · lint를 통과하고, production 변경 시 graphify가 갱신된다.

---

## Acceptance Criteria (Checklist)

### #752 — fix(pack): 배포 tarball 런타임 의존성 closure 검증
- [ ] 빈 temp에 `npm pack` 설치 가능
- [ ] workspace-less bin smoke 통과
- [ ] 누락 external 회귀 테스트 존재·통과
- [ ] `verify-npm-pack-bundle`이 server 런타임 closure 검증
- [ ] `type-check` · `lint` · 대상 테스트 통과
- [ ] Out of scope: package 재설계, 불필요 bundler

### #754 — fix(recall): 필터 wire contract 정렬 및 채널 격리 복원
- [ ] 클라이언트 `filters` 적용
- [ ] `crossChannelRecall=off` → 타 채널 0건
- [ ] `channel-isolation.e2e` unskip·통과
- [ ] assistant CI에 `test/` 포함
- [ ] malformed/missing `filters` API 호환
- [ ] 게이트 + graphify (production 변경 시)

### #750 — fix(scripts): monorepo 이동 후 운영 명령 import 경로 복구
- [ ] 등록 npm 스크립트에서 루트 `src/` import 0건
- [ ] `--help` / analyze smoke 통과
- [ ] 파라미터화 CLI/import smoke 존재
- [ ] CI가 해당 smoke 실행
- [ ] 게이트 통과 (SQL 재구현으로 대체하지 않음)

### #755 — fix(db): memory_embedding 재구축 migration 원자성 보장
- [ ] create/copy/drop/rename 단일 트랜잭션
- [ ] 실패 주입 → 롤백, 데이터 온전
- [ ] 성공·멱등 테스트 통과
- [ ] 대상 테스트 · 게이트 · graphify

### #751 — fix(ci): nightly MigrationRunner 테스트 실제 실행 보장
- [ ] nightly가 MigrationRunner 테스트 9건 수집·실행
- [ ] 0 tests → 스텝 실패
- [ ] PR CI exclude 의도 유지
- [ ] workflow / vitest 설정 검증됨

### #756 — chore(security): fixable production 취약점 해소 및 audit gate 추가
- [ ] fixable High/Moderate = 0 (`--omit=dev`)
- [ ] security workflow에 `npm audit --omit=dev` gate
- [ ] upstream-blocked 문서화
- [ ] 무관 major / onnxruntime·sharp force override / eslint·vitest major 없음
- [ ] smoke · 게이트 통과

### #753 — perf(embedding): metadata 보정을 hot path에서 migration으로 이동
- [ ] bootstrap/migration 1회 보정
- [ ] hot path 테이블 전역 repair 0
- [ ] 신규 행 기본값
- [ ] legacy fixture + query-count 테스트
- [ ] 게이트 · graphify

### #749 — test(architecture): 의존 방향·runtime cycle 회귀 차단
- [ ] allowlist 위반 + rationale
- [ ] 신규 domain→infra · shared→infra/server 위반 시 CI 실패
- [ ] runtime cycle 2건 제거
- [ ] allowlist 증가 시 실패 또는 리뷰 필요
- [ ] 게이트 · graphify

---

## Delivery Notes

- 자식 이슈는 **독립 PR**로 전달한다(에픽 목표: 소형·독립).
- 각 PR 본문에 `Fixes #<sub-issue>`와 `Part of #748`를 명시한다.
- 공통 done: 실패 재현/회귀 테스트 선행 → 수정 → 통과; 대상 테스트 + `type-check` + `lint`; production 코드 변경 시 graphify 재빌드.
- 권장 착수 순서(에픽 P0 목록): #752 → #754 → #750 → #755 → #751 → #756, 이후 P1 #753 → #749. 병렬 가능 여부는 파일 충돌만 고려한다.
- 본 스펙만 작성 대상이며, 이 문서 범위에서 `plan.md` / `tasks.md`는 생성하지 않는다(후속 Spec Kit 단계).
