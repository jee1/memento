# slop-detector Gate HALT 베이스라인 (2026-06-14)

관련 이슈: [#504](https://github.com/jee1/memento/issues/504), [#505](https://github.com/jee1/memento/issues/505)-[#508](https://github.com/jee1/memento/issues/508)

## 측정 조건

- 도구: `ai-slop-detector 3.8.5`
- 설정: `.slopconfig.yaml` (test/spec·`src/test`·`__tests__` 제외)
- 명령:

```bash
slop-detector --project packages/memento-core/src --js --gate --config .slopconfig.yaml
slop-detector --project packages/memento-server/src --js --gate --config .slopconfig.yaml
slop-detector --project packages/memento-client/src --js --gate --config .slopconfig.yaml
```

## 프로젝트 Gate (2026-06-14, #504 작업 후)

| 패키지 | Clean | Suspicious | Critical | 평균 Deficit | LDR | Gate | HALT 사유 |
|--------|-------|------------|----------|-------------|-----|------|-----------|
| memento-core | 516 | 184 | 47 | CLEAN (<30) | ~42% | HALT | LDR, DDC=0, pattern_penalty=50 |
| memento-server | 93 | 37 | 7 | CLEAN (<30) | ~41% | HALT | LDR, DDC=0, pattern_penalty=50 |
| memento-client | 9 | 0 | 0 | CLEAN (<30) | ~52% | HALT | LDR, DDC=0 |

## 해석

1. **평균 Deficit Score는 CLEAN**이지만, slop-detector **프로젝트 Gate**는 LDR·DDC·pattern_penalty 복합 조건으로 HALT한다.
2. **DDC=0%** 는 TypeScript monorepo에서 type-only·내부 패키지 import가 런타임 사용으로 집계되지 않는 [알려진 한계](https://github.com/jee1/memento/issues/504)다. TS 전용 저장소에 프로젝트 Gate를 merge 필수로 두지 않는다 (#314 정책 유지).
3. **test/spec ignore** (#508): `.slopconfig.yaml`에 `**/*.spec.ts`, `packages/**/src/test/**` 등을 명시해 prod-only 스캔과 Gate 집계에서 테스트 코드를 제외한다.
4. **actionable signal**: Gate HALT 대신 **Critical/Suspicious 파일 목록**과 이슈별 리팩터(#505–#507)로 품질을 개선한다.

## #504–#508 조치 요약

| 이슈 | 조치 | 검증 |
|------|------|------|
| #508 | `.slopconfig.yaml` ignore 보강 | prod 스캔에 `*.spec.ts`/`src/test` 미포함 |
| #505 | `agent.routes.ts` 5-모듈 분해 (#496 패턴) | `createAgentRouter` god function 제거, spec 21 passed |
| #506 | `agent-ask.ts` `teardownAgentAsk()` 추출 | empty arrow placeholder 0건 |
| #507 | recall envelope·lifecycle helper 분리 | 대상 파일 JS/TS Clean |
| #504 | CI 3.8.5 + gate 로그, 베이스라인 문서 | advisory workflow 유지 |

## CI 정책 (#504 결정)

- **merge 필수 게이트로 승격하지 않음** — TS DDC 한계로 프로젝트 Gate PASS 불가.
- `.github/workflows/slop-detector-js.yml`: `3.8.5`, 패키지별 `--gate` 로그·아티팩트 업로드, `continue-on-error: true` 유지.
- 로컬: `npm run quality:slop:gate`

## 재측정

```bash
npm run quality:slop:gate
```
