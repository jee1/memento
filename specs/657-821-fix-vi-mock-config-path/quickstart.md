# Quickstart: relation config 모킹 교정

**Feature**: 657-821-fix-vi-mock-config-path | **Date**: 2026-08-27

구현자가 처음 10분에 해야 할 것. 모든 명령은 **저장소 루트**에서 돈다 (research R9).

---

## 0. 결함을 눈으로 확인 (2분)

```bash
F=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts

# 모킹 대상 경로가 실재하지 않음
ls packages/memento-core/src/domains/shared/config/index.ts   # → No such file

# 소스가 읽는 실제 경로는 여기
ls packages/memento-core/src/shared/config/index.ts           # → 존재

# 팬텀 13 : 실 모듈 1
grep -c "await import('\.\./\.\./\.\./shared/config/index\.js')"      $F   # → 13
grep -c "await import('\.\./\.\./\.\./\.\./shared/config/index\.js')" $F   # → 1

# 같은 파일이 이미 shared/ 를 4단계로 쓰고 있다
sed -n '93,95p' $F
```

## 1. 교정 전 기준선 (RED, Phase A)

```bash
npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
# → 36 tests passed  (교정 전에도 전량 통과 — 통과는 품질 신호가 아니다)
```

`mockConfig.llmProvider` 기본값 `'auto'` 를 `'openai'` 로 바꿔 다시 돌린다. **결과가 그대로면** 모킹이 소스에 닿지 않는다는 증거다. 이 측정을 기록으로 남긴다 (SC-001).

```bash
grep -n "LLM_PROVIDER" .env    # line 71: LLM_PROVIDER=ollama — 위양성의 재료
```

## 2. 원자적 교정 (Phase B)

**한 편집에서 셋을 같이 한다.** 순서를 나누면 스펙 파일이 로드조차 안 되거나 조용히 실 전역을 조작한다.

```ts
// (a) mockConfig 를 vi.hoisted 로 끌어올린다 — 안 하면 TDZ 로 파일 전체 로드 실패
const { createMockConfig, mockConfig } = vi.hoisted(() => {
  const createMockConfig = () => ({ /* 기존 10개 필드 그대로 */ });
  return { createMockConfig, mockConfig: createMockConfig() };
});

// (b) vi.mock 대상 경로 3단계 → 4단계
vi.mock('../../../../shared/config/index.js', () => ({ mementoConfig: mockConfig }));
```

```bash
# (c) 동적 재가져오기 13곳 일괄 치환 — line 720(이미 4단계)은 패턴이 달라 안 걸린다
sed -i "s#await import('\.\./\.\./\.\./shared/config/index\.js')#await import('../../../../shared/config/index.js')#g" $F
grep -c "await import('\.\./\.\./\.\./\.\./shared/config/index\.js')" $F   # → 14
grep -c "await import('\.\./\.\./\.\./shared/config/index\.js')"      $F   # → 0
```

```bash
# (d) 죽은 선언 제거 (FR-012) — relation-extractor.spec.ts line 24 의 vi.mock 블록 전체
sed -n '20,35p' packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
```

확인: 스펙 파일이 **로드되는가**. `ReferenceError: Cannot access 'mockConfig' before initialization` 가 나면 (a) 를 빠뜨린 것이다.

## 3. 드러난 실패 정리 (Phase C)

```ts
beforeEach(() => {
  Object.assign(mockConfig, createMockConfig());   // 제자리 갱신. 재할당하면 무효
});
```

- 실패마다 분류: **테스트가 조건을 명시 안 함**(→ 테스트 안에서 명시) vs **소스 결함**(→ 고치지 말고 별도 이슈, FR-011).
- 단언 약화 금지 (FR-005).
- line 720 의 실 전역 직접 조작을 모킹 기반으로 이관 (FR-007a).
- line 288 `actualConfig` — 이름·주석·실제가 어긋난 지점. 교정 후 분기가 결정적이 되므로 함께 정리 (research R6).

순서 무관성 확인:

```bash
npx vitest run $F --sequence.shuffle
npx vitest run $F   # 반복 실행해도 동일 결과 (SC-003)
```

## 4. 재발 방지 게이트 (Phase D)

계약: [contracts/vi-mock-path-checker.md](./contracts/vi-mock-path-checker.md)

```bash
# 현재 위반 실측 — 게이트 구현 전 기대값 확인용
# 상대경로 vi.mock 58건 중 미해석 10건 (범위 내 2 + baseline 8)
```

`scripts/check-vi-mock-paths.ts` + `scripts/check-vi-mock-paths.spec.ts` + `scripts/vi-mock-path-baseline.json`(8건) 을 만들고, `ci.yml` lint 잡의 `check-retry-usage` 스텝 뒤에 한 줄 붙인다.

## 5. 완료 게이트

```bash
npm run lint
npm run type-check
npm test
```

graphify 는 **비적용** — 프로덕션 코드를 건드리지 않는다 (Constitution IV). FR-011 로 소스를 고치게 되면 그 순간 적용된다.

---

## 함정 요약

| 함정 | 증상 | 대응 |
|------|------|------|
| `vi.hoisted()` 누락 | 스펙 파일 전체 로드 실패 (`ReferenceError`) | research R2 |
| 재가져오기만 교정 | 조용히 실 전역 조작으로 회귀 — **가장 위험** | INV-5 |
| `mockConfig` 재할당 | 모킹된 모듈이 옛 객체를 붙잡아 복원이 무효 | INV-1 |
| `packages/memento-core` 안에서 vitest 실행 | `No test files found` | research R9 |
| baseline 키에 줄 번호 포함 | 무관한 편집에 예외가 조용히 풀림 | INV-8 |
