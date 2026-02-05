# Procedural Memory 고급 버전 관리 설계

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) — Procedural Memory Phase 2  
**로드맵**: `docs/plans/2026-02-05-issue57-phase2-roadmap.md` (1단계 A)

---

## 1. 목표·범위

**목표**: 이슈 #57의 "Procedural Memory 버전 관리: semantic version 또는 단순 증가 버전 필드/테이블, diff 조회, rollback 플로우, recall에서 버전/비교 옵션 제공"을 충족.

**범위**
- **버전 식별**: `memory_item`에 버전 정보를 두어 "몇 번째 버전인지"를 명시. 기존 `memory_link.version_of`(source=새 버전 → target=이전 버전)는 유지하고, 여기에 **버전 번호(단순 증가)** 또는 **semantic version**을 추가.
- **diff 조회**: 두 procedural 메모리(두 id 또는 한 id의 두 버전)에 대해 `workflow_name`, `skill_name`, `steps`, `trigger_conditions`, `task_goal` 등 필드별 차이를 구조화된 형태로 반환하는 API/툴.
- **rollback**: "이전 버전 내용으로 되돌리기". 이력 삭제 없이, **이전 버전의 내용으로 새 procedural 메모리를 생성**하고, 그 새 메모리를 기존 버전 체인에 `version_of`로 연결하는 방식으로 정의.
- **recall 확장**: procedural recall 시 "최신 버전만 / 전체 버전 목록 / 특정 버전" 필터, 그리고 "여러 버전을 함께 반환하고(선택 시) diff 포함" 같은 비교 옵션.

**제외**: 다른 메모리 타입(episodic/semantic 등)의 버전 관리. 버전별 접근 권한(다중 에이전트)은 4단계(D)에서 다룸.

---

## 2. 버전 필드·스키마 및 버전 체계

**버전 번호 체계**: **단순 증가(권장)**. `memory_item`에 `version INTEGER` 추가. 같은 workflow/skill 계열 내에서 1, 2, 3… 부여. 필요 시 나중에 `version_label TEXT`로 semver를 표시용으로만 추가 가능.

**스키마**
- `memory_item`에 nullable 컬럼 추가:
  - `version INTEGER NULL` — procedural만 사용.
  - `version_series_id TEXT NULL` — 같은 절차의 여러 버전을 묶는 키.
- 기존 `memory_link(..., relation_type = 'version_of')` 유지. source_id = 새 버전, target_id = 이전 버전.

**버전 부여 규칙**
- 새로 생성(versioned 아님): `version = 1`, `version_series_id = 해당 메모리 id` 또는 NULL.
- versioned로 새 버전 생성 시: 이전 버전의 `version_series_id`를 물려받고, `version = 이전 version + 1`.
- 마이그레이션: 기존 procedural 행은 `version = 1`, `version_series_id = id`(또는 NULL)로 backfill. 기존 `version_of` 체인이 있으면 체인 순서대로 1, 2, 3… 부여.

**제약**: `version`은 동일 `version_series_id` 내에서만 유일.

---

## 3. diff 조회 API·형식 및 rollback 플로우

**diff 조회**
- **입력**: 두 procedural 메모리 id (`left_id`, `right_id`). 또는 한 id + "이전/다음 버전" 지정.
- **출력**: 구조화된 diff 객체. 필드별로 `workflow_name`, `skill_name`, `task_goal`, `trigger_conditions`는 `{ left, right, equal }` 형태. `steps`는 JSON 배열 비교로 단계별 동일/추가/삭제/변경(`change: 'same'|'added'|'removed'|'modified'`).
- **구현**: `src/domains/memory/` 또는 `src/shared/utils/`에 `procedural-memory-diff.ts`. DB에서 두 id의 memory_item 행을 읽어 필드 비교 후 반환.
- **노출**: MCP 툴 `procedural_diff`.

**rollback 플로우**
- **의미**: 지정한 이전 버전의 내용으로 복원한 **새 버전**을 생성. 기존 버전 행은 수정·삭제하지 않음.
- **입력**: (1) 복원 기준 "현재" 메모리 id(또는 version_series_id + 버전), (2) 되돌릴 버전 id 또는 버전 번호.
- **절차**: 1) 대상 버전 메모리 조회. 2) 그 내용으로 새 memory_item 생성(새 id, type=procedural). 3) 새 행의 `version` = 현재 최신 version + 1, `version_series_id` = 기존 시리즈와 동일. 4) `memory_link`에 (source_id=새 id, target_id=되돌린 버전 id, relation_type='version_of') 삽입.
- **노출**: MCP 툴 `procedural_rollback`.

**에러·경계**: diff — 두 id 중 하나가 없거나 procedural이 아니면 명시적 에러. rollback — 대상이 동일 version_series가 아니면 에러 또는 경고.

---

## 4. recall 버전/비교 옵션

**버전 필터**
- `version_filter`: `'latest_only'`(기본) | `'all_versions'` | `'specific_version'`.
  - `latest_only`: 시리즈당 최신 버전 1개만 결과에 포함.
  - `all_versions`: 같은 시리즈의 모든 버전 포함(시리즈당 상한 예: 50).
  - `specific_version`: `version_number`(또는 version_series_id + version)로 특정 버전만 조회.
- `version_series_id`/`version`이 없는 기존 procedural 행은 "시리즈 없음"으로 처리, `latest_only`일 때 그대로 노출.

**비교 옵션**
- `include_version_chain`: boolean(기본 false). true이면 검색된 procedural 항목에 같은 version_series_id의 버전 목록(id, version, created_at)을 메타데이터로 포함.
- `include_diff_with`: `'previous'` | id. `'previous'`면 각 결과에 직전 버전과의 구조화 diff 포함. id면 해당 id와의 diff 포함.

**응답**: procedural 항목에 `version`, `version_series_id` 필드 추가. `version_chain`, `diff_with_previous`/`diff_with`는 옵션 사용 시만 포함.

---

## 5. 에러 처리·테스트·파일 배치

**에러 처리**
- diff: id 없음/type ≠ procedural → 400. rollback: 대상 없음/동일 시리즈 아님 → 400. recall: 잘못된 version 파라미터는 빈 결과 또는 400. PII는 로그에서 마스킹.

**테스트**
- 단위: procedural-memory-diff(필드/steps 비교), 버전 부여 로직, rollback 서비스(모킹 DB). Given/When/Then·jsdoc 표시.
- 통합: recall의 version_filter·include_version_chain 응답 구조, procedural_diff·procedural_rollback 툴 입출력.
- 마이그레이션: version/version_series_id backfill 및 version_of 체인에서 1,2,3… 부여 검증.

**파일·모듈**
- 스키마: 마이그레이션 013 등으로 `version`, `version_series_id` 추가. `schema.sql` 동기 반영.
- 로직: `procedural-versioning.ts`, `procedural-memory-diff.ts`, `procedural-rollback-service.ts` (domains/memory 또는 shared/utils).
- MCP 툴: `procedural_diff`, `procedural_rollback` — `src/domains/memory/tools/` 핸들러, 서버 툴 등록.
- recall: RecallTool + MemorySearchFilters에 version 관련 필드.
- 타입: `src/shared/types/`에 ProceduralDiffResult, VersionChainItem 등.

---

**다음 단계**: 구현 계획 수립 후 1단계(A) 구현 진행. 로드맵 2단계(C) remember_procedure 설계는 A 완료 후 또는 병행 가능.

---

**구현 완료**: 2026-02-05. 구현 계획: `docs/plans/2026-02-05-procedural-version-management-implementation-plan.md`. Task 1~13 완료 (공용 타입, 마이그레이션 013, schema.sql, procedural-versioning·diff·rollback 서비스, remember/reflexion version 설정, procedural_diff·procedural_rollback MCP 툴, MemorySearchFilters·RecallParams·Result 확장, recall version_filter·include_version_chain·include_diff_with 적용, recall 툴 스키마 버전 파라미터 추가).
