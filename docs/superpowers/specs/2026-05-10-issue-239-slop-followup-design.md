# 설계: 이슈 #239 — slop-detector JS/TS 정리 (정책 A: 커밋 설정에 spec 대량 ignore 없음)

**상위:** [GitHub #239](https://github.com/jee1/memento/issues/239)  
**관련:** [#221 범위·설정](https://github.com/jee1/memento/issues/221), 서브 [#313](https://github.com/jee1/memento/issues/313)

## 1. 문제

`ai-slop-detector --js`로 스캔하면 Vitest의 긴 `describe`/`it`이 Critical에 많이 잡혀 **프로덕션 신호와 섞인다**. 한편 [#221 설계](./2026-05-02-issue-221-slop-scope-design.md)와 `DEVELOPMENT_RULES.md`에서는 **루트 `.slopconfig.yaml`에 `*.spec.ts` 등을 대량으로 넣지 않는다**고 정했다.

## 2. 목표

- 저장소에 커밋되는 기본 설정은 **#221 정책 유지**(spec/tests 대량 무시 없음).
- 로컬에서만 노이즈를 줄이고 싶은 기여자에게 **재현 가능한 절차**를 문서로 제공한다.
- CI·프로덕션 리팩터는 각각 [#314](https://github.com/jee1/memento/issues/314), [#315](https://github.com/jee1/memento/issues/315)에서 다룬다(본 설계의 비범위).

## 3. 결정 사항

| 항목 | 결정 |
|------|------|
| 루트 `.slopconfig.yaml` | `**/*.spec.ts` / `tests/**` 등 **추가하지 않음**. |
| 로컬 오버라이드 | `.slopconfig.local.yaml`을 두고 `gitignore`에 등록. 내용은 **로컬에서만** 유지(루트 YAML 복사 후 필요한 `ignore`만 추가). |
| 실행 | `slop-detector ... --config .slopconfig.local.yaml` — 루트 설정과 동일한 `ignore` 베이스를 복사한 뒤 로컬 전용 패턴만 덧붙인다(도구가 다중 설정 병합을 지원하지 않으므로 **단일 파일**로 운용). |
| `--gate` | 기존 문서대로 JS/TS 구간을 주된 근거로 본다. |

## 4. 비목표

- 필수 CI에 slop 하드 게이트 추가.
- 프로덕션 파일 대규모 리팩터(별도 이슈/플랜).

## 5. 검증

- `.slopconfig.local.yaml`이 저장소에 추적되지 않는다(`git check-ignore -v .slopconfig.local.yaml`).
- `DEVELOPMENT_RULES.md`에 로컬 절차가 명시되어 있다.

## 6. 참고

- 권장 스캔 명령은 `DEVELOPMENT_RULES.md` 「선택적 정적 스캔」절을 단일 소스로 한다.
