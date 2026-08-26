# Phase 0 Research: Relation extractor LLM init race

**Feature**: 656-819-fix-llm-init-race | **Date**: 2026-08-25

Technical Context 에 NEEDS CLARIFICATION 항목 없음. 스펙 브레인스토밍 4개 라운드에서 모든 미해결 질문이 해소되었고, 아래는 그 과정에서 코드로 확인한 사실과 그로부터 나온 결정이다.

---

## R1. 결함의 정확한 위치

**Decision**: 원인은 "가용성 판정이 초기화를 앞지름" 하나이며, 두 번째 결함(가드 순서)이 그 뒤에 숨어 있다.

**Rationale**:
- `llm-based-relation-extractor.ts:106-117` — `preferredProvider` 는 `initializationPromise.then()` 안에서만 세팅된다. 생성 직후에는 `null`.
- `llm-based-relation-extractor.ts:150-163` — `isAvailable()` 은 `preferredProvider` 를 보므로 초기화 전에는 무조건 `false`.
- `relation-extractor.ts:100`(`method === 'llm'`)·`:137`(hybrid) — 이 판정을 동기로 호출.
- `remember-tool-augmentation.ts:155`, `extract-relations-tool.ts:117` — 호출마다 `new RelationExtractor()` → 매번 새 인스턴스 → 판정은 매번 false. 이슈 보고자의 "네트워크 호출 0회" 증상과 일치.
- `llm-based-relation-extractor.ts:361-367` — `extractRelations` 는 `await this.initializationPromise` **앞에서** throw 한다. 신규 인스턴스에서는 await 에 도달하지 못한다. 즉 이슈 본문의 "extractRelations 는 초기화를 올바르게 await 한다"는 main 기준 거짓.

**Alternatives considered**:
- 이슈 보고자 제안 패치(생성자에서 초기화 강제 완료): `initializationPromise`·`initializationCompleted` 가 `private` 이라 TS 소스에 그대로 적용 불가. 보고자는 컴파일된 `dist` JS 를 패치한 것으로 보인다.

---

## R2. 대기 비용이 실제로 어디에 떨어지는가

**Decision**: 대기를 추가해도 **기억 저장 응답 시간은 변하지 않는다**. 동기 대기를 부담하는 경로는 `extract_relations` 도구 호출 하나뿐이다.

**Rationale**:
- `remember-tool-memory-item.ts:284` → `launchBackgroundAugmentation()` 는 `void` 반환 + 내부 async IIFE + `.catch()` = fire-and-forget. `runRelationExtraction` 은 그 안에서 실행된다.
- `extract-relations-tool.ts:117` 만 `await relationExtractor.extractRelations(...)` 로 응답 경로에 있다.
- 대기 상한: `llm-client-initializer/ollama.ts` 의 `testOllamaConnection` = `AbortSignal.timeout(5000)` × `external_api.max_attempts = 3` + `base_delay_ms = 100` 백오프(`config/retry-options.toml`) → 최악 ≈ 15.3초. 다만 흔한 오설정(로컬 프로바이더 미기동)은 연결 즉시 거부라 수백 ms 로 끝난다.
- `llm-client-initializer.ts:79-83` — `auto` 모드에서 클라우드 클라이언트가 없으면 로컬 연결 점검을 수행한다(이슈 #261 분기). 즉 "LLM 미설정" 기본 환경도 백그라운드에서 이 비용을 낸다.

**Alternatives considered**:
- 대기 상한 설정값 신설 → 새 설정값 금지(Non-Goals). 실제 비용이 작아 불필요.
- 추출기 인스턴스 재사용/싱글턴화 → 비용의 근본 축소이지만 범위 확대. 후속 이슈로 분리(Non-Goals).

---

## R3. 가용성 판정이 두 벌이고 서로 어긋난다

**Decision**: `isOllamaAvailable()` 에서 `mementoConfig.llmProvider === 'ollama'` 조건을 제거해 두 판정을 같은 기준으로 맞춘다(FR-010).

**Rationale**:
- `llm-based-relation-extractor.ts:150-163` — `preferredProvider === 'ollama'` 이면 무조건 `true`.
- `llm-based-relation-extractor.ts:165-167` — `isOllamaAvailable()` 은 `preferredProvider === 'ollama' && mementoConfig.llmProvider === 'ollama'`.
- `provider-resolution.ts` `determineProviderForAuto()` — 클라우드 클라이언트가 없고 로컬 프로바이더가 초기화되면 `preferredProvider = 'ollama'`. 이때 `config/index.ts:32` 의 `mementoConfig.llmProvider` 는 `'auto'` → 두 판정이 갈린다.
- 레이스를 고치면 이 불일치가 **드러난다**: hybrid 는 가용성 판정을 통과했다가 `extractRelations` 의 `hasAvailableClient`(:374-378)에서 throw → 저장마다 "자격 증명을 설정하라"는 잘못된 실패 로그가 남고 LLM 추출은 여전히 0회.
- `determineProvider`(:423) 역시 `providerAvailability().ollama = isOllamaAvailable()` 을 거치므로 가드만 고쳐서는 부족하다. `isOllamaAvailable()` 자체를 고치면 두 지점이 함께 해결된다.
- `preferredProvider` 는 초기화가 연결 점검에 성공했을 때만 `'ollama'` 가 되므로, 제거하는 조건은 중복이자 `auto` 모드에서 거짓 음성이다.
- 선례: `triple-extraction/triple-extraction-service.ts:169-181` 은 로컬 프로바이더 가용성을 `initializedProviders.includes('ollama')` 로만 판정한다. 설정값을 한 번 더 요구하는 쪽은 관계 추출기뿐이다.

**Alternatives considered**:
- 범위 밖으로 분리 → SC-001 이 그 환경에서 미달이고, 레이스 수정이 그 환경의 로그 소음을 오히려 악화시킨다. 기각.
- `hasAvailableClient` 계산을 `isAvailable()` 로 대체해 예측자를 하나로 통합 → 같은 편집 지점이라 매력적이지만 관련 스펙 회귀 확인 범위가 넓어진다. 이번에는 기준만 맞춘다.

---

## R4. 같은 결함이 다른 서비스에도 있는가

**Decision**: 없다. 범위를 넓히지 않는다.

**Rationale**:
- `initializationPromise` 패턴을 쓰는 클래스는 셋: `LLMBasedRelationExtractor`, `TripleExtractionService`, `TripleExtractor`.
- `triple-extraction-service.ts:203` — `extractTriples` 진입부에서 `await this.ensureInitialized()`. `triple-extractor.ts:70-71` 도 동일하게 await.
- `TripleExtractionService.isAvailable()`(:183)은 프로덕션 호출자가 0(테스트만) → 동일한 레이스에 노출되지 않는다.

---

## R5. 기존 테스트 시드(seam) 제약

**Decision**: 비동기 판정은 반드시 동기 판정에 위임한다.

**Rationale**:
- `extract-relations-tool.spec.ts:81`, `mcp-relation-tools.spec.ts:93` 이 `vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailable')` 로 LLM 호출을 차단한다. 위임하지 않으면 이 차단이 무력화된다.
- `relation-extractor.spec.ts:104-107` 은 `isAvailable` 만 가진 객체 리터럴을 주입한다 → 비동기 판정 도입 시 이 더블도 함께 갱신해야 한다(구현 체크 항목).
- 새로 기다리게 되는 초기화는 CI 에서 연결 즉시 거부로 끝나므로 타임아웃 위험이 아니다.
- `llm-based-relation-extractor.spec.ts` 는 `extractor.isAvailable()` 을 직접 검증하는 케이스가 다수다. FR-009 의 단서 조항("남겨 둘 경우 초기화 완료 이후에만 유효함을 명시")을 적용하면 이 테스트들을 건드리지 않아도 된다.
