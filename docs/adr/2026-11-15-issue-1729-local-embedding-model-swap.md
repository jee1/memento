# ADR: 로컬 임베딩 모델을 한국어 검색용 e5-small-ko-v2 로 바꾼다 (이슈 #1729)

- 상태: Proposed (설계 리뷰 전, 사용자 결정 3건 대기)
- 날짜: 2026-11-15
- 이슈: https://github.com/jee1/memento/issues/1729
- 관련: #889(모델 일관성), #1112(창 벡터), #1225(라벨 뗀 재임베딩), #806(유사도 변환 단일 원본), #1687(설정 값 별칭 선례), #1180(관련성 축척), #1399(랭킹 손잡이 도구)

측정은 운영 DB 사본(기억 13,510건)과 질문 262개로 했다. 하네스와 원자료는 기억 원문을 담고 있어 저장소 밖에 둔다. 이 문서에는 집계만 적는다.

## 요약

- 모델은 한국어 검색용 `dragonkue/multilingual-e5-small-ko-v2`(384차원)로 바꾼다(사용자 결정, 2026-11-15). 저장 공간과 스키마는 그대로다.
- 모델에 따라 달라지는 값(이름, 파일 위치, 접두, 보정 계수, 기억끼리 기준값)은 `embedding-models.ts` 의 모델 정의 하나에 모은다.
- 질의는 `query: `, 기억은 `passage: ` 를 붙인다. 이를 위해 질의 진입점을 따로 둔다. 기억끼리 비교는 저장한 기억 벡터를 그대로 쓴다.
- 검색 점수는 측정한 1차 변환(a=1.9943, b=-0.6838)으로 지금 척도에 맞춘다. 이 보정은 질의-기억 점수에만 쓴다. 검색 상수(0.38, 0.8, 융합 가중치)는 그대로 둔다.
- 이슈가 꼽은 기준값 8곳 가운데 둘(검색 임계 0.38, high_vector 0.8)은 보정이 흡수해 그대로 둔다. 나머지 여섯 곳은 기억끼리 raw 코사인 기준값이라 모델 정의에 두고 분위 맞춤 값에서 시작한다. 데이터를 바꾸는 세 곳(Sleep consolidation 군집, 요약 합침, 중복 자동 합침)은 agent_panel 판정으로 확인한다. 앵커 다시 걸기는 운영 호출처가 없어 기준값을 맞추지 않고 지운다.
- 지금 코드는 전환 구간에 옛 모델 벡터와 새 모델 벡터를 섞어 비교한다(이웃 기억, 앵커 캐시, Sleep consolidation). 첫 PR 에서 고친다.
- 야간 품질 검사는 한국어 모델에서 네 묶음이 실패한다. 긴 미끼 문서에 지는 두 문항, 경계선 문항, 합성 문항이 원인이다. 융합 손잡이 다섯 개를 탐침했고 다섯 묶음을 모두 통과하는 설정은 없었다. 관련성 축척 1.5 가 실패를 둘로 줄인다.
- PR 은 여덟 개로 나눈다. 마지막 전환 PR 전까지는 지금 모델에서 동작이 같다. 검증은 PR 랭킹 게이트가 그대로 통과하는지로 한다(PR 1 의 버그 수정만 예외).
- 사용자가 정할 것은 셋이다. 모델 파일을 어디에 게시할지, 야간 품질 검사 실패를 어떻게 다룰지, 기본값을 어떻게 바꿀지.

## 사용자가 정할 것

### 결정 1. 모델 파일 공급

원본 저장소(revision `fcfc26bf`, 2025-10-16)에는 safetensors 만 있고 ONNX 가 없다. 지금 런타임(transformers.js 4.3.0)은 HuggingFace 저장소에서 `onnx/model_quantized.onnx`(q8)를 받는다. Docker 이미지는 빌드 때 이 파일을 이미지 안에 굽는다(`Dockerfile:97-111`).

- 라이선스: 원본 apache-2.0, 기반 모델 `intfloat/multilingual-e5-small` 은 MIT 다. 재배포에는 라이선스 사본과 변경 사실(ONNX 변환, 동적 int8 양자화) 표시가 필요하다. 원본 저장소에 NOTICE 파일은 없다.
- 측정에 쓴 변환: optimum 2.1.0, onnxruntime 1.32.0, transformers 4.57.6, torch 2.15.0+cpu 로 내보낸 뒤 `quantize_dynamic(QUInt8)`. 결과 `model_quantized.onnx` 118,049,356 바이트, sha256 `7bc8d870e27a2c52…`. transformers.js 로 읽은 출력은 원본과 코사인 0.983 이상이다.
- 제3자 변환본 두 개(`pos090011/…-onnx`, `logan-cha/…-onnx`)는 라이선스 표기가 없고 fp32(470MB)만 있어 q8 로 쓸 수 없다.

| 선택지 | 외부 게시 | 빌드 의존 | 저장소, 패키지 크기 | 재현성 | 새 코드 |
|---|---|---|---|---|---|
| **A. HuggingFace 주인 계정에 변환본 게시, revision 고정 (권고)** | 있음(사용자 승인) | 없음 | 변화 없음 | 변환 스크립트와 sha256 를 저장소에 둔다 | 모델 정의의 repo, revision 두 값 |
| B. 이 저장소 GitHub Release 자산 | 있음(같은 승인 대상) | 없음 | 변화 없음 | A 와 같음 | 내려받기, sha256 확인, 재시도 코드를 새로 쓴다 |
| C. npm 패키지에 포함 | 없음(이미 게시 중) | 없음 | tarball 약 +135MB, 모든 설치가 짊어진다 | 좋음 | 적음 |
| D. git 저장소에 커밋 | 없음 | 없음 | 118MB 파일은 GitHub 100MB 한도를 넘는다(LFS 필요) | 좋음 | 불가 |
| E. 설치나 빌드 때 직접 변환 | 없음 | python, torch, optimum | 변화 없음 | 버전마다 달라진다 | Docker 만 가능, npm 설치는 불가 |

권고는 A 다. 지금 경로(transformers.js 가 HuggingFace 에서 받고 Docker 가 빌드 때 굽는다)를 그대로 쓰고 새 코드가 없다. revision 고정과 sha256 기록으로 남이 파일을 바꾸는 위험을 막는다. A 를 거절하면 B 다.

### 결정 2. 야간 품질 검사

실제 게이트는 `tests/fixtures/search-quality/baselines/ranking-nightly.json` 대비 묶음별 MRR 하락 0.03 이하다(`scripts/lib/quality-baseline.ts:24`). 경계선 문항을 빼지 않는다. 한국어 모델과 보정을 넣은 결과는 다음과 같다.

| 묶음 | 기준선 | 한국어 + 보정 | 차이 | 게이트 | 문항 단위 원인 |
|---|---|---|---|---|---|
| incident_ops | 0.7143 | 0.6531 | -0.061 | 실패 | 한 문항. 「HTTP 서버 에러 처리」에서 긴 미끼 `bench_syn_long_0001` 이 정답을 2위로 민다 |
| procedural | 1.0000 | 0.9167 | -0.083 | 실패 | 한 문항. 「FTS5 마이그레이션 fallback」에서 긴 미끼 `bench_syn_long_0008`(주제만 되풀이하는 문서)이 정답을 2위로 민다. 지금 모델을 뺀 모든 임베딩 변형에서 같다 |
| conceptual | 0.9000 | 0.9063 | +0.006 | 통과 | |
| tag_filter | 0.6574 | 0.5528 | -0.105 | 실패 | 점수 차가 하위 25%(0.0106) 미만이던 경계선 문항 셋이 한두 단계 밀린다 |
| knowledge_update | 0.9167 | 0.8681 | -0.049 | 실패 | 같은 틀의 합성 문항 셋이 서로 밀린다. 「새 값이 옛 값보다 위」 비율 22/24 → 21/24 |

- incident_ops 는 처음 측정에서 0.7245(통과)로 나왔다. 그 실행에서만 벤치 첫 질의의 점수가 다른 모든 실행과 달리 텍스트 전용 수준(0.405)이었다. 같은 설정을 세 번 다시 돌리면 0.6531 로 같다. 첫 질의만 튄 원인은 확인하지 못했다.
- PR 랭킹 게이트(`ranking-pr.json`, 400행)는 재지 않았다. 전환 PR 의 CI 에서 처음 드러난다.
- 기준선 identity 에는 `embedding_provider` 만 있고 모델이 없다(`quality-baseline.ts:380`). 그래서 모델을 바꿔도 같은 기준선과 비교한다. 바꾼 뒤에도 옛 모델 기준선과 비교하게 두면 이후 모든 PR 이 같은 이유로 실패한다. 어느 선택지든 전환 때 기준선을 다시 찍어야 하고, 기준선 다시 찍기는 게이트 변경이다.
- 융합 손잡이로 풀리는지 탐침했다(「융합 재조정」 절). 손잡이 하나로 다섯 묶음을 모두 통과하는 설정은 없었다. 관련성 축척 2.0 → 1.5 가 실패를 넷에서 둘(procedural, tag_filter)로 줄였다.

| 선택지 | 하는 일 | 게이트 변경 | 비용 |
|---|---|---|---|
| 2-A. 게이트 그대로 | 융합 재조정으로 다섯 묶음이 통과할 때까지 전환을 미룬다 | 없음 | 탐침에서 손잡이 하나로는 통과하지 못했다. 측정한 주입 적중 +8.4%p 를 언제 쓸지 모른다. 미끼 한 문항을 뒤집으려고 손잡이를 맞추면 과적합이다 |
| **2-B. 전환 PR 에서 기준선을 새 모델로 다시 찍는다 (권고)** | 관련성 축척 1.5 를 held-out 으로 확인해 통과하면 함께 넣는다. 남는 퇴행 묶음을 문항 단위 원인과 함께 승인받고 `ranking-nightly.json`, `ranking-pr.json` 을 다시 찍는다. identity 에 모델 이름을 더해 다음 모델 교체도 기준선 다시 찍기를 강제한다 | 있음 | 긴 미끼에 지는 성질이 기준선에 들어간다. 축척 1.5 를 넣으면 승인할 퇴행은 procedural(미끼 한 문항)과 tag_filter(경계선 셋) 둘, 안 넣으면 넷이다 |
| 2-C. 미끼 문항을 진단 묶음으로 옮긴다 | 긴 미끼에 지는 두 문항을 게이트 집계에서 뺀다 | 있음(문항 변경) | tag_filter 실패는 남는다. 2-B 와 함께여야 전환이 가능하다 |

권고는 2-B 다. 남는 퇴행은 원인이 문항 단위로 드러났다. tag_filter 는 게이트 해상도 문제(경계선 흔들림)이고, 미끼 두 문항은 검색용 모델이 주제가 같은 긴 글을 높게 치는 성질이다. 주인 데이터의 주 지표(주입 상위 5)는 +8.4%p [+5.0, +11.8](축척 1.5 면 +9.2%p [+5.7, +12.6])로 오른다. knowledge_update 는 「바뀐 지침이 옛 지침보다 먼저 나와야 한다」는 용례와 닿는다. 축척 1.5 에서는 기준선 위로 돌아오지만(0.9375), 전환 뒤 지표 2 로 따로 본다.

### 결정 3. 기본값 전환 방식

- 모델 이름은 빌드 상수다(`embedding-models.ts:14`). 바꾸면 업데이트한 설치의 벡터 검색은 재색인 전까지 옛 행을 전부 거른다. 검색은 텍스트 레인으로만 돈다(#889 동작).
- 재색인은 수동이다(`npm run reindex-embeddings`, `POST /api/v1/maintenance/reindex`). `embedding_reconciliation` 배치는 provider 와 content_hash 만 보고 모델 드리프트는 고치지 않는다(`embedding-reconciliation-batch-job.ts:40-43`).
- `reindex()` 는 기억 전부를 다시 만든다(`embedding-reindex-service.ts:372`). 바뀐 행만 고르는 `reindexByIds()` 가 있다.
- 저장 행은 `(memory_id, embedding_provider, projection_type)` UNIQUE 라 옛 벡터와 새 벡터가 함께 있지 못한다. 재색인은 제자리에서 덮어쓴다.
- 이 PC 에서 13,510건 재임베딩은 혼잡 조건에서 665초(지금 모델은 443초)였다.

| 선택지 | 하는 일 | 업데이트만 한 설치 | 메모리 | 새 코드 |
|---|---|---|---|---|
| **3-A. 빌드 상수 교체 + 자동 이주 (권고)** | 기동 뒤 백그라운드에서 모델이 다른 행만 다시 만든다. 중단되면 다음 기동에 이어서 한다. 설정은 더하지 않는다 | 이주가 끝날 때까지 의미 후보가 차례로 찬다. 손댈 것 없음 | 모델 하나 | 이주 작업(`reindexByIds` 재사용) |
| 3-B. 설정 `EMBEDDING_LOCAL_MODEL` 추가, 한 릴리스 동안 기본 옛 모델 | 주인이 설정으로 먼저 켜고 다음 릴리스에 기본값을 바꾼다 | 3-A 와 같다(한 주 늦게) | 모델 하나. 이미지에는 두 모델을 굽거나(+118MB) 런타임에 받는다 | 설정 키, compose 화이트리스트, 문서, 두 모델 정의 |
| 3-C. 빌드 상수 교체 + 수동 재색인 안내(#889 와 같음) | CHANGELOG 로 재색인을 안내한다 | 재색인 전까지 의미 검색이 없다 | 모델 하나 | 없음 |

권고는 3-A 다. 설치는 주인의 두 곳이고, soak 규칙(머지된 main 을 운영에 먼저 올린다)이 이미 시험 구간을 준다. 3-B 의 설정은 값이 사실상 하나인 손잡이이고 다른 사용자를 가정한 호환 계층이다. 3-C 는 「업데이트만으로 깨지지 않는다」는 수용 기준을 못 채운다.

## 설계

### 모델 정의 한 곳

모델에 따라 달라지는 값은 이 객체에 둔다. 예외는 랭킹 손잡이다. `ranking-weights.toml` 이 단일 원본이라 그대로 두고, 모델 때문에 바꾸면 같은 PR 에 넣어 revert 한 번으로 함께 돌아가게 한다.

```ts
// packages/memento-core/src/shared/config/embedding-models.ts
export type EmbeddingRole = 'query' | 'passage';

export interface LocalEmbeddingModel {
  /** memory_embedding.model 에 저장되는 이름. 벡터 공간의 정체성이다. */
  readonly storedName: string;
  readonly source: { readonly repo: string; readonly revision: string; readonly dtype: 'q8' };
  readonly dimensions: 384;
  readonly prefixes: Readonly<Record<EmbeddingRole, string>>;
  /** 질의-기억 코사인을 지금 척도로 옮기는 1차 변환. 기억끼리 비교에는 쓰지 않는다. */
  readonly queryScoreCalibration: { readonly a: number; readonly b: number };
  /** 기억끼리 비교의 raw 코사인 기준값. */
  readonly memorySimilarity: {
    readonly consolidationCluster: number;
    readonly consolidationMerge: number;
    readonly rememberDedup: number;
    readonly supersedeCandidate: number;
    readonly neighbor: number;
    readonly anchorSlots: { readonly A: number; readonly B: number; readonly C: number };
  };
}

export const LOCAL_EMBEDDING_MODEL: LocalEmbeddingModel = { /* 모델 하나 */ };
```

- 3-A 에서는 모델이 한 번에 하나라 표(map)를 두지 않는다. 되돌리기는 PR revert 다. 3-B 를 고르면 설정 값을 키로 하는 표가 된다.
- 지금 모델의 값은 접두 `''`, 보정 `{ a: 1, b: 0 }`, 기준값은 지금 상수 그대로다. 그래서 PR 3~5 는 동작이 같다.
- `storedName` 은 HuggingFace 저장소 이름에서 떼어 내지 않는다. 결정 1 에서 파일 위치가 주인 계정으로 바뀌어도 저장 이름은 `multilingual-e5-small-ko-v2` 로 둔다. 위치와 정체성을 나눈다.
- `getEmbeddingModelFilter('minilm')` 는 `storedName` 을 돌려준다. 벡터 검색이 같은 모델 행만 비교하는 지금 규칙(#889)은 그대로다.

### 이름: 바꾸는 것과 남기는 것

| 대상 | 결정 | 이유 |
|---|---|---|
| 저장값 `memory_embedding.embedding_provider = 'minilm'` | 남긴다 | 바꾸려면 모든 행을 갱신하고 vec 트리거를 다시 써야 한다. 얻는 것이 없다 |
| vec 테이블 `memory_item_vec_minilm`, 트리거(마이그레이션 012, 053), `vec-schema.ts` 허용 목록 | 남긴다 | 스키마 이름이다. vec0 가상 테이블 이름을 바꾸면 테이블을 다시 만든다 |
| 공개 설정 값 `EMBEDDING_PROVIDER=minilm`, recall `provider_filter` 의 `minilm`, 관리 API `provider=minilm` | 남긴다. 별칭을 더하지 않는다 | 설치의 `.env` 와 클라이언트가 이 값을 보낸다. #1687 처럼 정식 값을 `local` 로 바꾸고 옛 값을 별칭으로 받을 수도 있지만, 이름이 둘이 되는 비용에 비해 얻는 것이 작다. 원하면 따로 정한다 |
| 코드 상수 `MINILM_MODEL_ID`, `MINILM_MODEL_NAME` | `LOCAL_EMBEDDING_MODEL` 하나로 바꾼다 | 모델과 이름이 어긋난다 |
| 클래스 `MiniLMEmbeddingService`, 파일 `minilm-embedding-service.ts`, `globalThis.__minilmModelLoadWarningShown`, 로그 「MiniLM 모델 로딩」 | `LocalEmbeddingService`, `local-embedding-service.ts` 등 모델 중립 이름 | 같음 |
| 캐시 키 `generateEmbeddingCacheKey('minilm', text)` | `storedName` 과 역할을 키에 넣는다 | 같은 글이라도 질의 벡터와 기억 벡터가 다르다 |
| `Dockerfile:103` warmup, `scripts/docker-smoke.mjs:41` 의 모델 id 하드코딩 | 빌드된 모델 정의를 읽는다 | 모델 id 가 세 곳에 있다 |
| `ensure-memory-embedding-metadata-defaults.ts:15` 의 `model LIKE '%minilm%'` | `storedName` 도 같은 분기로 받는다 | 새 이름에 minilm 이 없다. provider 가 빈 옛 행 보정에만 쓰여 영향은 작다 |
| CI 캐시 키 `hf-minilm-`, 단계 「MiniLM Korean embedding quality」, `minilm-korean-quality.spec.ts` | 모델 중립 이름. spec 기대값은 전환 PR 에서 새 모델로 | 같음 |
| `window-embedding-write.ts:24-32` `WINDOW_CANDIDATE_MIN_CHARS = 800` 와 주석 | 새 모델로 2창 최소 길이를 다시 재고 주석의 모델 이름을 고친다 | 주석의 ponytail 이 모델이 바뀌면 다시 재라고 적었다 |

새 용어는 GLOSSARY 와 대조했다. 겹치는 항목은 없다. 전환 PR 에서 넣을 항목은 다음과 같다.

- **Local embedding model (로컬 임베딩 모델)**: 임베딩 제공자 값 `minilm` 뒤에서 도는 모델 하나. 저장 이름은 `memory_embedding.model` 이다. `minilm` 은 역사적 이름이다. _Avoid_: MiniLM(모델을 가리킬 때)
- **Query vector, passage vector (질의 벡터, 기억 벡터)**: 같은 모델이 역할 접두를 달리 붙여 만든 벡터. 저장하는 것은 기억 벡터뿐이다.
- **Query score calibration (질의 점수 보정)**: 질의-기억 코사인을 검색 상수가 맞춰진 척도로 옮기는 1차 변환. 기억끼리 비교에는 쓰지 않는다.
- **Model migration (모델 이주)**: 저장 모델이 지금 모델과 다른 행을 다시 만드는 일.

### 접두와 창 크기

`EmbeddingServiceInterface.generateEmbedding(text)` 하나에 접두를 붙이면 기억끼리 비교 경로가 모두 질의 벡터로 바뀐다. 그래서 진입점을 나눈다. `generateEmbedding` 은 기억 벡터(passage)를 만들고, 질의 경로만 `embedQuery` 를 부른다.

| 역할 | 호출처 |
|---|---|
| 질의 | `hybrid-vector-search-executor.ts:443`, `vector-search.service.ts:76`, `anchor/query-filter-service.ts:65`, `memory-embedding-service.ts:458`(`searchBySimilarity`, 저장소 안 호출처 없음) |
| 기억 | 저장(`memory-embedding-service.ts:378`), 창(`:207`), Sleep consolidation 요약(`sleep-consolidation-service.ts:132`), 라벨 뗀 재임베딩(`:527`), remember 중복 판정(`remember-tool-near-duplicate.ts:161`), 관계 후보 재정렬(`embedding-candidate-filter.ts:33`), `migrate-embeddings-tool.ts:113`, openai, gemini 의 로컬 fallback |

- `embedding-candidate-filter.ts:38` 은 기억 본문으로 `searchSimilar` 를 부른다. `searchSimilar` 는 질의 진입점이라 여기서는 기억 벡터를 쓰도록 바꾼다.
- 기억끼리 비교에 `query: ` 를 붙인 벡터를 따로 두지 않는다. 측정에서 최근접 이웃 상위 5 의 81% 가 기억 벡터와 같았고, 기억마다 벡터를 하나 더 둘 근거가 나오지 않았다.
- 창 크기는 510 에서 그 역할의 접두 토큰 수를 뺀 값이다. 모델을 읽을 때 토크나이저로 센다(`passage: ` 는 3토큰이라 507). 상수로 두지 않는다.
- 지금 모델은 두 접두가 모두 빈 문자열이라 PR 4 는 동작이 같다.

### 검색 점수 보정

결정은 측정한 1차 변환을 그대로 넣는 쪽이다. `s' = clamp01(a × s + b)`, 한국어 모델은 a=1.9943, b=-0.6838 이다.

| 기준 | 1차 변환을 넣는다 | 검색 상수를 새 분포에 맞게 고친다 |
|---|---|---|
| 측정 | 했다. 주입 상위 5 +8.4%p [+5.0, +11.8] | 하지 않았다 |
| 모델별 상수 | 2개, 모델 정의 안 | 0.38, 0.5, high_vector 0.8, 관련성 축척 2.0, 융합 가중치, 적응형 가중 문턱. `constants.ts` 와 `ranking-weights.toml` 에 흩어진 10여 개 |
| 다음 모델 교체 | 보정 스크립트로 a, b 만 다시 구한다 | 위 상수를 다시 맞춘다 |

- 적용 자리는 측정 패치와 같은 두 곳이다. `hybrid-vector-search-executor.ts` 의 길이 감쇠 직전과 `hybrid-vector-backfill.ts:92` 다. 둘 다 모델 정의의 보정을 쓰는 함수 하나를 부른다.
- 불변식. **보정은 질의-기억 점수에만 쓴다. 기억끼리 비교는 raw 코사인이다.** `cosineDistanceToSimilarity`(#806 의 단일 변환)에는 넣지 않는다. 그 함수는 이웃 기억, 중복 판정, 앵커도 쓴다.
- 근거는 포화다. 보정값이 1.0 에 닿는 raw 코사인은 0.844 다. 질의-기억은 262문항 가운데 최고 점수가 0.844 를 넘는 문항이 0개다(최고 점수 중앙값 0.684). 기억끼리는 최근접 이웃 중앙값이 0.846 이라 절반이 1.0 동점이 된다. 그러면 이웃 정렬, supersede 상위 3, 합침 대상 고르기가 무너진다.
- a, b 는 정답 정보를 쓰지 않는다. 262문항 × 기억 전부의 점수 분포(평균, 표준편차)만 맞춘다. 야간 품질 검사에도 같은 값을 그대로 썼다.
- 융합 밖에서 질의-기억 점수를 쓰는 곳(`anchor/query-filter-service.ts:89`, `vector-search.service.ts` 일반 경로의 `VECTOR_SEARCH_THRESHOLD`)는 구현 PR 에서 운영 경로인지 확인한다. 운영 경로면 같은 함수를 부른다.
- `search-ranking-relevance.ts:20, :62` 의 임베딩 관련성 분기는 값을 넘기는 호출처가 없다. 보정 대상이 아니라 지울 대상이다.

### 기억끼리 기준값

출발점은 분위 맞춤 값이다. 지금 기준값이 지금 모델의 무작위 쌍 분포에서 차지하는 분위와 같은 분위의 한국어 모델 값을 쓴다. 1차 변환을 거꾸로 돌린 값도 0.6~0.8 에서 0.005 이내로 같다. 이 일치는 출발점이 그럴듯하다는 방증일 뿐 기준값을 정하는 메커니즘은 아니다.

| 기능 | 위치 | 지금 | 출발점 | 데이터 변경 | 확인 |
|---|---|---|---|---|---|
| Sleep consolidation 군집 | `clustering-service.ts:19, 54`(env `CONSOLIDATION_SIMILARITY_THRESHOLD`) | 0.65 | 0.668 | 바꿈 | agent_panel |
| 요약 합침 대상 | `sleep-consolidation-service.ts:55, 149`(env `CONSOLIDATION_MERGE_SIMILARITY_THRESHOLD`) | 0.85 | 0.785 | 바꿈 | agent_panel |
| remember 중복 판정과 자동 합침 | `shared/config/index.ts:255`(env `MEMENTO_REMEMBER_DEDUP_THRESHOLD`) | 0.85 | 0.785 | 조건 맞으면 바꿈 | agent_panel |
| 앵커 다시 걸기 | `anchor-reanchor-service.ts:156` | 슬롯 × 0.8 | 없음, 지운다 | 바꿈 | 운영 호출처 0 |
| supersede 후보 | `supersede-candidate-service.ts:27` | 0.65 | 0.668 | 후보 행만 씀(대체는 LLM 판정 뒤) | 규모 비교 |
| 이웃 기억 | `memory-neighbor-service.ts:138, 332` | 0.8 | 0.742 | 읽기만 | 규모 비교 |
| 앵커 슬롯 A, B, C | `anchor-manager.ts:30-32` 와 `anchor-search-service.ts:401-403`(같은 값 두 벌) | 0.8, 0.6, 0.4 | 0.742, 0.649, 0.566 | 읽기만 | 규모 비교 |
| 하이브리드 벡터 임계, high_vector 가중 | `constants.ts:117, 139` | 0.38, 0.8 | 그대로 | 읽기만 | 보정 척도라 흡수 |

사본에서 출발점 값으로 잰 규모는 다음과 같다(raw 저장 벡터 기준, 라벨 떼기와 LLM 판정 전).

| 기능 | 지금 모델 | 한국어 모델, 출발점 |
|---|---|---|
| Sleep consolidation 군집 수, 군집에 든 episodic, 최대 크기 | 93, 775, 124 | 153, 964, 56 |
| supersede 후보 쌍(상한 전) | 808 | 918 |
| 이웃이 하나 이상인 기억, 기억당 평균 이웃 | 58%, 60 | 96%, 75 |

- env 덮어쓰기 세 개는 그대로 받는다. 값은 그 모델의 raw 척도라는 점을 `env.example` 과 CHANGELOG 에 적는다. 운영 `.env` 가 이 셋을 덮어쓰는지는 이 설계에서 확인하지 않았다(`.env` 불가침). 전환 전에 마름이 확인한다. 덮어쓴 값이 지금 기본값과 같은 0.65 라면 한국어 모델에서 Sleep consolidation 이 131, 1,014, 64 가 되어 지금의 1.3배다.

agent_panel 확인 절차(데이터를 바꾸는 세 곳, 전환 PR 전에 한 번).

1. 운영 DB 사본에서 쌍을 뽑는다. 기능마다 한국어 모델 raw 코사인이 [출발점, 출발점+0.05) 인 쌍 40개, 대조로 지금 모델 raw 코사인이 [지금 기준값, +0.05) 인 쌍 40개를 뽑는다. 요약 합침은 오프라인에 요약이 없어 semantic 끼리 쌍으로 대신한다.
2. 섞고 모델과 점수를 가린다. 판정자는 서로 다른 모델 머슴 2명(머슴5 Claude Sonnet, 머슴6 K-EXAONE)이다. 각자 「같은 주제로 합쳐도 된다 / 아니다 / 모르겠다」를 단다.
3. 둘이 같은 답을 단 쌍만 센다. 다르거나 모르겠다면 보류로 뺀다.
4. 규칙(실행 전 기록). 한국어 띠의 「합쳐도 된다」 비율이 대조 띠보다 0.10 넘게 낮지 않으면 출발점을 쓴다. 낮으면 출발점을 0.02 올려 한 번 더 판정한다. 두 번째도 낮으면 마름에게 올린다.
5. 판정 원문은 저장소 밖에 두고 PR 에는 비율만 적는다. 판정자의 모델 호출이 외부 API 라면 기억 원문을 보내는 일이라 마름이 먼저 확인한다.

### 융합 재조정

한국어 모델은 의미 후보를 85% 잡지만 주입 상위 5 는 61% 다. 순위를 막는 곳이 의미 후보에서 융합으로 옮겨 갔다.

- 범위. `config/ranking-weights.toml` 의 손잡이(alpha, beta, gamma, 관련성, 최근성, 중요도 축척, FTS 온도)와 주입 경로의 벡터 0.7 / 텍스트 0.3(`knowledge-context-bundle-builder.ts:283`, 하드코딩)이다. 길이 감쇠는 #921 에서 따로 쟀으니 뺀다.
- 시점. 전환 PR 이 운영에서 soak 한 뒤 별도 이슈로 한다. 전환과 섞으면 어느 쪽이 효과인지 가를 수 없다.
- 방법. `npm run ranking:preview` 로 벤치마크 dev 질의만 보고(#1399, held-out 은 마지막에 한 번), 주입 하네스 262문항은 기억 단위로 반을 나눠 한쪽에서 고르고 다른 쪽에서 확인한다. 격자는 실행 전에 적는다.
- 판정 규칙. 지침 기억 검색 측정 때 미리 정한 규칙(저장소 밖 측정 설계)을 그대로 쓴다. 주 지표는 주입 상위 5 다. 전환 상태 대비 95% 구간 하한이 0 을 넘고 야간 품질 검사 퇴행이 없으면 채택한다. 부담이 작은 손잡이부터 보고, 더 부담 큰 쪽이 5%p 넘게 낫지 않으면 멈춘다.

탐침(탐색, 채택 근거 아님). 결정 2 를 위해 `ranking-weights.toml` 손잡이 하나씩 다섯 개를 실행 전에 적고 돌렸다. 벤치(엔진 기본 가중치)와 주입(0.7 / 0.3 고정)을 함께 움직이는 손잡이는 이 파일뿐이다. 모두 한국어 모델과 보정을 넣은 상태이고 게이트는 껐다.

| 변형 | incident_ops | procedural | conceptual | tag_filter | knowledge_update | 게이트 실패 | 주입 상위 5 | 현재 대비 (95%) |
|---|---|---|---|---|---|---|---|---|
| 기준선(지금 모델) | 0.7143 | 1.0000 | 0.9000 | 0.6574 | 0.9167 | | 52.7% | |
| P0 그대로 | 0.6531 | 0.9167 | 0.9063 | 0.5528 | 0.8681 | 4 | 61.1% | +8.4 [+5.0, +11.8] |
| P1 최근성 축척 0.30 → 0.40 | 0.6531 | 0.9167 | 0.9063 | 0.5528 | 0.9097 | 3 | 61.1% | +8.4 [+5.0, +11.8] |
| P2 관련성 축척 2.0 → 1.5 | 0.7619 | 0.9167 | 0.9063 | 0.5667 | 0.9375 | 2 | 61.8% | +9.2 [+5.7, +12.6] |
| P3 관련성 축척 2.0 → 2.2 | 0.6518 | 0.8750 | 0.8433 | 0.5167 | 0.8264 | 5 | 60.3% | +7.6 [+4.2, +11.5] |
| P4 FTS 온도 10 → 8 | 0.6513 | 0.8750 | 0.8424 | 0.5111 | 0.8229 | 5 | 60.3% | +7.6 [+4.2, +11.5] |
| P5 alpha 0.50, beta 0.175, gamma 0.175 | 0.6558 | 0.9167 | 0.9059 | 0.5667 | 0.8681 | 4 | 61.1% | +8.4 [+5.0, +11.8] |

- 미끼 문항(procedural)은 어느 손잡이에서도 그대로다. tag_filter 도 어느 설정에서나 0.03 을 넘게 떨어진다.
- P2 는 incident_ops 의 미끼 문항과 knowledge_update 를 기준선 위로 되돌린다. 보정한 점수의 폭이 지금 모델과 달라 축척 2.0 이 과하다는 해석과 맞는다. 다만 벤치 전체 질의로 고른 값이라 채택하려면 `benchmark-v3/split.json` held-out 과 주입 하네스 반분 확인이 따로 필요하다. 확인되면 전환 PR 에 넣는다.
- 탐침의 주입 상위 5 P0 대비 차이는 P2 +0.8%p [0.0, +1.9], P3 와 P4 -0.8%p [-1.9, 0.0], 나머지 0 이다.

### 전환 구간과 모델 이주

3-A 를 기준으로 쓴다.

- 이주 작업. 기동 뒤 백그라운드에서 `diagnose()` 의 모델 드리프트 행(native 의 `model` 이 `storedName` 과 다른 기억)과 임베딩이 없는 기억만 골라 `reindexByIds()` 로 다시 만든다. 100건씩 처리하고 사이마다 이벤트 루프를 양보한다. 다시 만든 행은 더 이상 드리프트가 아니어서, 중단되면 다음 기동이 남은 행부터 한다.
- `embedding_reconciliation` 도 모델 드리프트를 문제로 센다. 이주가 멈춰도 하루 1,000건씩 따라잡는다.
- 이주 중 벡터 검색은 지금 모델 행만 비교한다(#889 의 모델 필터). 의미 후보가 이주한 만큼만 찬다. 이주 전 행은 KNN 자리를 차지했다가 걸러져 의미 레인이 덜 차기도 한다. 틀린 결과가 아니라 적은 결과다.
- 이주 중 기억끼리 기능은 PR 1 뒤로 같은 모델 벡터만 비교한다. Sleep consolidation 배치는 드리프트가 0 이 될 때까지 건너뛴다. 일부만 이주한 상태에서 군집을 만들면 같은 주제가 두 군집으로 갈린다.
- 진행은 관리 화면의 임베딩 상태(`modelDriftCount`)와 `npm run reindex-embeddings -- --provider minilm --dry-run` 으로 본다. 0 이면 끝이다.

운영 절차(마름이 사용자 지시 뒤에 한다).

1. 사본 리허설. 운영 DB 사본에서 이주 시간, 이주 뒤 규모 표, 하네스 주입 상위 5 를 잰다.
2. `npm run db:backup` 으로 DB 전체를 백업한다.
3. 기존 배포 절차로 올린다.
4. `modelDriftCount` 가 0 이 될 때까지 본다. 이 PC 기준 약 11분이다. 운영 컨테이너의 CPU 한도는 확인하지 않았다.
5. `/health`, 기억 수, 에러 로그, `memory_injection` 결과를 확인한다.

되돌리기.

- 기본은 전환 PR revert 와 재배포다. 같은 이주가 거꾸로 돌아 지금 모델 벡터를 다시 만든다(측정 443초).
- Sleep consolidation, 합침이 사고를 냈다면 2번의 DB 백업을 복원한다. 백업 뒤 쓴 기억은 잃는다.
- `scripts/backup-embeddings.js` 는 쓰지 않는다. provider 와 projection_type 을 담지 않고 복원 경로가 없다. 지운다.

## 읽어서 메운 미지

1. **앵커 다시 걸기의 운영 호출처는 0이다.** `AnchorReanchorService.autoReanchor`, `checkAndAutoReanchor` 는 `AnchorSearchService` 의 감싸는 메서드(`anchor-search-service.ts:420-490`)에서만 불리고, 그 메서드를 부르는 곳이 저장소에 없다. 테스트 둘이 `calculateReanchorScore`, `analyzeAnchorUsage` 를 직접 부를 뿐이다. 기준값을 다시 맞추지 않고 지운다(378줄).
2. **이웃 기억 서비스는 창 행을 집는다.** `memory-neighbor-service.ts:170-180`, `:345-352` 는 `ORDER BY created_at DESC LIMIT 1` 로 기억의 아무 행이나 고른다. projection_type, provider, model 조건이 없다. 창 행은 native 뒤에 쓰이고 `created_at` 이 초 단위다. 사본에서 같은 SQL 로 재면 창 행이 있는 530건 가운데 111건(21%)이 본문 일부의 창 벡터로 이웃을 찾는다. 같은 쿼리가 `anchor-cache-service.ts:91-100` 에도 있다. 전환 구간에는 옛 모델 벡터로 새 모델 인덱스를 친다. 교체와 무관하게 지금도 틀린 동작이라 **별도 이슈 후보**다.
3. **Sleep consolidation 의 라벨 뗀 재임베딩(#1225)은 새 모델을 탄다.** `useLabelFreeEmbeddings`(`sleep-consolidation-service.ts:508-540`)는 `generateEmbedding` 을 부르므로 진입점 분리 뒤 기억 벡터가 된다. 문제는 비교 대상이다. `loadEmbeddingsMap`(`consolidation-repository.ts:186-200`)은 provider 만 걸고 model 을 걸지 않는다. 재임베딩 결과도 provider 와 길이만 확인한다. 전환 구간에 옛 모델과 새 모델 벡터를 한 군집에서 비교한다. **별도 이슈 후보**다.
4. 그 밖에 확인한 것. 관계 후보 KNN(`remember-tool-db-helpers.ts:99-150`), 요약 합침 대상(`findSemanticsByOwner`), supersede(묶음 키에 모델 포함), remember 중복 판정(벡터 검색의 모델 필터)은 같은 모델 벡터만 비교한다.

## PR 나누기

마지막 PR 전까지는 지금 모델에서 동작이 같다. PR 랭킹 게이트(`search-quality-pr.yml`)가 임베딩, 검색, 설정 경로를 바꾸는 PR 마다 돌아 이를 확인한다.

| PR | 내용 | 지금 모델에서 동작 | risk 예상 | 검증 |
|---|---|---|---|---|
| 1 | 저장 벡터 읽기를 함수 하나로 모은다(native, provider, model 조건). 이웃 기억 두 곳, 앵커 캐시, `loadEmbeddingsMap`, #1225 재임베딩 확인이 부른다. 별도 이슈로 연다 | 바뀐다(버그 수정). 긴 기억 21% 의 이웃 질의 벡터가 native 가 된다 | medium | 창 행과 다른 모델 행이 있는 기억에서 현재 모델 native 만 쓰는 단위 테스트 |
| 2 | 지우기. `AnchorReanchorService` 와 감싸는 메서드 넷과 spec, 관련성 임베딩 분기, `backup-embeddings.js` 와 `backup:embeddings` 스크립트와 `scripts-index.md` 언급 | 같음 | low | 남은 언급 0, knip |
| 3 | 모델 정의 한 곳과 이름 정리(위 표). Dockerfile warmup 과 smoke 가 정의를 읽는다 | 같음 | medium(파일 많음) | PR 랭킹 게이트, docker smoke |
| 4 | 질의 진입점 `embedQuery` 분리, 창 크기를 접두 토큰으로 계산, 캐시 키에 역할 | 같음(접두 빈 문자열) | medium | 역할별 캐시가 갈리는 단위 테스트, PR 랭킹 게이트 |
| 5 | 기준값과 보정이 모델 정의를 읽는다(기억끼리 기준값 여섯, 보정 두 자리, 앵커 슬롯 중복 제거) | 같음(값 그대로, 보정 1, 0) | medium | PR 랭킹 게이트, 기능별 기존 테스트 |
| 6 | 모델 이주 작업, reconciliation 의 모델 드리프트, 이주 중 Sleep consolidation 건너뛰기 | 같음(드리프트 0) | medium | 모델 이름을 바꾼 사본에서 이주가 중단 뒤 이어서 끝나는 통합 테스트 |
| 7 | 변환 스크립트(`scripts/export-local-embedding-onnx.py`)와 sha256, 버전 기록. 게시는 결정 1 승인 뒤 PR 밖에서 | 같음 | low | 스크립트로 다시 만든 파일의 sha256 일치 |
| 8 | 전환. 모델 정의를 한국어 모델로(접두, 보정, 패널로 확인한 기준값), held-out 으로 확인된 관련성 축척, 기준선 다시 찍기와 identity 의 모델(결정 2), `minilm-korean-quality.spec.ts` 기대값, 문서 | 바뀐다 | high(사용자 승인) | 하네스 주입 상위 5 구간 하한 > 0, 사본 규모 표, 야간과 PR 게이트, 컨테이너 메모리 1GiB 안 |

- 순서는 1 → 2 → 3 → 4 → 5 → 6 이다. 같은 파일(`sleep-consolidation-service.ts`, `embedding-models.ts`)을 여러 PR 이 건드려 차례로 간다. 7 은 언제든 된다. agent_panel 판정은 7 뒤, 8 앞이다.
- 융합 재조정은 8 이 운영에서 soak 한 뒤 별도 이슈다.

## 관리 부담

지우는 것을 먼저 본다.

- 지운다. `anchor-reanchor-service.ts`(378줄)와 감싸는 메서드 넷, 관련성 임베딩 분기, `backup-embeddings.js`.
- 하나로 합친다. 저장 벡터 읽기 SQL 네 벌, 앵커 슬롯 기준값 두 벌, 모델 id 하드코딩 세 곳(상수, Dockerfile, smoke), `MINILM_MODEL_ID` 와 `MINILM_MODEL_NAME`.
- 더한다. 모델 정의 필드, 질의 진입점 하나, 이주 작업(기존 `reindexByIds` 재사용), 변환 스크립트.
- 다음 모델 교체는 모델 정의 하나와 보정 계수, agent_panel 판정, 기준선 다시 찍기로 끝난다.

## 문서

전환 PR(8)에서 함께 고친다. PR 1~7 은 각자 바꾼 이름의 언급만 고친다.

- `docs/guides/{ko,en}/embedding-configuration.md`(기본 모델, 모델 일관성, 재색인 절을 모델 이주로), `embedding-service-guide.md`, `user-manual.md`
- `docs/reference/ko/embedding-provider-issues.md`, `docs/api/ko/embedding-api-reference.md`, `docs/architecture/ko/arc42.md`, `c4/*`
- `docs/agents/search-ranking.md`(질의 점수 보정 절), `docs/agents/commands.md`(이주 확인과 되돌리기)
- `AGENTS.md`(모델 언급 두 곳), `env.example`(기준값 env 세 개가 모델 척도라는 주석)
- CHANGELOG `[Unreleased]`, GLOSSARY(위 네 항목)
- `docs/operations/ko/scripts-index.md`(`backup:embeddings` 줄 삭제, PR 2)
- 남은 언급 확인. `git grep -i minilm` 이 저장값(provider 값, vec 테이블, 마이그레이션)과 CHANGELOG 이력에만 남는다

## 대안

- **블루/그린.** 새 provider 값과 새 vec 테이블에 새 벡터를 쌓고 한 번에 넘긴다. 되돌리기가 즉시다. provider 열거 10여 곳, vec 테이블과 트리거 마이그레이션(스키마 변경), 이주 중 저장 공간 두 배가 든다. 얻는 것은 되돌리기 8분 단축이다. 기각.
- **보정을 `cosineDistanceToSimilarity` 에 넣어 모든 유사도를 한 척도로.** 기억끼리 최근접 이웃의 절반이 1.0 으로 포화한다. 기각.
- **검색 상수를 raw 척도에서 다시 맞추기.** 측정하지 않았고 모델별 상수가 10여 개가 된다. 기각.
- **기억끼리 비교용 `query: ` 벡터를 따로 저장.** 벡터가 두 배이고 이웃 겹침 81% 라 근거가 없다. 기각.
- **multilingual-e5-small.** 주입 상위 5 는 같다(짝 비교 -0.8%p [-1.9, 0.0]). 분포가 0.85 근처에 몰려 기준값을 0.85~0.95 폭에서 다뤄야 하고, 기준값 그대로면 Sleep consolidation 이 1,067건 중 1,064건을 한 군집으로 합친다. 사용자가 한국어 모델로 정했다.
- **두 모델 동시 상주(검색용과 비교용).** 메모리가 약 +340MB 라 운영 1GiB 한도에 닿는다. 범위 밖.

## 위험

| 위험 | PR | 보는 것 |
|---|---|---|
| 이주 중 CPU. 기동 직후 CPU 급등과 겹친다 | 6, 8 | 이주 속도와 컨테이너 CPU. 운영 CPU 한도는 모른다 |
| 패널을 통과해도 Sleep consolidation 규모가 1.2~1.6배 | 8 | 전환 뒤 첫 배치의 군집 수와 크기 |
| 관련성 축척 1.5 가 held-out 에서 확인되지 않으면 knowledge_update 한 문항 하락이 실제 지침 갱신에서 나타난다 | 8 | 지표 2(주입 적중), 지침 반복 수 |
| PR 랭킹 게이트(400행)와 perf-smoke(p95 2배 여유)는 재지 않았다. 질의 지연 중앙값은 4.2ms → 6.4ms 다 | 8 | 전환 PR 의 CI |
| 원본 모델 저장소가 바뀌거나 사라진다 | 7 | revision 고정, 게시본 sha256 |
| 측정이 주인 한 사람의 기억과 생성한 질문(실제 질문 8건)에 기댄다 | 8 | 전환 뒤 지표 2 |

## 참고

- 이슈 [#1729](https://github.com/jee1/memento/issues/1729), [#889](https://github.com/jee1/memento/issues/889), [#1225](https://github.com/jee1/memento/issues/1225), [#806](https://github.com/jee1/memento/issues/806), [#1687](https://github.com/jee1/memento/issues/1687), [#1399](https://github.com/jee1/memento/issues/1399)
- [임베딩 설정 가이드](../guides/ko/embedding-configuration.md), [검색 랭킹 공식](../agents/search-ranking.md), [GLOSSARY](../../GLOSSARY.md)
- 원본 모델 카드 [dragonkue/multilingual-e5-small-ko-v2](https://huggingface.co/dragonkue/multilingual-e5-small-ko-v2), 기반 모델 [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
