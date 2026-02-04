### 🤖 AI 코드 리뷰 (사전 검토)

안녕하세요! PR을 올리기 전에 코드를 함께 살펴보는 시니어 멘토입니다.
전반적으로 **Procedural 버전 관리(Issue #57 Phase 2)**와 **LLM 기반 procedural 추출** 기능이 잘 나뉘어진 서비스·도구·타입으로 구현되어 있습니다.

특히 다음 부분이 인상적입니다.
- **Given/When/Then** JSDoc과 테스트 네이밍이 프로젝트 룰을 잘 따르고 있어 가독성과 유지보수성이 좋습니다.
- **LlmProceduralExtractor**의 completion 주입과 규칙 기반 fallback 설계로 테스트 용이성과 견고성이 확보되어 있습니다.

공식 리뷰에 올리기 전에 몇 가지 개선하면 좋을 포인트를 정리해 봤습니다.

-----

### 🎯 주요 개선 제안

#### 🔒 타입 안정성 (높은 우선순위)

- **(발견된 문제점)**: `procedural-memory-extractor.types.ts`의 `ReflectionNotes`에 `[key: string]: any`가 있고, `procedural-memory-extractor.ts` 여러 함수 시그니처에서 `ReflectionNotes | any`, `Record<string, any>`, `params: any[]`가 사용됩니다.
- **(이유)**: `any` 사용은 타입 체크를 우회해 런타임 오류와 리팩터링 시 부작용을 키우며, 프로젝트의 타입 안정성 원칙에 어긋납니다.
- **(제안)**:
  ```typescript
  // 수정 전 (procedural-memory-extractor.types.ts)
  export interface ReflectionNotes {
    // ...
    [key: string]: any; // 추가 필드 허용
  }

  // 수정 후: 인덱스 시그니처를 unknown으로 제한하고, 알려진 필드는 명시
  export interface ReflectionNotes {
    original_task?: string;
    failure_type?: string;
    // ... 기타 알려진 필드
    [key: string]: string | string[] | Date | undefined; // 또는 unknown
  }
  ```
  `procedural-memory-extractor.ts`의 `extractWorkflowName(notes: ReflectionNotes | any, ...)`는 `ReflectionNotes | Record<string, unknown>`으로, `generateTriggerConditions` 내부 `conditions: Record<string, any>`는 `Record<string, unknown>` 또는 구체적인 조건 타입으로 바꾸는 것을 권장합니다. `determineMergeStrategy`의 `params: any[]`는 `(string | number)[]` 등으로 구체화할 수 있습니다.

- **(발견된 문제점)**: `recall-tool.ts`의 `NeighborMemoryItem`, `RecallResultItem`, `RecallResponseMetadata`에 `[key: string]: any`가 있습니다.
- **(이유)**: MCP 응답 확장 시 타입이 무너지기 쉽고, 자동완성/리팩터링이 약해집니다.
- **(제안)**: 알려진 필드는 명시하고, 추가 필드는 `[key: string]: unknown` 또는 별도 `Record<string, unknown>` 타입으로 제한하는 것을 권장합니다.

- **(발견된 문제점)**: `search-engine.ts`의 `search(db: any, query: SearchQuery)`에서 `db`가 `any`입니다.
- **(이유)**: DB 메서드 호출 오타나 인자 순서 오류를 컴파일 타임에 잡기 어렵습니다.
- **(제안)**: `import type Database from 'better-sqlite3';` 후 `db: Database.Database`로 타입을 지정하는 것을 권장합니다.

- **(발견된 문제점)**: `remember-tool.ts`의 `ExistingReflectionNotesResult`에서 `value: null | any | any[]`로 선언되어 있습니다.
- **(이유)**: `any` 사용으로 해당 필드 사용 시 타입 체크 이점이 사라집니다.
- **(제안)**: `value: null | Record<string, unknown> | Record<string, unknown>[]` 또는 `unknown` 등으로 구체화하는 것을 권장합니다.

#### 🐞 잠재적 버그 및 오류 (중간 우선순위)

- **(발견된 문제점)**: `procedural-memory-diff.ts`의 `parseStepsJson`과 `procedural-llm-extractor.ts`의 `parseResponse`에서 `catch` 블록이 빈 채로 두어, 파싱 실패 시 로그가 남지 않습니다.
- **(이유)**: 운영 중 JSON 형식 오류나 LLM 응답 이슈 추적이 어렵습니다.
- **(제안)**:
  ```typescript
  // 수정 전
  } catch {
    return [];
  }

  // 수정 후 (개발/디버깅 시 로그)
  } catch (err) {
    logger.debug('steps JSON 파싱 실패', { raw: raw?.substring(0, 100), error: err });
    return [];
  }
  ```
  `parseResponse`도 동일하게 `logger.warn` 또는 `logger.debug`로 한 줄 로깅을 추가하는 것을 권장합니다.

- **(발견된 문제점)**: `procedural-rollback-service.ts`의 `generateMemoryId()`가 `Date.now()`와 `Math.random()`만으로 ID를 생성합니다.
- **(이유)**: 동일 밀리초에 다수 호출 시 이론적으로 충돌 가능성이 있으나, 현재 사용처(rollback 1회 1건 생성)에서는 현실적으로 낮습니다.
- **(제안)**: 당장 필수는 아니나, 나중에 동시성 요구가 늘어나면 `crypto.randomUUID()` 또는 증가 카운터를 섞는 방식 검토를 권장합니다.

#### 🧹 클린 코드 (가독성 및 중복)

- **(발견된 문제점)**: `procedural-memory-extractor.ts`의 `determineMergeStrategy`가 쿼리 문자열 조합과 `existingMemories` 재할당이 여러 단계에 걸쳐 반복됩니다.
- **(이유)**: 분기와 중복이 많아 수정 시 실수하기 쉽고, 단일 책임이 약해집니다.
- **(제안)**: “완전 일치 쿼리”, “LIKE fallback (AND)”, “LIKE fallback (OR)”을 각각 작은 함수(`buildExactMatchQuery`, `runFallbackSearch` 등)로 나누거나, 쿼리 빌더/파라미터 객체를 도입해 조건 조합을 한 곳에서 관리하면 가독성과 테스트가 좋아집니다.

#### 📐 컨벤션 및 테스트

- **(긍정)**: `procedural-versioning.spec.ts`, `procedural-llm-extractor.spec.ts` 등에서 **Given/When/Then** 설명과 테스트 이름이 잘 맞습니다. migration 013, procedural-diff/rollback 도구·서비스 테스트도 일관되게 작성되어 있습니다.
- **(제안)**: `procedural-memory-diff.spec.ts`, `procedural-rollback-service.spec.ts`에서도 “Given … When … Then …” 형태의 it 설명을 유지하면 프로젝트 룰과 동일한 톤을 유지할 수 있습니다.

#### 📝 문서화

- **(긍정)**: `procedural-versioning.ts`, `procedural-memory-diff.ts`, `procedural-rollback-service.ts`, 도구 클래스들의 JSDoc에 Given/When/Then이 명시되어 있어 동작 계약이 분명합니다.
- **(제안)**: `procedural-llm-extractor.ts`의 `parseResponse`에 “코드블록 제거 → JSON 파싱 → 필드 타입 정규화, 실패 시 null” 같은 한 줄 요약이 있으면 유지보수 시 도움이 됩니다.

-----

### 📝 요약

| 우선순위 | 항목 | 파일/위치 |
|---------|------|------------|
| 높음 | `any` 축소 및 인덱스 시그니처 보강 | procedural-memory-extractor.types.ts, procedural-memory-extractor.ts, recall-tool.ts, search-engine.ts |
| 중간 | 파싱 실패 시 로깅 | procedural-memory-diff.ts parseStepsJson, procedural-llm-extractor.ts parseResponse |
| 낮음 | ID 생성 강화(선택), determineMergeStrategy 리팩터 | procedural-rollback-service.ts, procedural-memory-extractor.ts |

몇 가지 제안을 드렸지만, 버전 체인·diff·rollback·LLM 추출·recall 필터 연동 등 핵심 로직은 잘 구현되어 있습니다. 위 제안을 검토해 반영하시면 타입 안정성과 운영 관찰 가능성이 더 좋아질 것입니다.

수고하셨습니다!
