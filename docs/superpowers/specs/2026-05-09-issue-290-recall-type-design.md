# Issue 290: recall `type` 경고·계약 정리 설계

**관련:** [GitHub #290](https://github.com/jee1/memento/issues/290) — `recall` 호출 시 `type` 미지정으로 인한 WARN 반복(memento-log-monitor).

**워크트리:** `.worktrees/issue-290-recall-type` · 브랜치 `feat/issue-290-recall-type`

---

## 1. 배경

- `packages/memento-core/src/domains/memory/tools/recall-tool.ts`는 `type`이 없으면 항상 `validateTypeParam`을 호출하고, 주석상 **`memory_types`만 있어도** missing-`type` 경고를 내도록 되어 있음.
- 기본 모드(`MEMENTO_TYPE_PARAM_MODE` 미설정 → `warn`)에서 이 메시지가 운영 로그에 반복 수집됨.
- `type-param-validator.ts`의 `deprecate` 분기는 마이그레이션 URL이 플레이스홀더(`your-repo`)로 남아 있음.

## 2. 목표

1. **운영 관측:** memento-log-monitor에 잡히는 **불필요한** missing-`type` WARN을 줄인다.
2. **계약·가이드:** 호출자가 `type`을 명시하도록 MCP 설명·문서·롤아웃 모드 설명을 일관되게 한다.
3. **유지보수:** deprecate 경로의 **잘못된 문서 링크**를 실제 저장소 문서로 교정한다.

## 3. 비목표

- 이번 변경만으로 **기본 `MEMENTO_TYPE_PARAM_MODE`를 `error`로 바꾸지 않는다** (호환성 파괴; 메이저·릴리스 정책에서 별도 결정).
- `remember` 등 다른 도구의 `type` 롤아웃 동작을 **이번 범위에서 넓게 바꾸지 않는다** (필요 시 동일 패턴을 후속 이슈로 정리).

## 4. 설계 결정

### 4.1 `recall` 경고 조건

| 조건 | 동작 |
|------|------|
| `type` 제공 | 기존과 동일(유효성 검사 후 해당 분기). |
| `type` 없음 · `memory_types` 길이 ≥ 1 | **missing-`type` WARN을 내지 않는다** (필요 시 `debug` 수준 로그만 허용). 타입 필터 의도가 `memory_types`로 이미 드러난다고 본다. 내부 기본 `validatedType`은 **기존과 동일하게** 설정하여 검색 경로 호환을 유지한다. |
| `type` 없음 · `memory_types` 없음(또는 빈 배열) | 기존과 동일: `MEMENTO_TYPE_PARAM_MODE`에 따라 `warn` / `deprecate` / `error`. |

**문서·주석:** 기존 PRD/주석의 "`memory_types`만 있어도 경고"는 위 규칙과 모순되므로 **해당 주석과 관련 문구를 이 설계에 맞게 갱신**한다.

### 4.2 선택적 후속(이번 스펙에 필수 아님)

- `query`만 있고 `type`·`memory_types` 모두 없는 호출에 대해 **시간 윈도우 샘플링**으로 WARN 중복을 줄이는 방안은, 필요 시 별도 플래그·이슈로 추가한다.

### 4.3 계약·문서

- MCP `recall` 도구 설명: **가능하면 항상 `type`을 지정**하고, 복수 타입 필터가 필요하면 `memory_types`를 사용한다는 문구로 정렬한다.
- `docs`에 **롤아웃 단계**(`warn` → `deprecate` → `error`)와 `MEMENTO_TYPE_PARAM_MODE` 용도를 짧게 정리한다(기존 문서가 있으면 보강·링크).
- `validateTypeParam` `deprecate` 메시지의 마이그레이션 URL을 **실제 저장소의 문서 경로**(예: 본 저장소 `docs/` 내 마이그레이션 또는 환경 설정 가이드)로 교체한다. 문서 파일이 없으면 **이번 작업에서 최소한의 마이그레이션 섹션을 추가**해 링크가 깨지지 않게 한다.

## 5. 테스트

- `recall` 관련 스펙: **`memory_types`만 있는 호출에서 missing-`type` WARN이 발생하지 않음**을 검증한다.
- **`type`과 `memory_types` 모두 없을 때** 기존 `warn`(또는 설정된 모드) 동작이 유지되는지 검증한다.
- `type-param-validator`: URL·메시지 변경이 있으면 단위 테스트를 갱신한다.

## 6. 구현 시 참고 파일

- `packages/memento-core/src/domains/memory/tools/recall-tool.ts` — 경고 분기·주석.
- `packages/memento-core/src/shared/utils/type-param-validator.ts` — deprecate URL·메시지.
- `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` (또는 동등 테스트).
- MCP 도구 스키마/설명 정의 위치(기존 `recall` 등록부).

## 7. 검증(구현 단계)

- `npm test` 및 관련 패키지 테스트 통과.
- `npm run lint` / `npm run type-check` 통과(프로젝트 표준에 따름).

---

**상태:** 브레인스토밍 전체 승인 반영. 다음 단계: 구현 계획(`writing-plans`) — 사용자가 본 스펙 파일 검토 후 진행.
