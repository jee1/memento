# ADR: 로컬 임베딩 모델을 한국어 검색용 e5-small-ko-v2 로 바꾼다 (이슈 #1729)

- 상태: Proposed. 사용자 결정 3건 반영(2026-11-15). 결정 1 의 패키지 배치(C 와 C')는 사용자 확인 중. 설계 리뷰 1차(머슴5) 반영
- 날짜: 2026-11-15
- 이슈: https://github.com/jee1/memento/issues/1729
- 관련: #1731(이웃 기억과 앵커 캐시의 창 벡터), #1732(Sleep consolidation 벡터 읽기의 모델 필터), #889(모델 일관성), #1112(창 벡터), #1225(라벨 뗀 재임베딩), #806(유사도 변환 단일 원본), #1180(관련성 축척), #1399(랭킹 손잡이 도구)

측정은 운영 DB 사본(기억 13,510건)과 질문 262개로 했다. 하네스와 원자료는 기억 원문을 담고 있어 저장소 밖에 둔다. 이 문서에는 집계만 적는다.

## 요약

- 모델은 한국어 검색용 `dragonkue/multilingual-e5-small-ko-v2`(384차원)로 바꾼다. 저장 공간과 스키마는 그대로다.
- 모델 파일은 npm 으로 공급한다(결정 1). 앱 패키지에 넣는 C 와 모델 전용 패키지를 따로 두는 C' 를 비교해 올렸고 사용자가 고른다. 어느 쪽이든 변환은 고정 버전 스크립트로 하고 sha256 으로 대조한다. 같은 기계에서 세 번 변환해 해시가 같았다.
- 기존 모델 파일 경로(HuggingFace 원격 내려받기)는 전환 PR 에서 지운다.
- 모델에 따라 달라지는 값은 `embedding-models.ts` 의 모델 정의 하나에 모은다.
- 질의는 `query: `, 기억은 `passage: ` 를 붙인다. 질의 진입점 `embedQuery` 를 따로 둔다. 기억끼리 비교는 저장한 기억 벡터를 그대로 쓴다.
- 검색 점수는 측정한 1차 변환(a=1.9943, b=-0.6838)으로 지금 척도에 옮긴다(질의 점수 사상). 이 변환은 질의 벡터를 가진 호출처에서만 건다. 기억끼리 비교는 raw 코사인이다.
- 이슈가 꼽은 기준값 8곳 가운데 둘(검색 임계 0.38, high_vector 0.8)은 사상이 흡수해 그대로 둔다. 나머지 여섯은 기억끼리 raw 코사인 기준값이라 분위 맞춤 값에서 시작하고, 데이터를 바꾸는 셋은 agent_panel 판정으로 확인한다. 앵커 다시 걸기는 운영 호출처가 없어 지운다.
- 지금 코드는 전환 구간에 옛 모델 벡터와 새 모델 벡터를 섞어 비교하는 곳이 다섯이다(이웃 기억, 앵커 캐시, Sleep consolidation, 검색 backfill, fallback 벡터 검색). 전환 전에 고친다.
- 야간 품질 검사는 한국어 모델에서 네 묶음이 실패한다. 전환 PR 에서 기준선을 다시 찍는다(결정 2). 그 전에 PR 범위 게이트를 먼저 재고 첫 질의가 어느 제공자로 갔는지 기록한다.
- 모델 이주는 새 작업을 만들지 않고 `embedding_reconciliation` 을 넓혀서 한다(결정 3, 마름 판정). 설정 키를 더하지 않는다. 기동 직후에는 1,000건 실행을 잇달아 돌려 후보가 0 이 될 때까지 이주한다.
- PR 은 여덟 개로 나눈다. PR 2~7 은 지금 모델에서 동작이 같고, 각 PR 이 무엇으로 같음을 보이는지 표에 적는다. PR 1 은 버그 수정이라 동작이 바뀐다.

## 용어

이 문서에서 쓰는 저장소 밖 용어와 줄임말이다. 저장소 용어는 [GLOSSARY](../../GLOSSARY.md) 를 따른다.

- **agent_panel**: 사람 판정을 대신하는 블라인드 교차 판정. 서로 다른 모델 에이전트 둘이 따로 판정하고 둘이 같은 답만 센다. 사람 정답이라고 부르지 않는다.
- **마름, 머슴**: 이 저장소를 관리하는 주 에이전트(마름)와 일을 받아 하는 작업 에이전트(머슴). 머슴5 는 Claude Sonnet, 머슴6 은 K-EXAONE 이다.
- **주입 상위 5**: `memory_injection` 이 싣는 상위 5건에 정답 기억이 드는 비율. 이 교체의 주 지표다.
- **지표 2**: `docs/DIRECTION.md` 의 세 지표 중 「주입 적중」.
- **하네스**: 운영 커밋의 엔진을 DB 사본에 붙여 질문 262개로 주입 상위 5 를 재는 저장소 밖 측정 도구. 운영 서비스와 같은 전처리(앞뒤 공백 제거, 소문자, 공백 하나로)와 창 규칙(510토큰 창, 창 벡터 평균 뒤 재정규화, 800자 이상이면 창 행 추가)으로 기억 벡터를 만들었다. 질의 벡터는 운영 서비스 코드에 모델과 접두만 바꾼 측정 패치로 만들었다.
- **native 행, 창 행**: `memory_embedding` 의 `projection_type`. native 는 기억 하나의 대표 벡터(창 벡터 평균), 창 행(`window:N`)은 긴 기억의 510토큰 조각 벡터다(#1112).
- **기억끼리 비교**: 질의 없이 저장한 기억 벡터 둘을 비교하는 기능(Sleep consolidation 군집, 요약 합침, supersede 후보, 이웃 기억, 앵커, remember 중복 판정).

## 결정

| 결정 | 고른 것 | 고르지 않은 것 |
|---|---|---|
| 1. 모델 파일 공급 | npm 으로 공급한다(사용자). 앱 패키지에 넣을지(C) 모델 전용 패키지로 둘지(C')는 사용자 확인 중 | HuggingFace 주인 계정 게시, GitHub Release 자산, git 커밋(118MB 는 GitHub 100MB 한도 초과), 설치 때 변환(npm 설치에 python, torch 필요) |
| 2. 야간 품질 검사 | 전환 PR 에서 기준선을 새 모델로 다시 찍고 identity 에 모델 이름을 더한다(사용자). 다시 찍기 전에 PR 범위 게이트를 먼저 잰다(마름) | 게이트 그대로(탐침에서 손잡이 하나로는 통과하지 못해 전환이 무기한 밀린다), 미끼 문항 빼기(tag_filter 실패가 남는다) |
| 3. 기본값 전환 | 빌드 상수를 바꾸고 기동 뒤 자동으로 이주한다(사용자). 이주는 `embedding_reconciliation` 확장으로 하고 설정 키를 더하지 않는다(마름) | 설정 `EMBEDDING_LOCAL_MODEL` 추가(값이 사실상 하나인 손잡이), 수동 재색인 안내(업데이트만 한 설치가 의미 검색을 잃는다), 별도 이주 작업(같은 일을 하는 장치가 둘이 되고 끄는 길이 따로 필요하다) |

열린 결정은 결정 1 의 C 와 C' 하나다. 공개 설정 값 `minilm` 의 별칭은 더하지 않기로 했다(「이름」 절). 열린 결정이 아니다.

### 결정 1. 모델 파일은 npm 으로 공급한다

원본 저장소(revision `fcfc26bf`, 2025-10-16)에는 safetensors 만 있고 ONNX 가 없다. 변환한 q8 파일을 만들어 npm 패키지에 담아야 한다. 118MB 파일은 git 에 넣지 못한다.

#### C 와 C' 가 함께 쓰는 것

- **변환 스크립트.** `models/multilingual-e5-small-ko-v2/` 에 둔다. npm 워크스페이스가 아니다(루트 `workspaces` 는 명시 목록이다). 원본 revision `fcfc26bf` 를 고정해 받고, optimum 으로 내보낸 뒤 `quantize_dynamic(QUInt8)` 한다. 도구 버전은 `requirements.txt` 로 고정한다(optimum 2.1.0, onnxruntime 1.32.0, transformers 4.57.6, torch 2.15.0+cpu, onnx 1.23.2). fp32 `model.onnx`(470MB)는 싣지 않는다. 만든 파일은 `.gitignore` 로 커밋에서 뺀다.
- **sha256 대조.** `sha256.json` 에 실을 파일 다섯 개(q8 모델, tokenizer, 설정 셋)의 해시를 둔다. 측정에 쓴 파일의 값이다(`model_quantized.onnx` 는 `7bc8d870e27a2c52…`). 스크립트는 만든 파일을 대조하고 다르면 멈춘다. `scripts/docker-smoke.mjs` 도 이미지 안 파일을 같은 값과 대조한다. transformers.js 는 해시를 보지 않는다.
- **재현성.** 같은 기계, 같은 도구 버전에서 세 번 변환해 `model_quantized.onnx` 와 `tokenizer.json` 해시가 세 번 모두 같았다. 다른 기계(CI 러너)에서도 같은지는 모른다. 대조가 막아 주므로 다르면 게시 전에 드러난다.
- **실는 모양.** `<패키지>/multilingual-e5-small-ko-v2/{config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json, onnx/model_quantized.onnx}`. 풀었을 때 135,134,950 바이트, gzip 83,925,241 바이트다.
- **런타임 경로.** 모델 폴더의 상위를 `env.localModelPath` 로 두고 `env.allowLocalModels = true`, `env.allowRemoteModels = false` 로 읽는다. 모델 id 는 폴더 이름이고 `storedName` 과 같다. `minilm-embedding-service.ts:55-56` 의 모듈 로드 때 `allowLocalModels = false` 기본값은 지운다. 이 `env` 를 쓰는 다른 런타임 코드는 없다(`docker-smoke.mjs` 와 `reindex-embeddings.ts` 의 진단 코드뿐이다). 확인했다. 위 모양의 폴더를 원격을 끈 transformers.js 4.3.0 으로 읽으면 fp32 까지 든 폴더로 읽은 출력과 코사인 0.9999998 이다.
- **라이선스.** 원본은 apache-2.0, 기반 모델 `intfloat/multilingual-e5-small`(revision `614241f6`)은 MIT 다. 두 저장소 모두 LICENSE, NOTICE 파일이 없고 모델 카드 메타데이터에만 라이선스가 있다. 모델을 싣는 패키지에 `LICENSE`(Apache-2.0 전문, apache.org 원문)와 `NOTICE`(원본 저장소와 revision, 기반 모델과 MIT 허가 고지, 변경 사실과 도구 버전)를 넣는다.
- **옛 경로 삭제.** 전환 PR 에서 Xenova id, HuggingFace 내려받기, 캐시 위치 주석, Docker warmup(`Dockerfile:75, 97-111`)과 빌드 인자 `SKIP_TRANSFORMERS_WARMUP`(`docker-compose.base.yml:205`), CI 의 HF 캐시 단계 세 곳(`nightly-tests.yml:47-52`, `search-quality-pr.yml:59-64`, `:87-92`)을 지운다. 운영의 로컬 `docker-compose.override.yml`(gitignore 대상, 저장소 밖)은 호스트 `~/.memento/hf-cache` 를 이미지의 transformers 캐시 자리에 붙여 지금 모델을 그 폴더에서 읽는다(uid 1000 으로 돌 때 캐시를 못 만들어 tfidf 로 떨어진 일 때문에 붙였다). 새 경로는 패키지 폴더를 읽기만 하니 전환 뒤 이 마운트를 운영 절차에서 지운다. 두 경로를 같이 두지 않는다. PR revert 는 옛 경로를 함께 되살린다.
- **크기 상한.** npm 의 tarball 크기 상한은 공식 문서를 찾지 못했다. 이미 게시된 `onnxruntime-node` 1.31.1 이 풀었을 때 307,626,018 바이트라 135MB 는 실제 범위 안이다. 처음 게시 전에 `npm publish --dry-run` 으로 크기를 보고, 실제 게시 한 번으로 확인한다.

#### C 와 C' 비교 (사용자 확인 중, 확정하지 않는다)

| 기준 | C. 앱 패키지 `memento-mcp-server` 에 넣는다 | C'. 모델 전용 npm 패키지를 따로 두고 앱이 정확한 버전으로 의존한다 |
|---|---|---|
| 게시하는 것 | 매주 릴리스 tarball 에 모델이 들어간다. 지금 풀었을 때 10,149,917 바이트(2.3.10, 3,276 파일)가 약 145MB 가 된다 | 모델 패키지(예 `@jee1/memento-model-e5-small-ko-v2`)를 모델이 바뀔 때 한 번 올린다. 앱 tarball 은 그대로다 |
| 설치하는 쪽 | 업그레이드마다 모델을 다시 받는다(gzip 약 84MB) | 같은 모델 버전이면 다시 받지 않는다 |
| 게시 때 파일 출처 | 릴리스 CI(`release.yml:222-243`)가 checkout 에서 빌드한다. 파일이 git 에 없으니 릴리스 작업이 변환 스크립트를 돌려야 한다(torch 설치, 원본 470MB 내려받기, 다른 기계 재현은 모름) | 주인 PC 에서 스크립트로 만들고 대조해 한 번 게시한다. 이 PC 에서는 재현이 확인됐다 |
| Docker | `Dockerfile:21-25` 는 git checkout 을 COPY 하고 npm tarball 을 쓰지 않는다. 빌드 호스트에서 스크립트로 만든 파일을 빌드 문맥에 두거나 Docker 빌드 안에서 변환해야 한다 | `npm ci`(`Dockerfile:18`)가 lockfile 대로 받는다. 따로 할 일이 없다 |
| CI | 모델이 필요한 작업(최근 30일 약 350회)마다 변환하거나, 변환 결과를 `actions/cache` 로 `sha256.json` 키에 묶어 둔다. 캐시가 비면 torch 설치와 변환이 다시 돈다 | `npm ci` 와 `actions/setup-node` 의 `cache: npm` 이 받는다 |
| 개발 체크아웃, worktree | 스크립트를 돌려야 한다(python, torch 필요) | `npm ci` 로 받는다 |
| 설치 무결성 | 앱 패키지의 lockfile `integrity`(sha512)가 tarball 을 지킨다. CI, Docker, 개발은 스크립트 대조에 기댄다 | 모든 경로가 lockfile `integrity` 로 같은 tarball 을 받는다 |
| 새로 생기는 것 | 없음 | npm 패키지 이름 하나(같은 계정). 첫 게시는 주인의 npm 로그인이 필요하다. 지금 릴리스가 쓰는 npm OIDC trusted publishing 은 이미 있는 패키지에만 붙고 새 패키지를 만들지 못한다 |
| 라이선스 위치 | 앱 패키지가 모델을 재배포하니 앱 패키지에 `LICENSE`(MIT)와 함께 모델의 `LICENSE`, `NOTICE` 를 따로 싣는다 | 모델 패키지에만 싣는다. 앱 README 의 의존성 안내에 한 줄 적는다 |

- 어느 쪽이든 모델은 루트 `dependencies`(C 는 tarball 안) 경로로 모든 설치가 받는다. openai, gemini 제공자를 쓰는 설치도 받는다. 기본 제공자가 `minilm` 이고 지금도 첫 사용 때 q8 118MB 를 HuggingFace 에서 받으니, 기본 설치는 받는 시점이 첫 사용에서 설치로 옮겨 갈 뿐이다. `optionalDependencies` 로 빼지 않는다. 빠지면 로컬 제공자가 조용히 다른 제공자로 떨어진다.
- 사용자에게 함께 확인할 것. 회사 설치가 npm 설치인지 Docker 인지다. 두 설치가 모두 Docker 라면 C 의 npm 포함은 비용만 남는다.
- 둘 다 고르지 않은 파일 출처. Git LFS 는 무료 한도가 저장과 대역폭 각각 월 10GiB 이고 지출 한도가 기본값 0 이면 넘는 순간 막힌다. 최근 30일 모델이 필요한 CI 실행(Search Quality PR 142회 × 작업 2, Docker Build 47회, 릴리스 15회, 야간 4회)이 약 350번이라 한 달 약 41GiB 다. 100MB 미만 조각으로 git 에 커밋하면 모든 클론이 모델 버전마다 118MB 를 영구히 짊어진다.
- 게시한 바이트가 바뀌면 `storedName` 도 바꾼다. 같은 저장 이름에 다른 벡터가 섞이지 않게 한다.

### 결정 2. 기준선을 새 모델로 다시 찍는다

실제 게이트는 `tests/fixtures/search-quality/baselines/ranking-nightly.json` 대비 묶음별 MRR 하락 0.03 이하다(`scripts/lib/quality-baseline.ts:24`). 경계선 문항을 빼지 않는다. 한국어 모델과 사상을 넣은 결과는 다음과 같다.

| 묶음 | 기준선 | 한국어 + 사상 | 차이 | 게이트 | 문항 단위 원인 |
|---|---|---|---|---|---|
| incident_ops | 0.7143 | 0.6531 | -0.061 | 실패 | 한 문항. 「HTTP 서버 에러 처리」에서 긴 미끼 `bench_syn_long_0001` 이 정답을 2위로 민다 |
| procedural | 1.0000 | 0.9167 | -0.083 | 실패 | 한 문항. 「FTS5 마이그레이션 fallback」에서 긴 미끼 `bench_syn_long_0008`(주제만 되풀이하는 문서)이 정답을 2위로 민다. 지금 모델을 뺀 모든 임베딩 변형에서 같다 |
| conceptual | 0.9000 | 0.9063 | +0.006 | 통과 | |
| tag_filter | 0.6574 | 0.5528 | -0.105 | 실패 | 점수 차가 하위 25%(0.0106) 미만이던 경계선 문항 셋이 한두 단계 밀린다 |
| knowledge_update | 0.9167 | 0.8681 | -0.049 | 실패 | 같은 틀의 합성 문항 셋이 서로 밀린다. 「새 값이 옛 값보다 위」 비율 22/24 → 21/24 |

- incident_ops 는 처음 측정에서 0.7245(통과)로 나왔다. 그 실행에서만 벤치 첫 질의의 점수가 다른 모든 실행과 달리 텍스트 전용 수준(0.405)이었다. 같은 설정을 세 번 다시 돌리면 0.6531 로 같다. 원인은 모른다. 첫 호출의 모델 지연 로드가 실패해 다른 제공자로 넘어간 경우와 증상이 맞지만 가설이다. 기동 직후 이주와 첫 질의가 겹치는 운영에서도 나기도 한다.
- 기준선 identity 에는 `embedding_provider` 만 있고 모델이 없다(`quality-baseline.ts:380`). 모델을 바꿔도 옛 기준선과 비교하고, 그대로 두면 이후 모든 PR 이 같은 이유로 실패한다.

전환 PR 에서 할 일은 차례로 다음과 같다.

1. PR 범위 게이트(`ranking-pr.json`, 400행)를 새 모델로 먼저 잰다. 아직 잰 적이 없다.
2. 같은 실행에서 질의마다 실제로 쓰인 임베딩 제공자를 기록한다. 응답 메타데이터의 `query_embedding_providers` 를 덤프에 남긴다. 첫 질의가 다른 제공자로 갔다면 기준선을 찍기 전에 그 원인부터 고친다.
3. 관련성 축척 1.5 를 `benchmark-v3/split.json` held-out 과 주입 하네스 반분으로 확인한다. 통과할 때만 넣는다. 넣으면 승인할 퇴행은 procedural(미끼 한 문항)과 tag_filter(경계선 셋) 둘이고, 안 넣으면 넷이다.
4. 남는 퇴행 묶음을 문항 단위 원인과 함께 PR 본문에 적고 사용자 승인을 받는다(high).
5. `ranking-nightly.json`, `ranking-pr.json` 을 새 모델로 다시 찍는다.
6. identity 에 모델 `storedName` 을 더하고 비교에 넣는다. 다음 모델 교체도 기준선 다시 찍기를 강제한다.

knowledge_update 는 「바뀐 지침이 옛 지침보다 먼저 나와야 한다」는 용례와 닿는다. 축척 1.5 에서는 기준선 위로 돌아오지만(0.9375), 전환 뒤 지표 2 로 따로 본다.

### 결정 3. 빌드 상수를 바꾸고 기동 뒤 자동으로 이주한다

- 모델 이름은 빌드 상수다(`embedding-models.ts:14`). 바꾸면 업데이트한 설치의 벡터 검색은 재색인 전까지 옛 행을 전부 거른다. 검색은 텍스트 레인으로만 돈다(#889 동작).
- 지금 `embedding_reconciliation` 은 provider 와 content_hash 만 보고 모델 드리프트는 고치지 않는다(`embedding-reconciliation-batch-job.ts:40-43`). 이미 「페이지 스캔, 후보, `createAndStoreEmbedding`」 모양이라(`:56-78`, `:88-126`) 조건 하나를 넓히면 이주가 된다.
- 저장 행은 `(memory_id, embedding_provider, projection_type)` UNIQUE 라 옛 벡터와 새 벡터가 함께 있지 못한다. 이주는 제자리에서 덮어쓴다.
- 이 PC 에서 13,510건 재임베딩은 혼잡 조건에서 665초(지금 모델은 443초)였다.
- 이주 명세는 「전환 구간과 모델 이주」 절에 적는다.

## 설계

### 모델 정의 한 곳

모델에 따라 달라지는 값은 이 객체에 둔다. 예외는 랭킹 손잡이다. `ranking-weights.toml` 이 단일 원본이라 그대로 두고, 모델 때문에 바꾸면 같은 PR 에 넣어 revert 한 번으로 함께 돌아가게 한다.

```ts
// packages/memento-core/src/shared/config/embedding-models.ts
export type EmbeddingRole = 'query' | 'passage';

export interface LocalEmbeddingModel {
  /** memory_embedding.model 에 저장되는 이름. 벡터 공간의 정체성이다. */
  readonly storedName: string;
  /** 파일 위치. PR 3~7 은 지금 모델의 원격 저장소, 전환 PR 부터는 npm 패키지 안 폴더. */
  readonly source: { readonly repo: string; readonly dtype: 'q8' };
  readonly dimensions: 384;
  readonly prefixes: Readonly<Record<EmbeddingRole, string>>;
  /** 질의-기억 코사인을 지금 척도로 옮기는 1차 변환. 기억끼리 비교에는 쓰지 않는다. */
  readonly queryScoreMapping: { readonly a: number; readonly b: number };
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

- 모델은 한 번에 하나라 표(map)를 두지 않는다. 되돌리기는 PR revert 다.
- `source` 는 한 모양만 둔다. 전환 PR 이 원격 저장소 필드를 패키지 폴더 필드로 바꾸고 로더도 같은 PR 에서 로컬 전용으로 바꾼다. 두 경로를 같이 두지 않는다.
- 지금 모델의 값은 접두 `''`, 사상 `{ a: 1, b: 0 }`, 기준값은 지금 상수 그대로다.
- `storedName` 은 패키지 이름이나 폴더에서 떼어 내지 않는다. 위치와 정체성을 나눈다.
- `getEmbeddingModelFilter('minilm')` 는 `storedName` 을 돌려준다. 벡터 검색이 같은 모델 행만 비교하는 지금 규칙(#889)은 그대로다.
- 리뷰에서 PR 5 를 줄이는 안(기준값 여섯을 모델 정의로 옮기지 않고 전환 PR 에서 제자리 값만 바꾼다)이 나왔다. 모델 정의 한 곳에 모으라는 것이 이 설계의 요구라 옮기는 쪽을 둔다. 다음 교체는 쉬워지고, 코드 이동은 늘어난다.

### 이름: 바꾸는 것과 남기는 것

| 대상 | 결정 | 이유 |
|---|---|---|
| 저장값 `memory_embedding.embedding_provider = 'minilm'` | 남긴다 | 바꾸려면 모든 행을 갱신하고 vec 트리거를 다시 써야 한다. 얻는 것이 없다 |
| vec 테이블 `memory_item_vec_minilm`, 트리거(마이그레이션 012, 053), `vec-schema.ts` 허용 목록 | 남긴다 | 스키마 이름이다. vec0 가상 테이블 이름을 바꾸면 테이블을 다시 만든다 |
| 공개 설정 값 `EMBEDDING_PROVIDER=minilm`, recall `provider_filter` 의 `minilm`, 관리 API `provider=minilm` | 남긴다. 별칭을 더하지 않는다 | 설치의 `.env` 와 클라이언트가 이 값을 보낸다. 별칭(`local`)을 더하면 이름이 둘이 된다 |
| 코드 상수 `MINILM_MODEL_ID`, `MINILM_MODEL_NAME` | `LOCAL_EMBEDDING_MODEL` 하나로 바꾼다 | 모델과 이름이 어긋난다. `scripts/backfill-relations-jev.mjs` 는 dist 에서 `MINILM_MODEL_NAME` 을 읽어 타입 검사 밖이니 같은 PR 에서 고친다 |
| 클래스 `MiniLMEmbeddingService`, 파일 `minilm-embedding-service.ts`, `globalThis.__minilmModelLoadWarningShown`, 로그 「MiniLM 모델 로딩」 | `LocalEmbeddingService`, `local-embedding-service.ts` 등 모델 중립 이름 | 같음 |
| 캐시 키 `generateEmbeddingCacheKey('minilm', text)`(결과 캐시와 창 캐시 둘) | `storedName` 과 역할을 키에 넣는다 | 같은 글이라도 질의 벡터와 기억 벡터가 다르다 |
| `Dockerfile:103` warmup, `scripts/docker-smoke.mjs:41` 의 모델 id | warmup 은 지우고 smoke 는 모델 정의와 패키지 폴더를 읽는다 | 모델 id 가 세 곳에 있다 |
| `ensure-memory-embedding-metadata-defaults.ts:15` 의 `model LIKE '%minilm%'` | `storedName` 도 같은 분기로 받는다 | 새 이름에 minilm 이 없다. provider 가 빈 옛 행 보정에만 쓰여 영향은 작다 |
| CI 캐시 키 `hf-minilm-`, 단계 「MiniLM Korean embedding quality」, `minilm-korean-quality.spec.ts` | 캐시 단계는 지우고, 단계와 spec 은 모델 중립 이름으로. spec 기대값은 전환 PR 에서 새 모델로 | 같음 |
| `window-embedding-write.ts:24-32` `WINDOW_CANDIDATE_MIN_CHARS = 800` 와 주석 | 새 모델로 2창 최소 길이를 다시 재고 주석의 모델 이름을 고친다 | 주석의 ponytail 이 모델이 바뀌면 다시 재라고 적었다 |

새 용어는 GLOSSARY 와 대조했다. 처음 쓴 「calibration(보정)」은 Gate baseline 항목의 `_Avoid_` 라 「질의 점수 사상」으로 바꿨다. 전환 PR 에서 GLOSSARY 에 넣을 항목은 다음과 같다.

- **Local embedding model (로컬 임베딩 모델)**: 임베딩 제공자 값 `minilm` 뒤에서 도는 모델 하나. 저장 이름은 `memory_embedding.model` 이다. `minilm` 은 역사적 이름이다. _Avoid_: MiniLM(모델을 가리킬 때)
- **Embedding provider value (임베딩 제공자 값)**: `memory_embedding.embedding_provider` 와 `EMBEDDING_PROVIDER` 의 값(tfidf, minilm, openai, gemini). LLM 제공자(typesafe 등)와 다르다.
- **Native vector, window vector (native 벡터, 창 벡터)**: `projection_type` 이 `native` 인 기억 대표 벡터와 `window:N` 인 510토큰 조각 벡터.
- **Query vector, passage vector (질의 벡터, 기억 벡터)**: 같은 모델이 역할 접두를 달리 붙여 만든 벡터. 저장하는 것은 기억 벡터뿐이다.
- **Query score mapping (질의 점수 사상)**: 질의-기억 코사인을 검색 상수가 맞춰진 척도로 옮기는 1차 변환. 기억끼리 비교에는 쓰지 않는다. _Avoid_: calibration
- **Model migration (모델 이주)**: native 또는 창 행의 모델이 지금 모델과 다른 기억을 다시 만드는 일. `embedding_reconciliation` 이 한다.

### 접두와 창 크기

`EmbeddingServiceInterface.generateEmbedding(text)` 하나에 접두를 붙이면 기억끼리 비교 경로가 모두 질의 벡터로 바뀐다. 그래서 진입점을 나눈다. `generateEmbedding` 은 기억 벡터를 만든다. `embedQuery` 는 `UnifiedEmbeddingService` 와 로컬 서비스에만 둔다. 활성 제공자가 로컬이 아니면 `UnifiedEmbeddingService.embedQuery` 는 `generateEmbedding` 과 같다.

| 역할 | 호출처 |
|---|---|
| 질의 | `hybrid-vector-search-executor.ts:443`(벡터 레인과 backfill), `memory-embedding-service.ts:444` `searchBySimilarity`(executor 의 fallback 경로 `:324`, vec 엔진을 못 쓰거나 vec 검색이 예외를 낼 때 `:110`, `:221`), `vector-search.service.ts:76`, `anchor/query-filter-service.ts:65`(`search_local` 도구) |
| 기억 | 저장(`memory-embedding-service.ts:378`), 창(`:207`), Sleep consolidation 요약(`sleep-consolidation-service.ts:132`), 라벨 뗀 재임베딩(`:527`), remember 중복 판정(`remember-tool-near-duplicate.ts:161`), 관계 후보 재정렬(`embedding-candidate-filter.ts:33`), `migrate-embeddings-tool.ts:113`, openai, gemini 의 로컬 fallback |

- `searchSimilar` 는 지운다. 운영 호출처는 `embedding-candidate-filter.ts:38` 하나이고, 이 호출은 `:33` 에서 만든 벡터를 버리고 같은 글을 다시 임베딩한다. `:33` 벡터로 `rankSimilarEmbeddings` 를 바로 부르면 결과가 같다. 그러면 여섯 서비스와 인터페이스의 `searchSimilar` 가 필요 없다(PR 2).
- 기억끼리 비교에 `query: ` 를 붙인 벡터를 따로 두지 않는다. 측정에서 최근접 이웃 상위 5 의 81% 가 기억 벡터와 같았고, 기억마다 벡터를 하나 더 둘 근거가 나오지 않았다.
- 창 크기는 510 에서 그 역할의 접두 토큰 수를 뺀 값이다. 모델을 읽을 때 토크나이저로 `add_special_tokens: false` 를 주고 센다(`passage: ` 는 3토큰이라 507, 빈 접두는 0). 기본 옵션으로 세면 빈 접두도 특수 토큰 2개가 잡혀 지금 모델의 창이 508 로 바뀐다.

### 질의 점수 사상

결정은 측정한 1차 변환을 그대로 넣는 쪽이다. `s' = clamp01(a × s + b)`, 한국어 모델은 a=1.9943, b=-0.6838 이다.

| 기준 | 1차 변환을 넣는다 | 검색 상수를 새 분포에 맞게 고친다 |
|---|---|---|
| 측정 | 했다. 주입 상위 5 +8.4%p [+5.0, +11.8] | 하지 않았다 |
| 모델별 상수 | 2개, 모델 정의 안 | 0.38, 0.5, high_vector 0.8, 관련성 축척 2.0, 융합 가중치, 적응형 가중 문턱. `constants.ts` 와 `ranking-weights.toml` 에 흩어진 10여 개 |
| 다음 모델 교체 | 사상 계수만 다시 구한다 | 위 상수를 다시 맞춘다 |

- 불변식. **사상은 `embedQuery` 로 만든 질의 벡터를 가진 호출처에서만 건다. 기억끼리 비교는 raw 코사인이다.** 공용 변환(`cosineDistanceToSimilarity`, #806), 공용 벡터 검색 서비스와 저장소에는 넣지 않는다. remember 중복 판정이 같은 `vecEng.search` 를 쓰기 때문이다(`remember-tool-near-duplicate.ts:158-177`). 「중복 판정 점수는 사상되지 않는다」 테스트를 둔다.
- 거는 자리. `hybrid-vector-search-executor.ts` 안의 셋(벡터 레인 길이 감쇠 직전, `hybrid-vector-backfill.ts:92` 결과, fallback 결과), `vector-search.service.ts` 의 결과, `anchor/query-filter-service.ts:89` 의 `querySim`. 측정은 앞의 둘만 거쳤다.
- 앵커 질의 필터는 `combined_similarity = baseRankingScore × 0.6 + querySim × 0.4`(`query-filter-service.ts:101`)로 앵커 기준 raw 유사도와 섞는다. `querySim` 은 질의 점수라 사상하고 앵커 쪽은 raw 로 둔다. 이 경로는 재지 않았다. `search_local` 은 숨김 도구다.
- 근거는 포화다. 사상값이 1.0 에 닿는 raw 코사인은 0.844 다. 질의-기억은 262문항 가운데 최고 점수가 0.844 를 넘는 문항이 0개다(최고 점수 중앙값 0.684). 기억끼리는 최근접 이웃 중앙값이 0.846 이라 절반이 1.0 동점이 된다. 그러면 이웃 정렬, supersede 상위 3, 합침 대상 고르기가 무너진다.
- a, b 는 정답 정보를 쓰지 않는다. 262문항 × 기억 전부의 점수 분포(평균, 표준편차)만 맞춘다. 하네스의 전처리와 창 규칙은 운영 서비스와 같다(「용어」의 하네스). 야간 품질 검사에도 같은 값을 그대로 썼다.
- 점수 산출이 바뀌니 전환 PR 에서 `HYBRID_SEARCH.VECTOR_SCORE_SCALE`(`constants.ts:87`)을 올리고, `getRankingVersionPayload`(`ranking-weights-loader.ts:291-312`)에 `storedName` 과 사상 계수를 넣는다. 그러지 않으면 전환 전후 텔레메트리가 같은 랭킹 버전으로 섞여 지표 2 비교가 오염된다.
- `search-ranking-relevance.ts:20, :62` 의 임베딩 관련성 분기는 값을 넘기는 호출처가 없다. 지울 대상이다(PR 2).

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
| 하이브리드 벡터 임계, high_vector 가중 | `constants.ts:117, 139` | 0.38, 0.8 | 그대로 | 읽기만 | 사상 척도라 흡수 |

사본에서 출발점 값으로 잰 규모는 다음과 같다(raw 저장 벡터 기준, 라벨 떼기와 LLM 판정 전).

| 기능 | 지금 모델 | 한국어 모델, 출발점 |
|---|---|---|
| Sleep consolidation 군집 수, 군집에 든 episodic, 최대 크기 | 93, 775, 124 | 153, 964, 56 |
| supersede 후보 쌍(상한 전) | 808 | 918 |
| 이웃이 하나 이상인 기억, 기억당 평균 이웃 | 58%, 60 | 96%, 75 |

- env 덮어쓰기 세 개는 그대로 받는다. 값은 그 모델의 raw 척도라는 점을 `env.example` 과 CHANGELOG 에 적는다. 운영 `.env` 는 세 값을 덮어쓰지 않는다(마름 확인).

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
- 예외 하나. 관련성 축척 1.5 는 held-out 을 통과하면 전환 PR 에 넣는다. 이유는 둘이다. 축척 2.0 은 지금 모델의 점수 폭에 맞춰 정한 값이라(#1180) 새 분포에 맞추는 일이고, 사상 계수와 같은 종류다. 기준선 다시 찍기는 게이트 변경이라 축척을 나중에 바꾸면 한 번 더 찍고 승인받아야 한다. 다른 손잡이는 예외가 아니다.
- 방법. `npm run ranking:preview` 로 벤치마크 dev 질의만 보고(#1399, held-out 은 마지막에 한 번), 주입 하네스 262문항은 기억 단위로 반을 나눠 한쪽에서 고르고 다른 쪽에서 확인한다. 격자는 실행 전에 적는다.
- 판정 규칙. 지침 기억 검색 측정 때 미리 정한 규칙(저장소 밖 측정 설계)을 그대로 쓴다. 주 지표는 주입 상위 5 다. 전환 상태 대비 95% 구간 하한이 0 을 넘고 야간 품질 검사 퇴행이 없으면 채택한다. 부담이 작은 손잡이부터 보고, 더 부담 큰 쪽이 5%p 넘게 낫지 않으면 멈춘다.

탐침(탐색, 채택 근거 아님). 결정 2 를 위해 `ranking-weights.toml` 손잡이 하나씩 다섯 개를 실행 전에 적고 돌렸다. 벤치(엔진 기본 가중치)와 주입(0.7 / 0.3 고정)을 함께 움직이는 손잡이는 이 파일뿐이다. 모두 한국어 모델과 사상을 넣은 상태이고 게이트는 껐다.

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
- P2 는 incident_ops 의 미끼 문항과 knowledge_update 를 기준선 위로 되돌린다. 사상한 점수의 폭이 지금 모델과 달라 축척 2.0 이 과하다는 해석과 맞는다. 벤치 전체 질의로 고른 값이라 held-out 확인이 따로 필요하다.
- 탐침의 주입 상위 5 P0 대비 차이는 P2 +0.8%p [0.0, +1.9], P3 와 P4 -0.8%p [-1.9, 0.0], 나머지 0 이다.

### 전환 구간과 모델 이주

이주는 `embedding_reconciliation` 을 넓혀서 한다. 새 작업, 새 설정 키를 만들지 않는다.

- **대상.** 지금 조건(native 없음, 내용 해시 불일치)에 「native 또는 창 행의 `model` 이 `storedName` 과 다름」을 더한다. 창 행을 같이 보는 이유는 창이 native 트랜잭션 밖에서 쓰여(`memory-embedding-service.ts:427`) 그 사이에 멈추면 창만 옛 모델로 남기 때문이다. 관리 화면의 `modelDriftCount`(`embedding-reindex-service.ts:320`, 지금은 native 만 센다)도 창을 함께 센다.
- **실행 주체.** 정기 실행은 지금 잡 그대로다(하루 1회, 1,000건). 기동 직후 이주 반복은 core 의 배치 스케줄러가 메서드 `BatchScheduler.startModelMigration()` 으로 내놓고, 서버 진입점이 자기가 주인일 때만 부른다. 상시 HTTP 서버는 기동 뒤 부르고, stdio 는 HTTP sidecar 잠금(`tryAcquireLock`, `packages/memento-server/src/server/utils/instance-lock.ts:44`)을 얻은 직후에만 부른다. core 에 옵션을 넘기지 않고 잠금을 아는 서버가 부를지 정한다. 배치 스케줄러는 `createMementoCore` 안에서 늘 뜨고(`bootstrap/batch-telemetry-relation.ts:60`) 잠금이 없어서, 이렇게 하지 않으면 stdio 프로세스마다 이주가 하나씩 돈다. sidecar 없는 stdio 전용 설치는 반복이 없고 정기 실행으로 하루 1,000건씩 따라잡는다(13,511건이면 약 2주).
- **한 바퀴의 단위.** 이주 반복은 1,000건 실행(`maxBatchSize`, `batch-scheduler-default-config.ts:84`)을 주기 대기 없이 잇달아 돌리고, 후보가 0 이 되거나 연속 실패 상한에 닿으면 멈춘다. 반복이 멈춘 시점이 한 바퀴의 끝이다. 실행 하나하나는 잡 제한 시간 5분(`:89`) 안에 끝나야 한다. 시간 초과는 작업을 멈추지 않고(`Promise.race`, `batch-job-execution-coordinator.ts:317-323`) 완료 표시와 재시도를 걸어 원래 실행과 겹치기 때문이다. 그래서 실행 안에서 경과가 4분을 넘으면 새 후보를 잡지 않고 남은 수를 돌려준다. 이 PC 혼잡 조건 속도(13,510건 665초)면 1,000건은 약 49초라 운영 CPU 가 5배 느려도 4분 안에 멈춘다. 반복이 도는 중이라는 상태는 스케줄러가 든다.
- **제공자 고정.** 이주는 지정한 로컬 제공자만 쓴다. 실패하면 다른 제공자로 넘어가지 않고 throw 한다. 지금 `UnifiedEmbeddingService.generateEmbedding` 은 실패하면 `tryFallbackProviders` 로 가고(`unified-embedding-service.ts:64, :73`), 이 함수는 원하는 제공자를 무시하고 우선순위 openai, gemini, minilm, tfidf 순으로 고른다(`embedding-provider-factory.ts:84-137`). 외부 키가 있으면 이주 대상 원문이 외부 임베딩 API 로 나가고, 없으면 tfidf 행이 쌓여 드리프트가 줄지 않는다. 구현 지점은 `UnifiedEmbeddingService.generateEmbeddingStrict(text, provider)`(지정 제공자만 부르고 실패하면 throw)와, 이를 타는 `MemoryEmbeddingService.createAndStoreEmbedding` 의 `{ strictProvider }` 옵션이다. 지금 다섯째 인자 `preferredProvider`(`memory-embedding-service.ts:368`)는 선택만 바꾸고 fallback 을 막지 못한다. 수동 재색인(`reindex()`, `reindexByIds()`)도 지금 이 인자를 넘기니 실패하면 다른 제공자로 넘어간다. 같은 PR 에서 strict 경로로 바꾼다.
- **실패 상한.** 연속 실패가 20건이면 반복을 멈추고 잡 결과에 실패로 남긴다. 실패한 행은 드리프트로 남아 다음 정기 실행이 다시 본다.
- **Sleep consolidation.** 모델 드리프트 기억이 활성 기억의 1% 를 넘는 동안 건너뛴다. DB 로 판단하니 이주 반복을 돌리지 않는 stdio 프로세스에도 같은 조건이다. 반복이 끝난 뒤 실패로 남은 기억이 1% 이하면 돈다. 그 기억은 #1732 의 모델 조건으로 군집에서 빠진다. 「드리프트 0」을 조건으로 두면 기억 하나만 실패해도 consolidation 이 조용히 영구 정지하고, 「이 프로세스의 첫 바퀴 끝남」을 조건으로 두면 반복을 돌리지 않는 프로세스가 이주 중에 군집을 만든다.
- **동시 쓰기.** `POST /api/v1/maintenance/reindex`(전체, 양보 없음)는 이주 반복이나 `embedding_reconciliation` 실행이 도는 동안 409 로 거절한다. CLI `reindex-embeddings` 는 `createMementoCore` 를 불러 이주를 하나 더 띄우니(`reindex-embeddings.ts:62`) 서버를 멈춘 뒤에만 쓴다고 문서에 적는다. 저장 쓰기는 트랜잭션 안에서 본문을 다시 확인하고 UNIQUE 로 덮어써 손상 위험은 낮다. 실제 비용은 중복 계산과 CPU 다.
- **끄는 길.** 관리 API 의 잡 일시정지와 `BATCH_SCHEDULER_ENABLED=false`(모든 배치를 끈다)다. 이주 반복도 스케줄러를 거치므로 둘 다 듣는다. 일시정지는 메모리에만 있어 재시작하면 풀리고 반복이 다시 시작한다. 그래서 OOM 재시작 루프는 `BATCH_SCHEDULER_ENABLED=false` 로만 끊는다. 이주만 끄는 키는 더하지 않는다.
- **이주 중 검색.** 벡터 검색은 지금 모델 행만 비교한다(#889 의 모델 필터). 이주 전 행은 KNN 자리를 차지했다가 걸러져 의미 레인이 덜 차기도 한다. 틀린 결과가 아니라 적은 결과다. 검색 backfill 과 fallback 은 PR 1 에서 모델 조건을 단다.
- **진행 확인.** 관리 API 의 `modelDriftCount` 나 읽기 전용 SQL 로 본다. `reindex-embeddings --dry-run` 은 이주를 하나 더 띄우니 쓰지 않는다.
- **지금 모델에서는 할 일이 없다.** 사본(2026-11-14)에서 native 13,511행과 창 1,237행이 모두 지금 모델 이름이고 임베딩 없는 활성 기억이 0이다. PR 6 머지 전에 운영의 `modelDriftCount` 와 임베딩 없는 기억 수를 한 번 더 본다.

운영 절차(마름이 사용자 지시 뒤에 한다).

1. 사본 리허설. 운영 DB 사본으로 1GiB cgroup 안에서 이주를 돌려 이주 시간, peak RSS, 이주 뒤 규모 표, 하네스 주입 상위 5 를 잰다.
2. `npm run db:backup` 으로 DB 전체를 백업한다(호스트 백업이 막히면 컨테이너 안에서 자동 재시도, 등가물 `npm run db:backup:docker`).
3. 기존 배포 절차로 올린다. 배포 직후 관리 API 로 `sleep_consolidation_batch` 를 멈춘다.
4. `modelDriftCount` 가 0 이 될 때까지 본다. 이 PC 기준 약 11분이다. 운영 컨테이너의 CPU 한도는 확인하지 않았다. 이주 중 OOM 으로 재시작이 되풀이되면 `.env` 에 `BATCH_SCHEDULER_ENABLED=false` 를 두고 다시 올려 루프를 끊은 뒤 원인을 본다.
5. 이주가 끝나면 `npm run db:backup:docker` 를 한 번 더 하고 Sleep consolidation 을 다시 켠다. 데이터를 바꾸는 배치가 처음 돌기 직전의 복원점이다.
6. `/health`, 기억 수, 에러 로그, `memory_injection` 결과를 확인한다.
7. 로컬 `docker-compose.override.yml` 의 `~/.memento/hf-cache` 마운트를 지우고 다시 올린다. 모델이 패키지 폴더에서 읽히는지 smoke 로 본다.

되돌리기는 사고 종류마다 다르다.

| 사고 | 되돌리는 법 | 잃는 것 |
|---|---|---|
| 벡터만(검색 품질) | 전환 PR revert 와 재배포. 같은 이주가 거꾸로 돌아 지금 모델 벡터를 다시 만든다(측정 443초) | 없음 |
| 데이터(Sleep consolidation, 합침이 잘못 합쳤다) | 5번 백업을 `docs/operations/ko/docker-deploy-procedure.md` 「롤백」 절차로 복원한 뒤 벡터만 되돌리기 | 5번 백업 뒤에 쓴 기억 |
| 기준값(규모가 크다) | 그 기능의 잡을 멈추고 모델 정의의 값을 고치는 PR. 누가 기준값 env 를 새 척도로 바꿨다면 그 env 도 되돌린다 | 없음(잘못 합친 것이 있으면 데이터 사고로 다룬다) |

`scripts/backup-embeddings.js` 는 쓰지 않는다. provider 와 projection_type 을 담지 않고 복원 경로가 없다. 지운다.

## 읽어서 메운 미지

1. **앵커 다시 걸기의 운영 호출처는 0이다.** `AnchorReanchorService.autoReanchor`, `checkAndAutoReanchor` 는 `AnchorSearchService` 의 감싸는 메서드(`anchor-search-service.ts:420-490`)에서만 불리고, 그 메서드를 부르는 운영 코드가 없다. 테스트만 부른다(`anchor-reanchor-service.spec.ts` 가 직접, `current-memory-reads.spec.ts:249` 가 감싸는 메서드로). 기준값을 다시 맞추지 않고 지운다(378줄).
2. **이웃 기억 서비스와 앵커 캐시는 창 행을 집는다(#1731).** `memory-neighbor-service.ts:170-180`, `:345-352`, `anchor-cache-service.ts:91-100` 은 `ORDER BY created_at DESC LIMIT 1` 로 기억의 아무 행이나 고른다. projection_type, provider, model 조건이 없다. 사본에서 같은 SQL 로 재면 창 행이 있는 530건 가운데 111건(21%)이 본문 일부의 창 벡터로 이웃을 찾는다.
3. **Sleep consolidation 의 벡터 읽기는 모델을 거르지 않는다(#1732).** 라벨 뗀 재임베딩(#1225, `sleep-consolidation-service.ts:508-540`)은 `generateEmbedding` 을 부르므로 새 모델과 기억 접두를 탄다. 비교 대상인 `loadEmbeddingsMap`(`consolidation-repository.ts:186-200`)이 provider 만 걸고, 재임베딩 결과도 provider 와 길이만 확인한다.
4. **검색 backfill 과 fallback 도 모델을 거르지 않는다(리뷰).** `hybrid-vector-backfill.ts:78-83` 은 native 행을 provider 와 projection_type 으로만 고른다. 두 모델이 모두 384차원이라 길이 검사(`:91`)로도 걸러지지 않는다. fallback 경로(`memory-embedding-service.ts:444` `searchBySimilarity`, SQL `:221-262`)도 같다. 전환 구간과 revert 구간 둘 다 해당한다.
5. 그 밖에 확인한 것. 관계 후보 KNN(`remember-tool-db-helpers.ts:99-150`), 요약 합침 대상(`findSemanticsByOwner`), supersede(묶음 키에 모델 포함), remember 중복 판정(벡터 검색의 모델 필터)은 같은 모델 벡터만 비교한다.

## PR 나누기

PR 랭킹 게이트(`search-quality-pr.yml`)는 `shared/config`, `domains/search`, `domains/embedding` 등 정해진 경로를 건드릴 때만 돌고, 질의 MRR 을 0.03 허용폭으로 잰다. 기억끼리 기준값은 재지 않는다. 그래서 PR 마다 같음을 보이는 테스트를 따로 둔다.

| PR | 내용 | 지금 모델에서 동작 | 랭킹 게이트 | 같음 또는 바뀜을 보이는 것 | risk 예상 |
|---|---|---|---|---|---|
| 1 | #1731, #1732 와 검색 경로 둘. 저장 벡터 읽기 함수 둘을 둔다. 단건 `loadCurrentNativeVector(db, memoryId): number[] \| null`, 다건 `loadCurrentNativeVectors(db, memoryIds): Map<string, number[]>`. 조건은 활성 provider, `getEmbeddingModelFilter` 의 모델, `projection_type = 'native'`. 이웃 기억 두 곳과 앵커 캐시가 단건을, `loadEmbeddingsMap` 과 #1225 확인이 다건을 부른다. 이주 전 기억은 null 이고 호출처는 「임베딩 없음」으로 다룬다(이웃은 빈 결과, 앵커는 임베딩 없음, 군집은 이번 실행에서 뺌). backfill 과 fallback SQL 은 KNN 이라 함수 대신 `model = ?` 조건을 단다 | 바뀐다(버그 수정). 긴 기억 21% 의 이웃 질의 벡터가 native 가 된다 | 돈다(backfill) | 창 행과 다른 모델 행이 섞인 기억에서 현재 모델 native 만 쓰는 단위 테스트, backfill 과 fallback 이 다른 모델 행을 버리는 테스트 | medium |
| 2 | 지우기. `AnchorReanchorService` 와 감싸는 메서드 넷, `SearchOptions.autoMoveEnabled`(`anchor-interfaces.ts:34`), 관련 spec(`anchor-reanchor-service.spec.ts`, `current-memory-reads.spec.ts:249` 의 단언), `tests/memory-item-sql-freeze.spec.ts:34` 의 경로와 `FROZEN_MEMORY_ITEM_SQL_FILE_COUNT` 72 → 71. 관련성 임베딩 분기와 타입 필드(`search-ranking.types.ts:19, :34`)는 0.60 항만 지우고 나머지 가중치는 재정규화하지 않는다(분기가 늘 0 이라 결과가 같다). `searchSimilar` 와 인터페이스 선언. `backup-embeddings.js`, `backup:embeddings` 스크립트, `scripts-index.md` 언급 | 같음 | 돈다(관련성) | 기존 테스트, knip, 경로를 한정한 `git grep` 남은 언급 0 | low |
| 3 | 모델 정의 한 곳과 이름 정리(위 표). smoke 가 정의를 읽는다 | 같음 | 돈다 | `storedName` 을 리터럴 `'paraphrase-multilingual-MiniLM-L12-v2'` 로 고정하는 테스트, `getEmbeddingModelFilter('minilm')` 값 테스트, docker smoke | medium(파일 많음) |
| 4 | `embedQuery` 분리, 창 크기를 `add_special_tokens: false` 접두 토큰으로 계산, 결과 캐시와 창 캐시 키에 `storedName` 과 역할 | 같음(접두 빈 문자열) | 돈다 | 510토큰을 넘는 글의 창 분할 골든 테스트(창 크기 510 그대로), 역할별 캐시가 갈리는 테스트 | medium |
| 5 | 기준값과 사상이 모델 정의를 읽는다(기억끼리 기준값 여섯, 사상 다섯 자리, 앵커 슬롯 두 벌 합치기) | 같음(값 그대로, 사상 1, 0) | 돈다(`shared/config`) | 기준값 값 고정 테스트, 고정 fixture 의 군집, 이웃, supersede 후보 수 snapshot, 「중복 판정 점수는 사상되지 않는다」 테스트 | medium |
| 6 | `embedding_reconciliation` 확장(모델 드리프트 native 와 창, `startModelMigration()` 반복과 실행 주체, 실행당 4분 예산, `generateEmbeddingStrict` 와 `{ strictProvider }`, 수동 재색인도 strict, 연속 실패 상한, consolidation 1% 조건, 수동 재색인 409, `modelDriftCount` 에 창) | 같음(드리프트 0, 머지 전 운영 확인) | 돈다(`domains/embedding` 을 건드린다). 이 변경을 재지는 않는다 | 옛 모델 이름 행이 3,000건 넘는 DB(상한 × 3 이상)에서 반복이 후보 0 까지 가고, 시간 예산을 줄여도 실행마다 예산 안에 끝나 재시도와 겹치지 않는 통합 테스트. 중단 뒤 이어서 끝나는 테스트, 로컬 제공자 실패 때 다른 제공자로 넘어가지 않는 테스트, 드리프트 0 이면 처리 0 | medium |
| 7 | 모델 파일 소스(`models/multilingual-e5-small-ko-v2/`: 변환 스크립트, `requirements.txt`, `sha256.json`, `LICENSE`, `NOTICE`, C' 면 `package.json` 과 README). 게시는 결정 1 확정 뒤 PR 밖에서 주인이 한다 | 같음(런타임이 아직 읽지 않는다) | 안 돈다 | 스크립트로 다시 만든 파일의 sha256 이 `sha256.json` 과 같다 | low |
| 8 | 전환. 모델 정의를 한국어 모델로(접두, 사상, 패널로 확인한 기준값, 패키지 폴더), 결정 1 의 공급 경로, 옛 원격 경로와 Docker warmup, CI HF 캐시 삭제, held-out 으로 확인된 관련성 축척, `VECTOR_SCORE_SCALE` 와 랭킹 버전 payload, 결정 2 의 여섯 단계, `minilm-korean-quality.spec.ts` 기대값, 문서 | 바뀐다 | 돌고 기준선을 다시 찍는다 | 하네스 주입 상위 5 구간 하한 > 0, 사본 규모 표, 야간과 PR 게이트, 리허설 peak RSS 1GiB 안 | high(사용자 승인) |

- PR 2 와 PR 7 은 다른 PR 과 의존이 없어 언제든 간다. 나머지는 1 → 3 → 4 → 5 → 6 순서다. 같은 파일(`sleep-consolidation-service.ts`, `embedding-models.ts`)을 여러 PR 이 건드린다.
- agent_panel 판정과 모델 파일 게시는 7 뒤, 8 앞이다.
- 융합 재조정은 8 이 운영에서 soak 한 뒤 별도 이슈다(관련성 축척 예외는 위 절).

## 관리 부담

지우는 것을 먼저 본다.

- 지운다. `anchor-reanchor-service.ts`(378줄)와 감싸는 메서드 넷, `autoMoveEnabled`, 관련성 임베딩 분기, 여섯 서비스와 인터페이스의 `searchSimilar`, `backup-embeddings.js`, Docker warmup 과 `SKIP_TRANSFORMERS_WARMUP`, CI HF 캐시 단계 셋.
- 하나로 합친다. 저장 벡터 읽기 다섯 벌(이웃 둘, 앵커 캐시, `loadEmbeddingsMap`, backfill)과 fallback KNN SQL 의 모델 조건, 앵커 슬롯 기준값 두 벌, 모델 id 하드코딩 세 곳(상수, Dockerfile, smoke), `MINILM_MODEL_ID` 와 `MINILM_MODEL_NAME`.
- 더한다. 모델 정의 필드, 질의 진입점 하나, reconciliation 의 조건 하나와 기동 직후 한 바퀴, 변환 스크립트(C' 면 모델 패키지 하나).
- 같은 일을 하는 장치를 둘 두지 않는다. 이주는 reconciliation 이 한다.
- 다음 모델 교체는 모델 정의 하나, 사상 계수, agent_panel 판정, 기준선 다시 찍기, 모델 파일 다시 만들기로 끝난다.

## 문서

전환 PR(8)에서 함께 고친다. PR 1~7 은 각자 바꾼 이름의 언급만 고친다. `minilm` 은 제공자 값으로 남으니 그 언급은 고치지 않는다. 모델 이름, 클래스, 원격 내려받기를 적은 곳을 고친다.

- 진입과 구조: `AGENTS.md`, `docs/DESIGN.md`, `docs/agents/architecture.md`, `docs/agents/search-ranking.md`(질의 점수 사상 절), `docs/agents/commands.md`(이주 확인, 수동 재색인 제한, 되돌리기)
- 아키텍처: `docs/architecture/{en,ko}/architecture.md`, `docs/architecture/ko/arc42.md`, `c4/01-system-context.md`, `02-container.md`, `03-component-core.md`, `database-design.md`
- 가이드: `docs/guides/{ko,en}/embedding-configuration.md`(기본 모델, 모델 일관성, 재색인 절을 모델 이주로), `embedding-service-guide.md`, `user-manual.md`, `developer-guide.md`, `cursor-mcp-setup.md`, `llm-provider-configuration.md`, `docs/guides/ko/environment-variable-governance.md`, `docs/operations/ko/docker-setup-guide.md`
- 참조: `docs/api/ko/api-reference.md`, `embedding-api-reference.md`, `docs/reference/{ko,en}/embedding-provider-issues.md`, `security.md`, `docs/reference/ko/embedding-performance-benchmark.md`, `Multi-Provider-Search-Performance-Testing.md`, `prd-vector-search-stability-2025-10.md`
- `env.example`(기준값 env 세 개가 모델 척도라는 주석), CHANGELOG `[Unreleased]`, GLOSSARY(위 여섯 항목), `docs/operations/ko/scripts-index.md`(`backup:embeddings` 줄 삭제, PR 2)
- 이력 문서(`specs/`, `docs/reports/`, `docs/blog/`, `docs/analysis/`, `docs/plans/`, 벤치마크 fixture)는 고치지 않는다.
- 종료 검사. `git grep -n -E 'MiniLMEmbeddingService|MINILM_MODEL_ID|MINILM_MODEL_NAME|__minilmModelLoadWarningShown|Xenova/paraphrase-multilingual' -- ':!CHANGELOG.md' ':!specs/**' ':!docs/reports/**' ':!docs/blog/**' ':!docs/analysis/**' ':!docs/plans/**' ':!docs/adr/**'` 결과가 0 이다.

## 대안

- **블루/그린.** 새 provider 값과 새 vec 테이블에 새 벡터를 쌓고 한 번에 넘긴다. 되돌리기가 즉시다. provider 열거 10여 곳, vec 테이블과 트리거 마이그레이션(스키마 변경), 이주 중 저장 공간 두 배가 든다. 얻는 것은 되돌리기 8분 단축이다. 기각.
- **사상을 `cosineDistanceToSimilarity` 에 넣어 모든 유사도를 한 척도로.** 기억끼리 최근접 이웃의 절반이 1.0 으로 포화한다. 기각.
- **검색 상수를 raw 척도에서 다시 맞추기.** 측정하지 않았고 모델별 상수가 10여 개가 된다. 기각.
- **기억끼리 비교용 `query: ` 벡터를 따로 저장.** 벡터가 두 배이고 이웃 겹침 81% 라 근거가 없다. 기각.
- **별도 이주 작업.** reconciliation 과 같은 일을 하는 장치가 둘이 되고, 이주만 끄는 설정 키가 따로 필요하다. 마름 판정으로 기각.
- **multilingual-e5-small.** 주입 상위 5 는 같다(짝 비교 -0.8%p [-1.9, 0.0]). 분포가 0.85 근처에 몰려 기준값을 0.85~0.95 폭에서 다뤄야 하고, 기준값 그대로면 Sleep consolidation 이 1,067건 중 1,064건을 한 군집으로 합친다. 사용자가 한국어 모델로 정했다.
- **두 모델 동시 상주(검색용과 비교용).** 메모리가 약 +340MB 라 운영 1GiB 한도에 닿는다. 범위 밖.

## 위험

| 위험 | PR | 보는 것 |
|---|---|---|
| 이주 중 CPU 와 메모리. 기동 직후 CPU 급등과 겹친다 | 6, 8 | 리허설의 1GiB cgroup peak RSS 와 이주 속도. 운영 CPU 한도는 모른다 |
| 기동 직후 첫 질의가 다른 제공자로 넘어간다(벤치 첫 질의 이상값과 증상이 같다) | 8 | 결정 2 의 2단계 기록, 전환 뒤 응답 메타데이터의 `query_embedding_providers` |
| 패널을 통과해도 Sleep consolidation 규모가 1.2~1.6배 | 8 | 전환 뒤 첫 배치의 군집 수와 크기, 5번 백업 |
| 관련성 축척 1.5 가 held-out 에서 확인되지 않으면 knowledge_update 한 문항 하락이 실제 지침 갱신에서 나타난다 | 8 | 지표 2(주입 적중), 지침 반복 수 |
| PR 범위 게이트(400행)와 perf-smoke(p95 2배 여유)는 재지 않았다. 질의 지연 중앙값은 4.2ms → 6.4ms 다 | 8 | 결정 2 의 1단계, 전환 PR 의 CI |
| sidecar 없는 stdio 전용 설치는 이주 반복이 없어 약 2주 동안 의미 검색이 차례로 찬다 | 6, 8 | 회사 설치 형태(결정 1 의 확인 항목과 같다) |
| 다른 기계에서 변환 결과가 달라진다 | 7, 8 | sha256 대조가 게시 전에 막는다. C 는 CI 와 Docker 빌드 호스트마다 변환하니 이 위험을 매번 진다 |
| 설치 크기 +135MB(gzip 84MB)를 다른 제공자를 쓰는 설치도 진다 | 8 | 기본 설치는 첫 사용 때 받던 것과 크기가 같다 |
| 측정이 주인 한 사람의 기억과 생성한 질문(실제 질문 8건)에 기댄다 | 8 | 전환 뒤 지표 2 |

## 참고

- 이슈 [#1729](https://github.com/jee1/memento/issues/1729), [#1731](https://github.com/jee1/memento/issues/1731), [#1732](https://github.com/jee1/memento/issues/1732), [#889](https://github.com/jee1/memento/issues/889), [#1225](https://github.com/jee1/memento/issues/1225), [#806](https://github.com/jee1/memento/issues/806), [#1180](https://github.com/jee1/memento/issues/1180), [#1399](https://github.com/jee1/memento/issues/1399)
- [임베딩 설정 가이드](../guides/ko/embedding-configuration.md), [검색 랭킹 공식](../agents/search-ranking.md), [Docker 배포 절차](../operations/ko/docker-deploy-procedure.md), [GLOSSARY](../../GLOSSARY.md)
- 원본 모델 카드 [dragonkue/multilingual-e5-small-ko-v2](https://huggingface.co/dragonkue/multilingual-e5-small-ko-v2), 기반 모델 [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
- [GitHub Git LFS 요금](https://docs.github.com/en/billing/concepts/product-billing/git-lfs), [npm trusted publishers](https://docs.npmjs.com/trusted-publishers)
