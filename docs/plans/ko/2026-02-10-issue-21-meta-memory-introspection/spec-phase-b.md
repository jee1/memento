# 이슈 #21 Phase B — SPECIFY (명세)

SDD **Specify** 단계 산출물. Phase B 요구사항(REQ)·제약(CON)·수용 기준(AC) 및 유스케이스 명세.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | 메타-기억 자기 성찰 Phase B |
| **문서 유형** | SPECIFY (Phase B 명세) |
| **버전** | 1.0 |
| **날짜** | 2026-03-15 |
| **상태** | draft |
| **관련 이슈** | [#21](https://github.com/jee1/memento/issues/21) |
| **요구사항 문서** | [requirements.md](./requirements.md) |
| **설계 문서** | [design.md](./design.md) |

---

## 1. 범위

### 1.1 In scope (Phase B)

- **introspection_hint**: `recall` 및 `get_meta_memory_stats` 응답에, **저신뢰 또는 고실패가 1건 이상일 때만** 선택 필드 `introspection_hint`를 포함한다.
- **get_introspection_summary** MCP(및 HTTP) 도구: 캐시된 최근 스캔 결과(요약 문장, 저신뢰·고실패 건수, 메모리 ID 목록)를 반환한다.
- **스케줄 기반 캐시**: `meta_memory_introspection` job 실행 시 `MetaMemoryIntrospectionService.runScan` 결과를 캐시하고, hint·도구 응답은 이 캐시에서만 읽는다. 도구 호출 시 실시간 runScan은 하지 않는다.
- **(선택) 실패 회피 규칙 저장·조회**: 규칙을 Memento에 저장하고, 조회 도구 또는 get_introspection_summary 확장으로 외부 LLM이 제안에 활용할 수 있게 한다. 규칙 **추출**(LLM 요약)은 클라이언트 책임, **저장·조회**는 Memento.

### 1.2 Out of scope (Phase B)

- 실시간 스캔(runScan을 매 요청마다 호출).
- Gap 분석(workflow/skill/type별 성공률·부족 플래그)—별도 이슈 또는 후순위.
- Memento 내부에서 LLM을 호출하는 로직(규칙 추출은 외부).

---

## 2. 응답 스키마: introspection_hint

저신뢰/고실패가 **1건 이상일 때만** 다음 구조를 응답에 포함한다. 없으면 필드 자체를 생략하거나 포함하지 않는다.

**권장 스키마 (구조화)**

```ts
// recall / get_meta_memory_stats 응답 최상위 선택 필드
introspection_hint?: {
  summary: string;              // "저신뢰 메모리 N건, 고실패 메모리 M건. 자세한 내용은 get_introspection_summary 호출 권장."
  low_confidence_count: number;
  high_failure_count: number;
  scanned_at: string;           // ISO 8601 (캐시된 스캔 시점)
};
```

- **summary**: LLM이 그대로 프롬프트에 넣거나 사용자에게 전달할 수 있는 한 문장.
- **low_confidence_count**, **high_failure_count**: 조건 분기·우선순위 판단용.
- **scanned_at**: “언제 기준 데이터인지” 명시.

**API 네이밍**: `recall`·`get_meta_memory_stats`의 **introspection_hint** 필드는 snake_case(`low_confidence_count`, `high_failure_count`, `scanned_at`)를 사용한다. **get_introspection_summary** 도구 응답은 camelCase(`lowConfidenceMemoryIds`, `highFailureMemoryIds`, `scanned_at`)를 사용한다. 클라이언트에서 두 응답을 구분해 파싱하면 된다.

---

## 3. 기능 요구사항

### 3.1 introspection_hint

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-PB-1 | `recall` 응답에 **introspection_hint**를 포함할 수 있다. | 저신뢰 또는 고실패가 1건 이상일 때만 포함; 없으면 필드 생략. |
| REQ-PB-2 | `get_meta_memory_stats` 응답에 **introspection_hint**를 포함할 수 있다. | REQ-PB-1과 동일 조건. |
| REQ-PB-3 | hint 내용은 **캐시된 최근 스캔 결과**에서만 가져온다. | 매 요청 시 runScan을 호출하지 않음. |
| REQ-PB-4 | hint 스키마는 **summary**, **low_confidence_count**, **high_failure_count**, **scanned_at**을 포함한다. | 위 2절 스키마 준수. |

### 3.2 get_introspection_summary 도구

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-PB-5 | MCP(및 HTTP) 도구 **get_introspection_summary**가 존재한다. | 호출 시 캐시된 스캔 결과 기반으로 요약·건수·ID 목록 반환. |
| REQ-PB-6 | 반환 형식은 **MetaMemoryIntrospectionScanResult**와 동일한 정보(또는 그 상위 집합)를 제공한다. | lowConfidenceMemoryIds, highFailureMemoryIds, summary 및 선택적으로 scanned_at 포함. |
| REQ-PB-7 | 캐시가 비어 있으면(스케줄 미실행 등) 빈 결과 또는 안내 메시지로 응답한다. | runScan을 동기 호출하여 채우지 않음(선택 정책으로 최초 1회만 허용할 수 있음). |

### 3.3 스케줄 기반 캐시

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-PB-8 | **meta_memory_introspection** job 실행 시, `MetaMemoryIntrospectionService.runScan` 결과를 **캐시**에 저장한다. | hint 및 get_introspection_summary는 이 캐시만 참조. |
| REQ-PB-9 | 캐시는 프로세스 내 메모리 또는 동일 DB/인프라 내에서 유지 가능한 형태로 설계한다. | 재시작 시 캐시 소실 허용; 다음 스케줄 실행으로 복구. |

### 3.4 실패 회피 규칙(선택)

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-PB-10 | 실패 회피 규칙을 **저장**할 수 있는 스키마 또는 도구가 있다. | 규칙 추출은 외부 LLM, Memento는 저장·조회만 담당. |
| REQ-PB-11 | 저장된 규칙을 **조회**할 수 있어, get_introspection_summary 또는 별도 도구로 외부 LLM에 제안 소스로 제공된다. | 조회 결과를 에이전트가 컨텍스트에 넣어 “제안” 생성 가능. |

---

## 4. 제약 조건

| ID | 제약 | 대응 |
|----|------|------|
| CON-PB-1 | hint·도구는 **기존 MVP**(runScan, meta_memory_introspection job)가 있다고 가정한다. | MVP 미배포 시 캐시 비어 있음 → 빈 결과 또는 안내. |
| CON-PB-2 | **실패 회피 규칙** 도입 시 스키마·마이그레이션은 기존 패턴(번호·naming)을 따른다. | 018-failure-avoidance-rules 등 기존 계획서 참조. |

---

## 5. 수용 기준 (검증)

| ID | 수용 기준 | 검증 방법 |
|----|-----------|-----------|
| AC-PB-1 | recall 응답에 저신뢰/고실패가 있을 때 introspection_hint가 포함된다. | 단위/통합 테스트: 스캔 결과 캐시 설정 후 recall 호출 → hint 존재 및 스키마 일치. |
| AC-PB-2 | get_meta_memory_stats 응답에 동일 조건으로 introspection_hint가 포함된다. | 동일. |
| AC-PB-3 | get_introspection_summary 호출 시 캐시된 요약·건수·ID 목록이 반환된다. | 테스트: 캐시 설정 후 도구 호출 → 반환 필드 검증. |
| AC-PB-4 | meta_memory_introspection job 실행 시 캐시가 갱신된다. | job 실행 후 hint·get_introspection_summary 결과가 새 스캔 결과와 일치. |
| AC-PB-5 | 저신뢰/고실패가 0건이면 hint가 포함되지 않는다(또는 명시적으로 비어 있음). | 테스트: 0건 캐시로 recall/get_meta_memory_stats → hint 없음 또는 0건 표시 정책에 따름. |

---

## 6. 유스케이스 명세

### UC-PB-1: 기존 도구 응답에 introspection_hint 부여

| 항목 | 내용 |
|------|------|
| **액터** | recall 도구, get_meta_memory_stats 도구 |
| **전제 조건** | 캐시에 최근 스캔 결과가 있으며, low_confidence_count > 0 또는 high_failure_count > 0. |
| **기본 흐름** | 1) 사용자(에이전트)가 recall 또는 get_meta_memory_stats를 호출한다. 2) 서버는 캐시에서 최근 스캔 결과를 읽는다. 3) 저신뢰 또는 고실패가 1건 이상이면 응답에 introspection_hint를 붙여 반환한다. |
| **결과** | 응답 최상위에 introspection_hint 객체 포함(summary, counts, scanned_at). |

### UC-PB-2: get_introspection_summary로 상세 요약 조회

| 항목 | 내용 |
|------|------|
| **액터** | 에이전트(MCP/HTTP 클라이언트) |
| **전제 조건** | get_introspection_summary 도구가 등록되어 있고, (선택) 캐시에 스캔 결과가 있음. |
| **기본 흐름** | 1) 에이전트가 get_introspection_summary를 호출한다. 2) 서버는 캐시에서 스캔 결과를 읽어 요약·lowConfidenceMemoryIds·highFailureMemoryIds·(선택)scanned_at을 반환한다. 3) 캐시가 비어 있으면 빈 결과 또는 “스캔 결과 없음” 안내. |
| **결과** | 상세 요약 및 ID 목록 반환. |

### UC-PB-3: 스케줄 실행 결과를 캐시에 반영

| 항목 | 내용 |
|------|------|
| **액터** | BatchScheduler (meta_memory_introspection job) |
| **전제 조건** | MetaMemoryIntrospectionService.runScan 존재, 캐시 저장소(메모리/인프라) 사용 가능. |
| **기본 흐름** | 1) 스케줄에 따라 runMetaMemoryIntrospection이 실행된다. 2) runScan 결과를 캐시에 저장한다. 3) 이후 hint·get_introspection_summary는 이 캐시를 참조한다. |
| **결과** | 캐시 갱신됨. |

### UC-PB-4: 실패 회피 규칙 저장·조회(선택)

| 항목 | 내용 |
|------|------|
| **액터** | 에이전트·클라이언트(규칙 등록), 에이전트(규칙 조회) |
| **전제 조건** | failure_avoidance_rule 스키마 및 저장/조회 도구 구현됨. |
| **기본 흐름** | 1) 클라이언트 LLM이 고실패 메모리 내용을 분석해 규칙 문장을 생성한다. 2) 클라이언트가 Memento의 규칙 저장 도구를 호출해 등록한다. 3) 에이전트가 요약·제안 시 규칙 조회 도구 또는 get_introspection_summary 확장으로 규칙을 읽어 제안에 반영한다. |
| **결과** | 규칙이 Memento에 보관되고, 외부 LLM이 제안 시 회수 가능. |

---

**다음 산출물**: [structure.md](./structure.md), [tech.md](./tech.md), [product.md](./product.md) (Plan), [tasks.md](./tasks.md) (Task)
