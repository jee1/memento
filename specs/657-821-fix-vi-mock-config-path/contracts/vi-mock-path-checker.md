# Contract: `check-vi-mock-paths` 게이트

**Feature**: 657-821-fix-vi-mock-config-path | **Date**: 2026-08-27
**Covers**: FR-009, FR-010, FR-013, FR-014 / SC-005, SC-007

이 저장소가 외부에 노출하는 인터페이스 중 이번 작업이 **새로 추가하는 것은 CLI 하나와 파일 형식 하나**다. MCP 도구 계약·HTTP 엔드포인트·공개 API 는 건드리지 않는다(Constitution II).

---

## 1. CLI 계약

```
npx tsx scripts/check-vi-mock-paths.ts [옵션]
```

저장소 루트는 스크립트 위치에서 유도한다. 실행 시 `cwd` 와 무관하게 같은 범위를 스캔하고, 보고 경로와 baseline 키가 같은 기준을 쓴다.

기존 `scripts/check-retry-usage.ts` · `scripts/count-console-logs.ts` 의 관례를 따른다.

| 옵션 | 기본값 | 의미 |
|------|--------|------|
| `--ci` | off | 위반이 있으면 exit code 1. 없으면 0 |
| `--format=<text\|json>` | `text` | 출력 형식 |
| `--baseline=<path>` | `scripts/vi-mock-path-baseline.json` | 예외 목록 파일. 상대 경로는 저장소 루트 기준 |

**npm 스크립트**: `npm run check:vi-mock-paths` → `tsx scripts/check-vi-mock-paths.ts`

### 스캔 대상

| 포함 | 제외 |
|------|------|
| `**/*.spec.ts`, `**/*.test.ts`, `**/*.spec.tsx`, `**/*.test.tsx` | `node_modules/`, `dist/`, `.git/` |

### 판정

1. **줄 시작에 오는** `vi.mock('<specifier>')` / `vi.mock("<specifier>")` 를 수집한다(`/^[ \t]*vi\.mock\(/gm`). 앵커가 없으면 주석과 문자열 리터럴 안의 텍스트까지 위반으로 집어낸다.

   **범위 한계**: `vi.doMock` 과 템플릿 리터럴 인자는 같은 실패 양상을 갖지만 이번 범위 밖이다 → #826.
2. `<specifier>` 가 `.` 로 시작하지 **않으면 건너뛴다** — 패키지 이름 모킹은 이 게이트의 대상이 아니다 (FR-010).
3. 스펙 파일 디렉터리 기준으로 해석하고, 아래 후보 중 **하나라도** 존재하면 통과:
   - `.js` → `.ts` 치환
   - `.js` → `.tsx` 치환
   - specifier 원본
   - `+ .ts`
   - `+ .tsx`
   - `<dir>/index.ts`
4. 미해석 항목을 baseline 과 대조해 `violation` / `baselined` 로 나눈다.
5. baseline 에 있으나 해석되는 항목은 `stale-baseline` 으로 보고한다 (FR-014).

### Exit code

| code | 조건 |
|------|------|
| `0` | `violation` 0건 (`baselined`·`stale-baseline` 은 있어도 통과) |
| `1` | `violation` ≥ 1건 **또는** baseline 파일이 스키마를 어김 (`--ci` 일 때만 exit 1; 미지정 시 보고만) |

### 출력 (text)

```
vi.mock 경로 검사 - 상대경로 57건 스캔

위반 (차단) 0건
예외 등재 (baseline) 8건
  packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts:37 -> ../config/index.js
    사유: 임베딩 도메인 전반 재구성 필요 / 후속: #TBD
  ...
정리 대상 (baseline 에 있으나 위반 아님) 0건

OK
```

위반이 있을 때는 `file:line -> specifier` 를 각 줄에 낸다 (Constitution V, FR-009).

### 출력 (json)

```json
{
  "scanned": 58,
  "violations": [{ "file": "...", "line": 37, "specifier": "..." }],
  "baselined": [{ "file": "...", "line": 37, "specifier": "...", "reason": "...", "followUp": "..." }],
  "staleBaseline": [{ "file": "...", "specifier": "..." }]
}
```

---

## 2. Baseline 파일 계약

**경로**: `scripts/vi-mock-path-baseline.json`

```json
[
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "../config/index.js",
    "reason": "임베딩 provider 스펙 전반이 같은 결함을 가짐. 5건 묶어서 별도 처리.",
    "followUp": "#TBD"
  }
]
```

| 규칙 | 내용 |
|------|------|
| 매칭 키 | `file` + `specifier`. **줄 번호는 키가 아니다** |
| 필수 필드 | 4개 전부. 하나라도 비면 baseline 파일 자체가 오류 |
| 초기 등재 | research R8 의 8건. 그 이상도 이하도 아니다 (SC-007) |
| 항목 추가 | 예외적 행위. PR 설명에 사유를 남긴다 (FR-013) |
| 항목 제거 | 해소되면 즉시 (FR-014) |

---

## 3. 검증 시나리오

| # | Given | When | Then |
|---|-------|------|------|
| C1 | 현재 저장소 + 8건 baseline | `--ci` 실행 | exit 0, `violation` 0, `baselined` 8 |
| C2 | 존재하지 않는 상대 모듈을 모킹하는 스펙 1개 추가 | `--ci` 실행 | exit 1, 그 `file:line` 이 `violation` 에 나옴 (SC-005) |
| C3 | 패키지 이름 모킹(`vi.mock('openai')`) | 실행 | 레코드 자체가 안 생김 — 오탐 0 (FR-010) |
| C4 | baseline 항목의 스펙 파일이 실제로 고쳐짐 | 실행 | exit 0 유지 + `stale-baseline` 에 보고 (FR-014) |
| C5 | baseline 항목에서 `reason` 삭제 | `--ci` 실행 | exit 1, baseline 스키마 오류 보고 |
| C6 | 정상 모킹 49건 | 실행 | 하나도 위반으로 보고되지 않음 (SC-005 후단) |
| C7 | 주석 처리된 모킹, 문자열 리터럴 안의 모킹 | 실행 | 수집되지 않음 — 줄 시작 앵커 |
| C8 | `index.ts` 가 없는 디렉터리를 가리키는 모킹 | 실행 | 해석 실패로 판정 |

C1~C6 은 `scripts/check-vi-mock-paths.spec.ts` 로 자동화한다(선례: `scripts/lib/quarantine-gates.spec.ts`).

---

## 4. CI 배선

`.github/workflows/ci.yml` 의 `lint` 잡, `check-retry-usage` 스텝 바로 뒤:

```yaml
      - run: npx tsx scripts/check-vi-mock-paths.ts --ci
```

같은 잡의 이웃 스텝들과 동일한 형태다. 새 잡·새 워크플로를 만들지 않는다.
