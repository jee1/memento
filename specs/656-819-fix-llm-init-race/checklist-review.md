# Code Review: Relation extractor silently falls back to rule-based

**Feature**: 656-819-fix-llm-init-race | **Issue**: #819
**Reviewed**: 2026-08-26
**Range**: merge-base `f8b5d858` → `6b1427cd` (16 files, +1960 / −65)
**Protocol**: `/speckit.superspec.review` → superpowers `requesting-code-review` (리뷰어 서브에이전트 1회 dispatch, 읽기 전용)

> 범위 정정: 최초 dispatch 시 base 를 `git rev-parse main`(`6279c3da`)으로 넘겼는데, `main` 이 분기점 이후로 전진해 있어 two-dot diff 가 무관한 변경 4,000여 줄을 끌고 왔다. 실제 merge-base 는 `f8b5d858` 이고 이 리포트는 그 기준이다(`git diff main...HEAD` 3-dot 과 동일).

## 1. 요약

레이스 수정 자체는 정확하다. 근본 원인(초기화 완료 전 동기 판정), 가드 순서 역전, `isOllamaAvailable()` 판정 불일치 세 가지가 모두 제대로 짚였고, 신규 테스트는 수정 전 코드에서 실제로 실패하는 유효한 RED 다.

미달 지점은 진단성(FR-005 / SC-005) 하나다. 하이브리드 폴백 로그가 `reason: 'provider_not_configured'` 를 **조건 없이** 단정하는데, `init_failed` 를 남기는 유일한 지점인 생성자 catch 는 실사용상 도달하지 않는다. 결과적으로 "로컬 프로바이더가 설정돼 있으나 응답하지 않는 환경"에서 폴백 로그가 사실이 아닌 사유를 표시한다.

Critical 0건. Important 1건 해소 후 머지 가능.

## 2. 스펙 준수

| 항목 | 판정 | 근거 |
|------|------|------|
| FR-001 | PASS | `isAvailableAsync()` 가 `initializationPromise` await 후 판정(`llm-based-relation-extractor.ts:177-180`). 배치는 한 인스턴스가 같은 promise 를 공유 |
| FR-002 | PASS | 하이브리드 폴백 분기가 비동기 판정 사용(`relation-extractor.ts:137`) |
| FR-003 | PASS | `await` 앞 조기 throw 제거. 초기화 완료 후 `hasAvailableClient` 만 실패 판정 |
| FR-004 | PASS | 생성자 `.catch()` 흡수 → `initializationPromise` 는 항상 resolve → 판정이 예외 대신 false. 폴백은 `ruleCandidates` 반환 |
| FR-005 | **PARTIAL** → 후속 조치 후 PASS | 어휘 3종은 존재하나 폴백 지점(`relation-extractor.ts:140`)이 상수로 고정. `init_failed` 는 실질 도달 불가. 자격 증명 미노출 조항은 PASS(고정 리터럴 3개) |
| FR-006 | PASS | `extract-relations-tool.ts` 무변경. 요청 파라미터·응답 필드·`method` 의미 불변 |
| FR-007 | PASS | `relation-extractor.ts:118-132` 고신뢰 경로가 `:137` 판정 **전에** return. 대기 0 |
| FR-008 | PASS | 새 설정값·env 0. 상한은 기존 `external_api` 재시도 정책 |
| FR-009 | PASS | production 외부 호출자 0건(`grep -rn "isAvailable" packages/`), 남은 호출은 `isAvailableAsync()` 내부 위임 1건 + 테스트. JSDoc(`:148-153`)이 유효 구간 명시 |
| FR-010 | PASS | `preferredProvider === 'ollama'` 는 `/api/tags` 성공 시에만 세팅(`ollama.ts:22`)되므로 "판정 통과 후 실행 실패" 조합이 생기지 않음 |
| SC-001 | PASS | 코드 경로 + 실측(로컬 프로바이더로 `method: llm` 관계 생성, tasks.md Execution Notes) |
| SC-002 | PASS | 해당 로그는 `isAvailableAsync()` 가 false 일 때만 발생 |
| SC-003 | PASS | 미설정 환경 판정 결과 동일(false), `ruleCandidates` 반환 경로 무변경 |
| SC-004 | PASS | 고신뢰 경로에 await 추가 없음 |
| SC-005 | **PARTIAL** → 후속 조치 후 PASS | 폴백 로그 한 줄만으로는 미설정과 초기화/연결 실패가 구분되지 않음(FR-005 참조) |

### Edge Cases

| 스펙 항목 | 처리 |
|---|---|
| 한 인스턴스에 동시 추출 유입 | ✅ 단일 `initializationPromise` 공유 |
| 원격 엔드포인트 지연 | ✅ 저장 실패 없음, 상한은 기존 재시도 정책 |
| 초기화 실패 후 후속 요청 | ✅ catch 흡수, 매 요청 규칙 기반 폴백 |
| 규칙 기반 고신뢰 | ✅ LLM 호출·대기 모두 없음 |
| 로컬 프로바이더 연결 점검 | ✅ 점검 완료 후 판정 |
| 배치 항목 간 판정 일관성 | ✅ `extractRelationsBatch` 가 동일 인스턴스로 `Promise.all` |
| 미가용 폴백 결과 캐시 미저장 | ✅ `cache.set` 은 `:128`·`:169` 에만, 폴백 return(`:142`·`:179`)은 캐시 미접촉 |
| 폴백 사유에 자격 증명 혼입 | ✅ `reason` 은 고정 리터럴 3개 |
| auto + 클라우드 키 없음 + 로컬만 기동 | ✅ FR-010 |
| 저장 폭주 시 백그라운드 점검 누적 | ✅ 스펙대로 수용(범위 밖). `remember-tool-augmentation.ts` fire-and-forget 확인 |

## 3. 발견 사항

### Critical

없음.

### Important

**[신뢰도 87] 폴백 로그가 초기화·연결 실패를 `provider_not_configured` 로 잘못 단정한다**

`packages/memento-core/src/domains/relation/services/relation-extractor.ts:138-141`

`reason: 'provider_not_configured'` 가 조건 없는 상수다. 반대편에서 `init_failed` 를 남기는 유일한 지점은 `llm-based-relation-extractor.ts:110-113` 의 생성자 catch 인데, 이 catch 는 실질적으로 도달하지 않는다 — `LLMClientInitializer.initialize()` 가 정상적인 실패를 전부 흡수하기 때문이다:

- `initializeOpenAI` 는 키 부재·생성 예외를 `addWarning` 처리 후 `null` 반환(`llm-client-initializer/openai.ts:18-51`)
- `testOllamaConnection` 은 타임아웃·네트워크 오류를 `try/catch` 로 삼켜 `addWarning`(`llm-client-initializer/ollama.ts:135-150`)

즉 `initialize()` 는 거부되지 않고 `preferredProvider: null` 로 resolve 한다. **로컬 프로바이더가 설정돼 있으나 응답하지 않는 환경**(3차 브레인스토밍이 겨냥한 바로 그 환경)에서 운영자가 보는 폴백 로그는 `reason: 'provider_not_configured'` — 사실이 아니다. FR-005 가 닫으려던 함정이 "같은 로그"에서 "틀린 라벨"로 형태만 바뀌었다.

완화 요인: `initializeClients()` 가 `preferredProvider === null` 이고 warning 이 있으면 `logger.warn('LLM 초기화 경고', { warning })` 로 실제 원인을 남긴다(`llm-based-relation-extractor.ts:138-142`). 따라서 SC-005 의 "코드 열람이 필요하지 않다"는 인접 로그 줄로 충족되지만, "폴백 로그만 보고"는 충족되지 않고 라벨 자체는 여전히 틀렸다.

산출물 불일치도 함께 걸린다:
- `specs/656-819-fix-llm-init-race/data-model.md` 사유 표가 "초기화 실패"의 관측 지점을 **하이브리드 폴백 로그**로 명시하는데, 구현은 생성자 로그에 뒀다.
- `CHANGELOG.md` 의 "폴백 로그에 `reason` 필드가 붙어 미설정·초기화 실패·LLM 호출 실패를 구분합니다" 는 실제 폴백 로그 기준으로 사실이 아니다.

헌법 Development Workflow("세 산출물 상호 정합")에 해당한다.

참고: US3 수용 시나리오 2("자격 증명은 있으나 초기화가 실패")는 통과한다 — 잘못된 키는 `new OpenAI({apiKey})` 가 지연 생성이라 예외 없이 통과하고 실제 호출 단계에서 `llm_call_failed` 로 남는다. 문제는 연결 점검 실패 케이스 하나다. 그래서 Critical 이 아니다.

**권장 수정 (a) — 최소 변경**: 폴백 지점이 틀린 특정값을 단언하지 않도록 사유를 중립값(`llm_unavailable`)으로 바꾸고, 구체적 원인은 이미 남는 `LLM 초기화 경고` / `LLM 클라이언트 초기화 실패` 로그가 담당한다고 `data-model.md`·`CHANGELOG.md` 를 정합화한다. 코드 1줄 + 테스트 단언 1줄 + 문서 2곳.

**대안 (b) — 스펙 문구에 더 충실**: 초기화 결과의 사유를 폴백 지점까지 전달한다. 다만 `initialize()` 가 "키 없음"과 "연결 실패"를 모두 `warnings` 문자열로만 구분하므로, 실제 구분에는 공유 initializer 에 구조화된 실패 종류를 추가해야 한다 → Non-Goal("가용성 상태를 구조화된 값·타입·진단 API 로 노출")과 정면 충돌하고 blast radius 가 커진다.

→ **(a) 권장.** Non-Goals 가 (b) 를 배제하는 쪽으로 이미 기울어 있다.

### Suggestion

**[신뢰도 90] 두 spec 파일의 `vi.mock` config 경로 결함 (기존 결함, 신규 테스트는 미의존)**

`llm-based-relation-extractor.spec.ts:122` 의 `vi.mock('../../../shared/config/index.js')` 는 테스트 파일 기준 `src/domains/shared/config/index.js` 로 해석되는데 그 디렉터리가 없다(실제 config 는 `src/shared/config`). 소스는 `services/` 기준 3단계라 올바른 경로를 읽으므로 이 mock 은 소스에 적용되지 않는다. 같은 병이 `relation-extractor.spec.ts:23` 의 `vi.mock('../config/index.js')` 에도 있다.

신규 테스트 중 이 mock 에 의존하는 것은 없다 — FR-010 케이스(`:720`)는 4단계 경로로 실제 `mementoConfig` 를 `try/finally` 조작·복원하는 방식으로 우회했고, 그 덕분에 RED 가 유효하다. → **후속 이슈 #821 로 등록했다** (두 사례 모두 포함).

**[신뢰도 85] 신규 테스트의 logger spy 가 복원되지 않는다**

`relation-extractor.spec.ts:680, 708` 이 `vi.spyOn(logger, 'info')` / `vi.spyOn(logger, 'error')` 를 걸지만 이 파일에 `afterEach` 가 없고 루트 `vitest.config.ts` 에도 `restoreMocks` 가 없다(확인함). 두 spy 는 call-through 이고 해당 describe 가 파일 마지막 블록이라 현재 실질 영향은 없지만, 이후 테스트가 추가되면 조용히 새는 패턴이다. `afterEach(() => vi.restoreAllMocks())` 한 줄이면 충분하다.

**[신뢰도 84] 조기 throw 제거로 직접 호출자의 오류 메시지가 바뀌었다 (production 영향 없음)**

`llm-based-relation-extractor.ts:388`. `LLMBasedRelationExtractor.extractRelations` 를 **직접** 호출하는 입장에서 두 가지가 달라졌다: (1) 미가용 시 예외 문구가 `'LLM 서비스가 사용 불가능합니다'` → `'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 …'`, (2) `existingMemories` 가 빈 배열이면 이전에는 던지던 상황이 이제 `[]` 를 반환한다(await 가 빈 배열 검사 앞으로 이동). production 호출자는 `RelationExtractor` 하나뿐이고 그쪽은 자체 문구(`relation-extractor.ts:101`, 불변)로 먼저 던지며 빈 배열은 `:60-62` 에서 미리 걸러내므로 관찰 가능한 회귀는 없다(헌법 II 위반 아님). 내부 API 사용자를 위해 CHANGELOG 에 한 줄 추가를 권장한다.

## 4. 강점

- 증상(폴백 로그)이 아니라 "초기화 완료를 보장하지 않는 판정이 공개돼 있었다"는 근본 원인을 고쳤고, `grep` 으로 외부 호출자 0건을 정적으로 확인했다(FR-009).
- FR-010 처리가 특히 좋다. 레이스만 고치면 2차 결함이 드러난다는 것을 3차 브레인스토밍에서 미리 잡았고, `preferredProvider === 'ollama'` 가 `/api/tags` 성공 없이는 세팅될 수 없다는 불변식을 확인한 뒤 조건을 제거했다. 형제 서비스(`TripleExtractionService`)의 기존 선례와도 일치한다.
- RED 가 실질적이다. 하이브리드 케이스는 `isAvailable=false` / `isAvailableAsync=true` 로 두어 "production 이 어느 판정을 부르는가"를 직접 겨냥하고, FR-010 케이스는 실제 config 를 `'auto'` 로 돌려 옛 조건을 깨뜨린다.
- `initializationCompleted` 제거가 옳다. 조기 throw 를 걷어내면 write-only dead state 가 되므로 남기는 쪽이 부채였다.
- 테스트 더블 갱신 누락 없음. `extract-relations-tool.spec.ts`·`mcp-relation-tools.spec.ts` 의 `isAvailableAsync` seed spy 는 3차 브레인스토밍 (b) 항의 **정정**이지 결정 폐기가 아니다 — 차단은 유지되지만 `await initializationPromise` 는 실제로 돌기 때문에 CI 가 매 인스턴스마다 실제 연결 점검을 기다리게 된다.
- 헌법 IV `graphify-out/` 커밋 금지 준수(`.gitignore:173`, `git ls-files` 추적 흔적 없음).
- `tasks.md` Execution Notes 가 "계획과 달라진 지점만" 표로 정리돼 있다. 위양성 테스트(T005)를 스스로 발견해 기록한 행은 특히 정직하다.

## 5. 최종 판정

**조건부 머지 가능 (Important 1건 수정 후)**

조건: 폴백 로그가 초기화·연결 실패를 `provider_not_configured` 로 단정하지 않도록 고치거나, 그것이 의도된 한계임을 `data-model.md` 관측 지점 표와 `CHANGELOG.md` 문구에 정합화한다. 둘 중 하나면 된다.

레이스 수정 자체는 정확하고, 테스트로 뒷받침되며, 실제 로컬 프로바이더 실행으로 검증까지 마쳤다.

## 6. 리뷰 후속 조치 (2026-08-26 적용 완료)

| 항목 | 처리 |
|------|------|
| Important — 폴백 로그 사유 오분류 | 권장안 (a) 적용. 폴백 지점 사유를 `llm_unavailable` 로 교체하고 `data-model.md`·`CHANGELOG.md`·`tasks.md` 를 정합화. 테스트는 RED(`expected 'provider_not_configured'` 불일치) → GREEN 으로 확인. |
| Suggestion — logger spy 미복원 | `relation-extractor.spec.ts` 최상위 `describe` 에 `afterEach(() => vi.restoreAllMocks())` 추가. |
| Suggestion — 내부 API 변경 미기재 | `CHANGELOG.md` Changed 에 한 줄 추가. |
| Suggestion — `vi.mock` 경로 결함 | 후속 이슈 **#821** 등록(두 사례 포함). 이번 브랜치 밖. |
| 산출물 정합 | `spec.md` FR-005·SC-005 도 정정했다. 구분 불가가 드러난 것은 요구사항 자체의 전제였으므로, 하위 산출물만 맞추면 requirements 원본이 코드와 어긋난 채 남는다(헌법 Development Workflow). |

FR-005 / SC-005 최종 착지: 하이브리드 폴백 로그가 `llm_unavailable` / `llm_call_failed` 를 구분하고, 초기화가 예외로 끝난 경우는 생성자 로그가 `init_failed` 를 남기며, 미가용의 구체적 원인은 초기화 시점의 `LLM 초기화 경고` 로그가 담는다.

## 7. 남은 게이트

- [x] **T011 Step 5 사람 리뷰** — 2026-08-26 사용자가 이 리포트와 diff 를 확인하고 승인했다.
- [x] **push · PR 생성** — PR #822 (https://github.com/jee1/memento/pull/822).
