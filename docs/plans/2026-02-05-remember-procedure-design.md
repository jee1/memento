# 독립 remember_procedure 툴 설계

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) Phase 2 — 2단계(C)  
**로드맵**: `docs/plans/2026-02-05-issue57-phase2-roadmap.md`

---

## 1. 목표·범위

**목표**: Issue #57의 "Phase 1 래퍼에서 독립 엔드포인트로 remember_procedure 구현(검증/로깅/권한 분리)"을 충족.

**범위**
- **전용 엔드포인트**: MCP 툴 `remember_procedure`를 별도 툴로 노출. 기존 `remember`의 `type=procedural` 경로와 동일한 저장 로직을 재사용하되, 진입점과 스키마는 절차 전용으로 분리.
- **검증**: procedural 전용 필드(workflow_name, skill_name, trigger_conditions, reflection_notes 등)만 입력받고, 전용 검증 단계에서 거절·에러 메시지 제공.
- **로깅**: `remember_procedure` 호출·성공/실패를 툴 이름이 명시된 로그로 기록하여 절차 저장 경로만 추적 가능하게 함.
- **권한 분리**: 절차 저장이 단일 코드 경로(remember_procedure)로 들어오므로, 향후 권한/할당량 정책을 이 툴에만 적용하기 쉬움. 당 단계에서는 훅만 확보하고, 실제 권한 체크는 미구현.

**제외**: 다중 에이전트·소유자 필드는 4단계(D)에서 다룸. 기존 `remember`의 `type=procedural` 호출은 유지(하위 호환).

---

## 2. 입력 스키마·검증

**입력**
- `content` (필수): 저장할 절차 설명.
- `task_goal`, `steps`, `workflow_name`, `skill_name`, `trigger_conditions`, `update_mode`, `reflection_notes`, `tags`, `importance`, `source`, `privacy_scope` — 기존 remember의 procedural 필드와 동일한 의미·타입.
- `type` 파라미터는 없음. 항상 procedural로 고정.

**검증 순서**
1. 필수 필드: `content` 존재.
2. `validateProceduralMemoryFields({ workflow_name, skill_name, trigger_conditions })` — 기존 공용 유틸 재사용.
3. `reflection_notes`가 제공된 경우 기존 `validateReflectionNotes`(또는 RememberTool과 동일한 JSON/스키마 검증) 재사용.
4. 실패 시 400에 가까운 에러 코드와 명확한 메시지 반환.

---

## 3. 동작·저장 경로

**동작**
- 검증 통과 후, **기존 RememberTool의 procedural 저장 경로를 재사용**한다.
- 구체적으로: `RememberProcedureTool`이 `RememberTool` 인스턴스의 `handle`을 호출할 때 `{ ...params, type: 'procedural' }`을 넘긴다. 저장·임베딩·버전·reflection_notes 병합 등은 모두 RememberTool에 위임하여 중복을 제거한다.

**로깅**
- 호출 시: `info` 수준으로 `remember_procedure` 툴명, `workflow_name`, `skill_name`(있을 경우) 로깅.
- 성공/실패: 기존 인프라 로그에 툴 이름이 구분되도록, 또는 툴 내부에서 성공 시 한 줄 요약 로그 추가. 실패는 기존 createErrorResult + 로거로 기록.

**응답**
- remember와 동일한 성공 형태: `memory_id`, `type: 'procedural'`, 필요 시 `version`, `version_series_id` 등. 클라이언트는 remember와 동일한 형식으로 처리 가능.

---

## 4. 에러 처리·테스트·파일 배치

**에러**
- 파라미터 누락/검증 실패: `invalid_params` 또는 `validation_failed`, 메시지에 필드명 포함.
- DB 불가: remember와 동일하게 처리.
- reflection_notes 병합 실패 등: RememberTool과 동일한 정책(경고 후 원본 저장 또는 에러).

**테스트**
- Given 유효한 procedural 파라미터, When remember_procedure handle, Then 성공 및 memory_id 반환.
- Given workflow_name 검증 실패, When handle, Then validation_failed 에러.
- Given content 누락, When handle, Then invalid_params 에러.
- Given DB 없음, When handle, Then database_unavailable.
- 테스트는 Given/When/Then 및 jsdoc 표기.

**파일**
- `src/domains/memory/tools/remember-procedure-tool.ts`: RememberProcedureTool 클래스, 스키마·검증·로깅·RememberTool.handle 호출.
- `src/domains/memory/tools/__tests__/remember-procedure-tool.spec.ts`: 단위 테스트.
- `src/tools/index.ts`: RememberProcedureTool 등록.

---

## 5. 다음 단계

- 구현 계획은 본 설계를 기준으로 단일 작업으로 진행 가능(작업 수 적음).
- 완료 후 로드맵 문서에 2단계(C) 완료 및 본 설계 문서 링크 반영.

---

**구현 완료**: 2026-02-05. `RememberProcedureTool` (`src/domains/memory/tools/remember-procedure-tool.ts`), MCP 툴 `remember_procedure` 등록, 단위 테스트 `remember-procedure-tool.spec.ts` 추가. 로드맵 2단계(C) 반영 완료.
