# 설계: 이슈 #162 — `.slopconfig.yaml`로 빌드·리포트 산출물 slop 분석 제외

**상태**: 브레인스토밍 승인 완료  
**날짜**: 2026-05-01  
**이슈**: [GitHub #162](https://github.com/jee1/memento/issues/162)

---

## 1. 배경·문제

`slop-detector --project . --js` 실행 시 **빌드·생성 아티팩트**가 분석 대상에 포함되어 결과가 오염된다. 대표적으로 `demo/.next/**`(Next.js), `coverage/**`(Istanbul 리포트) 등이 언급되었다. `graphify-out/**`는 코드 그래프 산출물로 소스가 아니다.

---

## 2. 목표·비목표

### 2.1 목표

- 저장소 **루트**에 `.slopconfig.yaml`(스키마 `version: "2.0"`)을 추가한다.
- `ignore` 목록으로 의존성·빌드·테스트 리포트·graphify 산출물을 제외하여, 로컬 전체 프로젝트 스캔 시 **실제 소스**에 집중할 수 있게 한다.
- `slop-detector` CLI의 `--config` 도움말이 가리키는 파일명(`.slopconfig.yaml`)과 일치시킨다.

### 2.2 비목표

- CI에 slop 하드 게이트 추가.
- 패턴 ID 비활성화·점수 임계값 튜닝.
- ignore 목록에 대한 자동화된 단위 테스트(검증은 **수동 CLI**).

---

## 3. 설계 방침 (승인된 B안)

`.gitignore`에서 이미 “소스가 아님”으로 취급하는 유형과 맞춘다.

### 3.1 `ignore` 패턴 (확정)

| 패턴 | 이유 |
|------|------|
| `**/coverage/**` | 커버리지 HTML/JS 리포트 |
| `graphify-out/**` | graphify 산출물 |
| `**/.next/**` | Next.js 빌드(`demo/.next` 포함·이동 대비) |
| `**/node_modules/**` | 의존성 |
| `**/dist/**` | 패키지 컴파일 산출물 |
| `test-results/**` | Playwright 등 테스트 산출물 |
| `.nyc_output/**` | nyc 캐시 |
| `**/.rpt2_cache/**` | 마이크로번들/rollup 캐시 |
| `**/.rts2_cache_cjs/**` | 동일 계열 캐시 |
| `**/.rts2_cache_es/**` | 동일 계열 캐시 |
| `**/.rts2_cache_umd/**` | 동일 계열 캐시 |

### 3.2 검증

워크트리(또는 클론) 루트에서:

```bash
slop-detector --project . --js
```

필요 시 명시:

```bash
slop-detector --project . --js --config .slopconfig.yaml
```

기대: 위 경로들이 **개별 파일 이슈**로 과도하게 뜨지 않음(도구 출력 형식에 따름).

---

## 4. 출처

- 브레인스토밍: 사용자 옵션 **2**(생성물·캐시 확장) + **B안**(.gitignore 정렬) 승인.
