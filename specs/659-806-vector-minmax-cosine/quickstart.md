# Quickstart: 벡터 유사도 절대 척도 복원 (#806)

**Date**: 2026-08-29 | **Plan**: [plan.md](./plan.md) | **Branch**: `659-806-vector-minmax-cosine`

구현자가 처음 30분 안에 결함을 눈으로 확인하고, 무엇을 어디서 고치는지 잡는 문서.

## 1. 결함을 직접 본다

```bash
npm ci
npm run build -w packages/memento-core
```

확인 지점 두 곳:

```bash
# (1) 정상 경로: 제공자별 결과셋 min-max 재조정
sed -n '262,290p' packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.ts

# (2) 대체 경로: 거리값이 유사도 필드로 들어간다
grep -n "v.distance as similarity" packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
sed -n '312,330p' packages/memento-core/src/domains/memory/services/memory-embedding-service.ts
```

올바른 변환은 이미 저장소에 있다. 비교해서 볼 것:

```bash
sed -n '27,40p' packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.ts
```

## 2. 손대는 파일 (6곳)

| # | 경로 | 무엇을 |
|---|------|--------|
| 1 | `packages/memento-core/src/shared/utils/vector-similarity.ts` | **신설.** 거리→유사도 단일 정의 |
| 2 | `.../domains/search/repositories/vector-search/vector-search-result-mapper.ts` | 1번을 사용하고 재노출 |
| 3 | `.../domains/memory/services/memory-embedding-service.ts` | 대체 경로 매퍼가 1번을 사용. 근접도 필드 1개로 정리 |
| 4 | `.../domains/search/algorithms/hybrid-vector-search-executor.ts` | 제공자별 min-max 제거 |
| 5 | `.../shared/config/ranking-weights-loader.ts` | 랭킹 버전 payload에 척도 규정 추가 |
| 6 | `docs/agents/search-ranking.md` | 척도 변경 시점·해석 기준 기록 |

`search-result-combiner.ts`는 **고치지 않는다.** 이미 절대 기준으로 문구를 고르고 있고, 입력이 재조정된 값이었을 뿐이다. 검증만 추가한다.

## 3. 실패하는 검증부터 (Principle I)

각 Phase는 red → green 순서다. 신규 검증 파일이 필요한 지점:

- `hybrid-vector-search-executor.spec.ts` — **전용 파일이 없다. 새로 만든다.**
- `memory-embedding-service`의 대체 경로 매퍼 검증 — 새로 만든다.
- `vector-search-result-mapper.spec.ts` — 기존 파일. Phase 1 리팩터의 green baseline
- `ranking-weights-loader.spec.ts` — 식별자 변화 확인
- `search-result-combiner` 문구 검증 — 새로 만든다

### 대체 경로를 검증에서 실행시키는 법

오류를 만들 필요가 없다. 실행 지점이 진입할 때 인덱스 가용 여부를 보고 곧바로 분기한다.

```ts
// getIndexStatus()가 available:false면 예외 없이 대체 경로로 간다
const engine = { initialize: vi.fn(), getIndexStatus: () => ({ available: false, /* ... */ }) };
```

### 경로 간 점수 비교 시 주의

정상 경로는 저장된 **모든** 제공자를 조회해 최댓값을 남기고, 대체 경로는 쿼리 임베딩 제공자 **하나**만 조회한다. 제공자를 맞추지 않고 비교하면 정상 동작을 결함으로 오판한다.

## 4. 눈으로 확인하는 판정 기준

| 무엇 | 교정 전 | 교정 후 |
|------|---------|---------|
| 무관한 쿼리의 최상위 점수 | 1.0 | 실제 근접도(낮음) |
| 같은 기억, 결과셋 구성만 다름 | 점수가 달라짐 | 동일 |
| 후보 1건 vs 다건 | 점수가 달라짐 | 동일 |
| 대체 경로 임계값 통과분 | 가장 **먼** 후보 | 가장 **가까운** 후보 |
| 결과 수 | — | 거의 그대로(보충이 채운다). 달라지는 건 **점수 분포** |
| 랭킹 버전 식별자 | — | 달라져야 한다 |

**결과 수 감소를 회귀로 판정하지 말 것.** 보충 동작이 켜져 있으면 결과 수는 거의 유지된다.

## 5. 픽스처 규칙

커밋되는 검증 데이터는 **합성**이어야 한다. 재배포가 허용되지 않는 외부 코퍼스와 그 파생물은 커밋 금지. 그런 코퍼스를 쓰는 측정은 로컬 실행에 두고 집계·식별자·해시만 남긴다.

## 6. 완료 게이트

```bash
npm run lint
npm run type-check
npm test
# 프로덕션 코드를 건드렸으므로 graphify 재빌드 후 리포트 확인
# graphify-out/ 은 커밋하지 않는다
```

## 7. 건드리지 않는 것

- 임계값 숫자(0.38)·프리페치 배수·보충 활성 여부·랭킹 가중치 → 동결
- 이웃 기억 조회, 앵커 다단계 확장, 중복 판정, 기억 통합 → 이미 절대 유사도를 쓰거나 임베딩에서 직접 계산한다
- 프라이버시 범위 필터의 채널 간 비대칭 → 보안·권한 범위 변경이라 별도 명세 필요. **구성을 바꾸지 말 것**
- 저장된 점수 스냅샷 → 마이그레이션·백필 없음
