# 설계: 이슈 #234 — KnowledgeCandidateExtractor (4종 규칙 기반 후보)

**날짜**: 2026-05-13  
**이슈**: [#234](https://github.com/jee1/memento/issues/234)  
**부모**: [#82](https://github.com/jee1/memento/issues/82) 개인 지식 축적 Agent MVP  
**선행**: [#231](https://github.com/jee1/memento/issues/231) 계약, [#232](https://github.com/jee1/memento/issues/232) 컨텍스트 빌더, [#233](https://github.com/jee1/memento/issues/233) LLM 메타데이터  
**입력 범위 결정**: `userMessage`만 사용 (어시스턴트 응답은 범위 밖, 보수적 정확도 우선).

---

## 1. 목표

사용자 메시지에서 **명시적 언어 신호**가 있을 때만 `preference` · `decision` · `learning` · `procedure` 네 가지 **후보 카테고리**를 구조화한다.  
모호한 문장은 후보 배열에 포함하지 않는다. LLM 호출·자동 저장·추가 카테고리는 하지 않는다.

---

## 2. 범위

### 포함

- `KnowledgeCandidateExtractor`(이름 고정): `extract(userMessage: string) → KnowledgeCandidate[]`
- `KnowledgeCandidate` 타입을 이슈 스키마에 맞게 재정의
- 카테고리별 **긍정·부정** 단위 테스트, `PersonalKnowledgeAgentService` 통합 테스트 갱신
- `PersonalKnowledgeAgentService`가 한 턴 안에서 추출기를 호출해 `candidates`를 채움

### 제외

- LLM 기반 추출, `reflection` / `goal` / `pattern` 카테고리
- 자동 `remember` 저장 (#235)
- `llmResponse` 기반 규칙(후속 이슈에서 재검토 가능)

---

## 3. 접근 비교 및 채택안

| 안 | 요지 | 장점 | 단점 |
|----|------|------|------|
| **A. 단일 타입 확장** | `KnowledgeCandidate`를 이슈 필드로 교체 | 포트·서비스 시그니처 단순 | 기존 목 객체 필드 전면 수정 |
| **B. 이중 타입** | 추출 결과용 타입 + 저장용 매퍼 | 구분 명확 | 변환·중복 유지보수 |
| **C. 순수 추출 + 주입 선택** | 추출은 순수 함수, 서비스에서 조립 | 테스트 용이, DI 확장 여지 | 파일 하나 추가 |

**채택: A + C 성격** — 타입은 **하나**로 이슈와 일치시키고, 구현은 **`extractors/knowledge-candidate-extractor.ts`의 순수 함수**(또는 메서드 1개 클래스)로 두어 단위 테스트가 구현 세부와 결합되지 않게 한다. 별도 포트(`IKnowledgeCandidateExtractor`)는 #234에서 **도입하지 않는다**(YAGNI). 필요 시 후속 이슈에서 주입 가능하게 분리한다.

---

## 4. 타입 계약

**파일**: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`

- `KnowledgeCandidateCategory`: `'preference' | 'decision' | 'learning' | 'procedure'`
- `suggestedMemoryType`: `@memento/core` 공유 타입 `MemoryType` (`'working' | 'episodic' | 'semantic' | 'procedural'`)  
  - 개인 지식 후보는 기본적으로 **`working` 제외**만 허용한다. 규칙이 `working`을 제안하는 경우는 **만들지 않는다**(승인·저장 경로와 정합).
- `KnowledgeCandidate` 필드(이슈와 동일 + 카테고리):

| 필드 | 타입 | 제약 |
|------|------|------|
| `category` | `KnowledgeCandidateCategory` | 후보 분류 |
| `content` | `string` | 비어 있지 않음, 사용자 발화에서 정제된 저장 제안 본문 |
| `reason` | `string` | 비어 있지 않음, 어떤 **명시적 신호**(패턴/구문)에 매칭되었는지 한국어 1문장 설명 |
| `suggestedMemoryType` | `MemoryType` | `working` 제외 |
| `tags` | `string[]` | 기본 `['personal-agent', category]` + 규칙별 태그 가능 |
| `importance` | `number` | `0.0`–`1.0` |
| `confidence` | `number` | `0.0`–`1.0`, 규칙 엄격도에 따른 고정 스케일(문서화) |
| `sourceContext?` | `string` | 선택, 원문 일부 인용(테스트·디버깅용) |

제거: 기존 `type: 'episodic' | 'semantic' | 'procedural'` 필드 — **`suggestedMemoryType` + `category`로 대체**.

---

## 5. 카테고리 → `suggestedMemoryType` 기본 매핑

| category | suggestedMemoryType | 근거(한 줄) |
|----------|---------------------|-------------|
| preference | `semantic` | 지속 선호·스타일 |
| decision | `episodic` | 시점이 있는 선택·결정 사건 |
| learning | `semantic` | 재사용 지식으로 고정 |
| procedure | `procedural` | 단계·절차 |

매핑은 추출기 내부 상수로 두고, 스펙과 코드 주석에 동일 표를 유지한다.

---

## 6. 규칙 설계 원칙

1. **명시적 구문만**: 정규식 또는 고정 구문 목록(한국어 우선, 필요 시 영문 소수).  
2. **한 메시지·다중 후보**: 서로 겹치지 않는 서로 다른 신호가 있으면 여러 항목 허용. 동일 카테고리 중복은 **내용이 같을 때만** 하나로 합친다.  
3. **모호성**: 조건부·질문형만 있고 확정 없음 → 빈 배열.  
4. **confidence**: 예) 고정 문구 매칭 `0.9`, 패턴 2개 이상 동시 만족 `0.95` 등 **문서화된 고정값**만 사용(LLM 없음).  
5. **importance**: 카테고리별 기본값 상수(예 0.5–0.7) + 신호 강도에 따른 소수 단계만 허용.

초기 규칙 예시(구현 시 이 목록을 테스트로 고정):

- **preference**: `"앞으로는"`, `"항상"`, `"선호"`, `"I prefer"` 등 + 선호 대상이 같은 절에 존재할 때만.
- **decision**: `"결정했"`, `"하기로 했"`, `"I decided"` 등 + 결정 내용이 동절 또는 바로 다음 절에 있을 때만.
- **learning**: `"기억해둬"`, `"알게 됐"`, `"TIL"`, `"I learned that"` 등 + 학습 내용 절 존재.
- **procedure**: 번호 목록(`1.` `2.`) 또는 `"먼저 … 그다음"` 형태가 **둘 이상 단계**를 명시할 때만.

위 예시는 스펙 수준 가이드이며, 구현 시 **positive/negative 픽스처 문장**으로 조정한다.

---

## 7. 파일 구조

```
packages/memento-core/src/domains/personal-agent/
├── extractors/
│   ├── knowledge-candidate-extractor.ts      # extract()
│   └── knowledge-candidate-extractor.spec.ts # 카테고리별 ±
├── types/
│   └── agent-types.ts                        # KnowledgeCandidate 등
├── services/
│   ├── personal-knowledge-agent-service.ts # 추출 호출
│   └── personal-knowledge-agent-service.spec.ts
└── adapters/
    └── tool-context-knowledge-context-adapter.ts  # 시그니처만 유지
```

---

## 8. 서비스 흐름

`PersonalKnowledgeAgentService.runOneTurn`:

1. `buildContext(request)` — 기존과 동일
2. **`candidates = extractKnowledgeCandidates(input.userMessage)`** — LLM과 무관
3. `llm.complete([...])` — 기존과 동일
4. `proposeCandidates(candidates)` / `persist(candidates)` — 기존 순서 유지

추출을 LLM 앞에 두어 후보가 모델 출력에 의존하지 않음을 보장한다.

---

## 9. 테스트 전략

| 레벨 | 내용 |
|------|------|
| 단위 | `knowledge-candidate-extractor.spec.ts`: 카테고리별 최소 1 positive + 1 negative(모호/신호 없음) |
| 통합 | `personal-knowledge-agent-service.spec.ts`: 명시적 선호 문장 입력 시 `candidates.length >= 1`, `reason`·`confidence` 존재, `proposeCandidates`에 동일 배열 전달 |

전체: `npm run type-check` 통과.

---

## 10. 오류 처리

- 추출기는 예외를 던지지 않고 빈 배열을 반환한다(규칙 내부 오류는 assert/테스트로 잡음).
- 비정상 입력(`''` 또는 공백만): `[]`.

---

## 11. 하위 호환 및 export

- `personal-agent/index.ts`에서 확장된 `KnowledgeCandidate` 및 필요 시 `KnowledgeCandidateCategory` export.
- 패키지 외부에서 기존 필드 `type`에 의존한 코드는 없음(도메인 내부만 사용).

---

## 12. 완료 기준 (이슈 대조)

- [ ] 네 카테고리 각각 positive·negative 테스트
- [ ] 모호한 문장 → 후보 없음
- [ ] 모든 후보에 `reason`, `confidence` 존재
- [ ] `suggestedMemoryType`이 `MemoryType`이며 `working` 미사용
- [ ] Agent Loop 통합 테스트에서 `proposeCandidates` 검증
- [ ] `npm run type-check` 통과

---

## 13. 스펙 자체 점검

- 모순 없음: 입력은 `userMessage`만, `llmResponse` 미사용.
- TBD 없음: 초기 규칙은 테스트 픽스처로 구체화.
- 단일 구현 계획 범위: 본 문서만으로 구현 계획(`writing-plans`) 작성 가능.
