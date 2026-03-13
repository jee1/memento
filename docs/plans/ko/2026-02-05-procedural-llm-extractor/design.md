# Procedural Memory LLM 추출기 설계

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) — Procedural Memory Phase 2 (LLM 요약·고급 버전 관리·성능 최적화)  
**범위**: LLM 추출(플러그 가능 + 규칙 fallback)만 다룸.

---

## 1. 목표

Reflexion 결과(reflection_notes + failure event)에서 `workflow_name`, `skill_name`, `steps`, `trigger_conditions`를 추출할 때, **LLM 추출기를 1순위로 두고, 실패/타임아웃 시 기존 규칙 기반 추출로 자동 fallback** 하게 한다.

---

## 2. 아키텍처·역할

- **추출기 인터페이스**
  - 입력: `ReflectionNotes` + `FailureEvent` (선택)
  - 출력: `ExtractedProceduralMemory` (기존 타입 유지)
  - `extract(notes, event?): Promise<ExtractedProceduralMemory | null>`
  - `null` = "이 추출기로는 못 뽑음" → 다음 추출기 또는 fallback으로 넘김.

- **규칙 기반 추출기 (기존)**
  - 현재 `extractProceduralMemory` 및 개별 함수들을 **동기 → Promise 반환**으로 감싸서, 위 인터페이스를 구현한 하나의 "RuleBasedProceduralExtractor"로 둠.
  - 항상 마지막 fallback으로 호출 (실패하지 않도록 유지).

- **LLM 추출기 (신규)**
  - 동일 인터페이스 구현.
  - reflection_notes(및 event)를 프롬프트에 넣고, 응답을 JSON으로 파싱해 `ExtractedProceduralMemory` 형태로 매핑.
  - 파싱 실패·타임아웃·네트워크/API 에러 시 `null` 반환 → 상위에서 규칙 기반 호출.

- **오케스트레이션 (reflexion-worker)**
  - 설정에 따라 "LLM 먼저 시도 여부"만 결정.
  - LLM 사용 시: LLM 추출기 호출 → 결과가 유효하면 사용, `null`이면 RuleBased 추출기 호출.
  - LLM 미사용 시: 현재처럼 규칙 기반만 사용 (기존 동작 유지).

- **설정**
  - 예: `PROCEDURAL_EXTRACTION_STRATEGY=llm_first` | `rule_only` (기본 `rule_only`).

- **에러·품질**
  - LLM 실패는 로그만 남기고 fallback으로 진행 (worker 실패로 올리지 않음).
  - 필요 시 "LLM 추출 결과 vs 규칙 추출 결과" 로깅으로 품질 비교 확장 가능.

---

## 3. 데이터·프롬프트·설정

**입출력**
- LLM 추출기 입력: `ReflectionNotes` + `FailureEvent` (선택). 기존과 동일.
- 출력: 기존 `ExtractedProceduralMemory` 유지 (`workflow_name`, `skill_name`, `steps`, `trigger_conditions`, `task_goal` 등).
- LLM에는 reflection_notes를 JSON 또는 요약 텍스트로 넘기고, **응답은 지정된 JSON 스키마 한 덩어리**로 요청해 파싱 실패를 줄인다.

**프롬프트·응답**
- 시스템/역할: "Reflexion 결과에서 절차적 기억(workflow, skill, steps, trigger_conditions)만 추출한다. 다른 설명 없이 지정된 JSON만 출력한다."
- 유저 메시지: reflection_notes(및 필요한 event 일부)를 넣고, 예시로  
  `{"workflow_name":"...","skill_name":"...","steps":"[...]","trigger_conditions":"{...}","task_goal":"..."}` 형태 한 개를 요청.
- 파싱: 응답 텍스트에서 JSON 블록만 추출(코드블록 제거 등) 후 `JSON.parse`. 필수 필드 누락/타입 오류 시 `null` 반환 → 규칙 fallback.

**설정·연결**
- `PROCEDURAL_EXTRACTION_STRATEGY`: `llm_first` | `rule_only` (기본 `rule_only`).
- (선택) `PROCEDURAL_LLM_EXTRACTOR_TIMEOUT_MS`: 타임아웃(예: 10_000).
- LLM 호출은 기존 프로젝트의 completion/chat API 한 곳으로만 보내고, API 키 등은 기존 설정 재사용.
- reflexion-worker 내부: 이벤트 처리 시 procedural 추출하는 지점 한 곳에서, 전략이 `llm_first`이면 LLM 추출기 호출 → 성공 시 그 결과 사용, 실패/타임아웃/`null`이면 기존 `extractProceduralMemory`(규칙 기반) 호출.
- 추출기 구현체: 인터페이스 + RuleBasedProceduralExtractor + LlmProceduralExtractor 두 개만 두고, reflexion-worker는 전략에 따라 어떤 추출기를 먼저 호출할지만 결정.

---

## 4. 파일·함수·테스트·배포

**파일·함수**
- **인터페이스·타입**: `src/shared/utils/procedural-memory-extractor.types.ts` (신규) — `IProceduralMemoryExtractor`: `extract(notes, event?) => Promise<ExtractedProceduralMemory | null>`.
- **규칙 기반 래퍼**: `src/shared/utils/procedural-memory-extractor.ts` — 기존 `extractProceduralMemory` 유지, `RuleBasedProceduralExtractor` 또는 `extractProceduralMemoryAsync`로 동일 인터페이스 Promise 반환.
- **LLM 추출기**: `src/domains/memory/services/procedural-llm-extractor.ts` (신규) — `LlmProceduralExtractor`: 프롬프트 조립, 기존 LLM 클라이언트 호출, JSON 파싱·검증 후 `ExtractedProceduralMemory` 또는 `null` 반환.
- **전략·연동**: `src/shared/config/index.ts`에 `proceduralExtractionStrategy`, `proceduralLlmExtractorTimeoutMs` 추가(환경변수 연동). reflexion-worker: `src/infrastructure/reflexion-worker.ts` 내 procedural 추출 호출부 한 곳에서 전략 분기.
- **프롬프트**: `procedural-llm-extractor.ts` 내 상수 또는 `prompts/procedural-extraction.txt` (선택).

**테스트**
- LlmProceduralExtractor: 입력/응답 JSON 모킹으로 파싱·검증·실패 시 `null` 반환 검증.
- RuleBasedProceduralExtractor(async 래퍼): 기존 `procedural-memory-extractor.spec.ts`에 async 경로 추가 또는 별도 spec.
- 전략 분기: reflexion-worker 단위 테스트에서 `rule_only` / `llm_first` + LLM 실패 시 fallback 시나리오.
- (선택) 통합: 실제 LLM 호출 없이 stub 응답으로 end-to-end 검증.

**배포·운영**
- 기본값 `rule_only`로 기존 동작 유지.
- `llm_first` 사용 시 API 키·할당량·지연 확인, 타임아웃으로 worker 지연 방지.
- 로그: LLM 추출 시도/성공/fallback 여부만 구조화 로그로 남기면 추후 품질 분석에 활용 가능.

---

**구현 완료:** 2026-02-05. 구현 계획: `docs/plans/2026-02-05-procedural-llm-extractor-implementation-plan.md`
