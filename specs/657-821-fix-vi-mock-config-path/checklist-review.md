# Code Review: relation 도메인 config 모킹 교정 (#821)

**Date**: 2026-08-28 · **Range**: `064c8b69..773ab60f` · **Branch**: `jee1/relation-spec-2-vi.mock-config`
**Protocol**: superpowers `requesting-code-review` — 별도 리뷰어 서브에이전트 디스패치 + superspec 차원(spec 준수 / constitution 준수 / brainstorm 커버리지) 대조

**Verdict: 수정 후 머지 (With fixes).** Critical 0건, Important 4건, Minor/Suggestion 10건.

리뷰어의 주요 주장은 액면으로 받지 않고 직접 재측정했다. 재측정 결과는 각 항목에 표기한다.

---

## 확인된 강점

| 항목 | 근거 |
|------|------|
| 결함 수정이 실증됨 | 리뷰어가 적대적 환경(`OPENAI_API_KEY=sk-fake GEMINI_API_KEY=g-fake LLM_PROVIDER=ollama`)에서 36/36 통과 확인. 모킹이 죽어 있었다면 `preferredProvider` 가 `'openai'` 로 잡혀 `toBeNull()` 이 반드시 실패한다. FR-003/SC-002 의 양방향 검증 |
| `vi.hoisted()` 판단 | 경로 교정 시 팩토리가 정적 로드 시점에 호출되므로 TDZ 로 파일 전체 로드 실패. 14곳을 한 커밋으로 묶은 것도 옳다 — 나누면 중간 커밋이 로드 실패 상태 |
| 제자리 갱신 복원 | 재할당하면 모킹된 모듈이 옛 객체를 참조해 무효. 주석에 근거 기록 |
| 이중 채널 고정 근거 | `shared-helpers.ts:32-35` 의 `getSelectedProvider()` 가 `process.env` 를 라이브로 읽고 모킹 값보다 우선. 추정 아닌 소스 동작 |
| 단언 강화 | 기존 `should return false when no LLM service is available` 은 실제 환경에 따라 갈리는 `if/else` 였고 `else` 가지는 `preferredProvider` 를 강제로 `null` 로 밀어넣는 자기충족 테스트였다. 새 버전은 직접 단언. **커버리지 손실 없음** — `auto`+무키 조합은 `llm-provider-integration/provider-no-api-keys.spec.ts` 와 같은 파일의 다른 6개 테스트가 담당(재측정 확인) |
| baseline 설계 | 매칭 키에서 줄 번호 제외, stale 보고(FR-014), 사유·후속 필수 검증 |
| 생산 코드 무변경 | diffstat 상 `__tests__/`, `scripts/`, `.github/`, `package.json`, `specs/` 뿐 |

---

## Important (머지 전 수정 권장)

### R-1. `--path` 플래그가 동작하지 않는다 · 신뢰도 100

`scripts/check-vi-mock-paths.ts:42, 109, 138`

```
$ npx tsx scripts/check-vi-mock-paths.ts --path=packages/memento-core --ci
exit=1   ← 등재된 8건이 전부 violation 으로 뒤집힘
```

원인 2개가 겹친다.
1. `BASELINE_PATH` 를 스캔 루트에 join 하므로 `--path=packages` 면 `packages/scripts/vi-mock-path-baseline.json` 을 찾는다 → baseline 이 `[]`.
2. baseline 을 찾더라도 `ref.file` 이 **스캔 루트 기준** 상대 경로라(`:75`) 저장소 루트 기준으로 기록된 baseline 키와 영원히 매칭되지 않는다.

계약서(`contracts/vi-mock-path-checker.md:22`)가 문서화한 옵션인데 루트 이외 값으로는 못 쓴다. 계약서가 같은 PR 에 있으므로 어느 쪽으로든 이번 범위에서 정합 가능.

**수정**: (A) 플래그 삭제 + 계약서 해당 행 제거 — 호출부가 CI 1곳·npm 1곳뿐이고 둘 다 루트에서 돈다. 최단 diff. (B) 유지하려면 저장소 루트를 스캔 루트와 분리해 baseline 로드와 `relative()` 기준에 모두 쓴다.

### R-2. 차단 게이트가 주석·문자열 리터럴에 오탐을 낸다 · 신뢰도 100

`scripts/check-vi-mock-paths.ts:41`

정규식이 파일 텍스트 아무 데나 매칭된다. 리뷰어 실측 픽스처:
```
// vi.mock('../nope/index.js') 예전에 쓰던 모킹      → violation 보고됨
const s = "vi.mock('../also-nope.js')";              → violation 보고됨
```

이론이 아니라 **이미 한 번 발현된 문제**다 — `check-vi-mock-paths.spec.ts:9` 의 `const MOCK_CALL = 'vi.mo' + 'ck';` 가 그 증상이다. 회피책이 취약해서, 누군가 그 파일에 주석으로 `vi.mock(` 을 쓰면 lint 잡이 빨개지고 원인이 자기 자신이라 진단이 오래 걸린다. `main` 을 막는 게이트라 오탐 비용이 크다.

**수정**: 줄 시작 앵커.
```ts
const VI_MOCK = /^[ \t]*vi\.mock\(\s*['"]([^'"]+)['"]/gm;
```
`//` 와 `const s = "` 는 앞에 공백 아닌 문자가 있어 걸러지고 `\s*` 는 그대로라 여러 줄 호출은 계속 잡힌다. **재측정: 저장소 전체에서 기존 57건 / 앵커 57건 동일** — baseline 변동 없는 드롭인. 이후 `MOCK_CALL` 토큰 쪼개기를 없애고 리터럴을 그대로 쓸 수 있다.

### R-3. CLI 계층에 테스트가 하나도 없다 — 계약이 약속한 C1·C5 미자동화 · 신뢰도 95

`scripts/check-vi-mock-paths.spec.ts` 전체

10개 테스트가 전부 순수 함수만 검증한다. `main()` 은 한 줄도 실행되지 않아 **인자 파싱·baseline 로드·exit code 가 전부 미검증**이다. R-1 이 살아서 머지된 것이 정확히 이 공백 때문이다.

계약서 `:119` 는 "C1~C6 은 `check-vi-mock-paths.spec.ts` 로 자동화한다"고 명시하는데 실제로는 C1(저장소+baseline→exit 0), C2 의 exit 1 부분, C5(스키마 오류→exit 1), C6 이 자동화되지 않았다.

**수정**: `execFileSync` 로 실제 저장소를 한 번 돌려 exit 0 을 단언하는 테스트 1개(C1+C6 동시)와 임시 baseline 오류 케이스 1개. 새 추상화 없이 2개면 대부분 닫힌다.

### R-4. 기계적 치환이 남긴 중복 대입 15줄 · 신뢰도 100

`llm-based-relation-extractor.spec.ts` — 529, 729, 808, 1015, 1087, 1155–1156, 1345–1346, 1482–1483, 1770–1771, 2025–2026

```ts
mockConfig.llmProvider = 'auto';
process.env.LLM_PROVIDER = 'auto';
mockConfig.llmProvider = 'auto';   // ← 치환 전부터 있던 줄이 그대로 남음
```

T005 의 `configModule` 블록 치환이 원본에 이미 있던 중복 `mockConfig.X` 줄을 소비하지 않았다. 동작 무해하지만 "각 테스트가 조건을 명시" 정리가 미완이다.

**검증 실패 기록**: 당시 "연속 중복" `awk` 검사가 이를 놓쳤다. 사이에 `process.env` 줄이 끼어 인접하지 않았기 때문이다. 블록 단위 중복 검사였어야 했다.

**수정**: 중복 줄 삭제. `'auto'` 지정 6곳은 `beforeEach` 가 이미 두 채널을 `'auto'` 로 되돌리므로 실질 no-op 이지만, FR-007("각 테스트가 전제를 스스로 명시")의 의도적 산물이므로 남긴다 — 중복만 지운다.

---

## Minor / Suggestion

| # | 항목 | 위치 | 신뢰도 | 재측정 |
|---|------|------|--------|--------|
| R-5 | `isMain()` 재구현. `endsWith` 는 더 약해 그 이름으로 끝나는 아무 경로나 `main()` 을 켠다 | `check-vi-mock-paths.ts:172` | 95 | 확인 — `lib/cli.ts:28` 에 존재, `count-console-logs.ts:554` 가 `isMain(import.meta.url)` 사용 |
| R-6 | `package.json` 들여쓰기 2칸 (주변 4칸) | `package.json:29` | 100 | 확인 |
| R-7 | 계약서 예시가 "58건 스캔"·"정상 48건", 실제 57건 | `contracts/vi-mock-path-checker.md:56,117` | 100 | 확인 |
| R-8 | `existsSync(base)` 가 디렉터리에도 `true` → `index.ts` 없는 디렉터리를 통과시킨다 | `check-vi-mock-paths.ts:46,51` | 90 | 확인 |
| R-9 | 존재하지 않는 `--path` 는 원시 ENOENT 스택으로 죽는다. `check-debt-markers.ts` 는 `statSync` 가드로 한 줄 메시지 | `check-vi-mock-paths.ts:54-61` | 90 | R-1(A) 채택 시 함께 소멸 |
| R-10 | `walk()` 의 `statSync` 가 깨진 심볼릭 링크에서 throw → 게이트 전체 사망. `{ throwIfNoEntry: false }` 한 줄 | `check-vi-mock-paths.ts:58` | 85 | 현재 저장소에 해당 링크 0개 |
| R-11 | **SC-004 문구와 구현 불일치.** SC-004 는 "테스트가 **끝난 직후** 대체 값 객체가 기준 상태" 를 요구하지만 복원은 `beforeEach`(220)에만 있고 `afterEach`(264)에 없다. US3 의 Independent Test 문구 그대로는 통과 못 한다 | spec.md:125 / spec:220 | 90 | 직접 확인. 관측 가능한 동작 차이는 없음 |
| R-12 | baseline 1개가 N개를 덮는다. 이미 등재된 파일에 **같은** specifier 를 하나 더 추가하면 통과 | `check-vi-mock-paths.ts:111` | 85 | 로직 확인 |
| R-13 | **[스펙 한계] `vi.doMock` 사각지대.** 실패 양상이 `vi.mock` 과 동일한데 정규식 밖. 저장소에 상대경로 1건(`runtime-diagnostics-logger.spec.ts:93`) — 현재 해석되므로 오늘은 결함 아님. 템플릿 리터럴도 동일 | 계약서 `:34` | 90 | 확인 |
| R-14 | **[스펙 약점] FR-014 가 강제되지 않는다.** stale 은 보고만 하고 exit 0 이라 baseline 이 부패해도 CI 는 초록. 계약 `:50` 의 명시적 선택이므로 구현 결함은 아니다 | 계약서 `:50` | 85 | — |

---

## 기각 / 판단 변경

**`importOriginal()` 스프레드 승격 경로는 철회한다.** `research.md` R3 이 "부분 모듈 반환으로 오류가 나면 `importOriginal` 스프레드로 승격" 이라고 적었는데, 리뷰어가 이를 반박했고 근거가 옳다: 실제 `shared/config/index.ts` 가 로드 시점에 dotenv `config()` 를 호출하므로, 저장소 루트의 `.env` 가 `beforeEach` 의 `originalEnv` 캡처보다 먼저 `process.env` 를 채운다. **이 PR 이 제거한 바로 그 결합을 되살린다.** 게다가 이 사각지대는 조용하지 않다 — 그래프가 커지면 스펙 로드 시 `TypeError` 로 시끄럽게 실패한다. R3 의 승격 경로를 삭제하고 "무해한 인라인 스텁 추가" 로 대체해야 한다.

---

## 문제 없음이 확인된 항목

- **`afterEach` 환경 변수 복원**: 안전. Vitest 는 테스트가 throw 해도 `afterEach` 를 실행하고, 훅 순서가 outer `beforeEach` → inner `beforeEach` → inner `afterEach` → outer `afterEach` 라 캡처가 항상 중첩 describe 의 변경보다 앞선다. `originalEnv` 가 `const` 인 것도 무관 — 재할당이 아니라 속성 갱신이다.
- **API 키 `delete` 제거**: 안전. `shared/` 와 `domains/relation/` 어느 생산 코드도 두 변수를 직접 읽지 않고 전부 `mementoConfig` 를 경유한다. 적대적 환경 실행이 이를 증명한다.
- **`process.exit` 의미**: 계약 `:46-51` 과 일치. 다만 baseline 파싱 실패 시 non-ci 는 스캔을 건너뛰고 종료하므로 로컬 실행자가 아무 결과도 못 본다 — `return` 후 빈 baseline 으로 진행하는 편이 낫다.
- **`match.index`**: `matchAll` 은 항상 제공. 정상.
- **`SKIP_DIR` 완전성**: 실제 저장소 커버 충분, 실행 0.7초.
- **모킹 팩토리가 `{ mementoConfig }` 만 반환**: 현 임포트 그래프에 다른 export 사용처 없어 통과. 위 "기각" 항목 참조.

---

## superspec 차원 대조

| 차원 | 결과 |
|------|------|
| **Spec 준수** | FR-001~FR-015 전부 구현에 대응. FR-007 기준 상태 정의 1곳, FR-007a 실 config 참조 0곳, FR-008 5/5 항목 확인 |
| **Edge case 커버리지** | brainstorm 13개 전부 대응 (팬텀 쌍 양방향, TDZ, 위임 조회, 죽은 선언, env 우선순위, stale 보고 등) |
| **Success Criteria** | SC-001~SC-003·SC-005~SC-008 달성. **SC-004 는 문구 기준 미달**(R-11) |
| **Constitution** | I 충족(RED 선행 기록 + 게이트 spec RED→GREEN) · II 충족 · III 해당 없음 · IV 충족(lint 0 errors / type-check / 474 files 5097 tests) · IV graphify 비적용(생산 코드 0줄) · V 충족 |

---

## 권고 순서

1. **R-1** `--path` 삭제 + 계약서 행 제거 (R-9 도 함께 소멸)
2. **R-2** 정규식 줄 시작 앵커 (57건 불변 실측 완료) → `MOCK_CALL` 쪼개기 제거
3. **R-3** `execFileSync` 기반 CLI 테스트 2개 (C1+C6, C5)
4. **R-4** 중복 15줄 정리 · **R-11** `afterEach` 복원 한 줄 · **R-5** `isMain()` · **R-6** 들여쓰기 · **R-7** 계약서 57
5. **기각 항목** `research.md` R3 승격 경로 삭제
6. **R-13/R-14** 는 계약서에 범위 한계를 명시하고 후속 이슈로 분리

1~3 을 반영하면 오늘 차단 게이트로 켜도 안전하다. 4~6 은 저렴하므로 같은 PR 에 넣는 편이 낫다.
