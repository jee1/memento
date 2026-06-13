# LongMemEval-S 실제 데이터 검증

이 문서는 이슈 #483의 실제 LongMemEval-S retrieval 및 task-completion 검증 절차를 정의한다. 원본 데이터는 저장소에 포함하지 않는다.

## 출처와 라이선스

- 공식 코드: <https://github.com/xiaowu0162/LongMemEval>
- 공식 cleaned dataset: <https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned>
- 논문: <https://arxiv.org/abs/2410.10813>
- 코드 저장소 라이선스: MIT
- 데이터셋 카드 라이선스: MIT
- 고정 dataset revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`
- 확인한 공식 코드 revision: `9e0b455f4ef0e2ab8f2e582289761153549043fc`

라이선스와 revision은 2026-06-13에 확인했다. 취득 시점에 dataset card의 license가 여전히 MIT인지 다시 확인한다.

## 데이터 취득

Node.js 24 이상에서 다음 명령을 실행한다.

```bash
npm run quality:longmemeval:acquire
```

기본 저장 위치는 `.local/longmemeval/longmemeval_s_cleaned.json`이다. `.local/longmemeval/`은 gitignore 대상이며 원본을 커밋하지 않는다. 스크립트는 immutable Hugging Face revision URL에서 파일을 받고 같은 디렉터리에 다음 정보를 담은 `acquisition-receipt.json`을 생성한다.

- source URL과 revision
- SHA-256과 byte size
- dataset card와 license
- `vendored: false`

기존 파일은 자동 덮어쓰지 않는다.

## Retrieval 평가

```bash
npm run quality:longmemeval:validate -- \
  --dataset .local/longmemeval/longmemeval_s_cleaned.json \
  --dataset-revision 98d7416c24c778c2fee6e6f3006e7a073259d48f \
  --output-dir artifacts/longmemeval-s/latest \
  --seed 483
```

adapter는 공식 JSON 배열의 각 history session을 하나의 episodic document로 변환한다. 서로 다른 질문의 history가 섞이지 않도록 `question_id`별 scope 안에서만 검색한다. 30개 abstention 문항처럼 `answer_session_ids`가 없는 문항은 공식 retrieval protocol과 같이 retrieval 지표에서 제외하고 제외 건수를 결과에 기록한다.

공개 대화 안에 credential-like 문자열이 있으면 adapter가 검색 인덱스 생성 전에 마스킹하고 건수를 `results.json`에 기록한다. 원문 credential-like 값은 결과, 로그, fixture에 기록하지 않는다.

모든 baseline은 같은 question scope, session corpus, query, top-k=10, token budget=4096, seed를 사용한다.

| baseline | 구현 |
| --- | --- |
| `grep` | query token의 literal occurrence |
| `fts_only` | SQLite FTS5 BM25 |
| `vector` | 고정 tokenizer 기반 TF-IDF cosine |
| `memento` | FTS와 vector 결과의 deterministic RRF |

`results.json`은 baseline별 R@5, R@10, MRR, NDCG@10을 포함한다. latency와 token 수는 품질 지표와 분리한다.

## Task-completion judge protocol

retrieval 결과만으로 정답 생성 품질을 주장하지 않는다. 외부 reader/judge 또는 사람 검토 결과를 JSONL로 준비한다.

```json
{"question_id":"question-id","hypothesis":"answer","correct":true,"cited_evidence_session_ids":["session-id"],"required_evidence_session_ids":["session-id"],"judge":{"provider":"openai-compatible","model":"model-id","prompt_version":"longmemeval-v1"}}
```

판정 규칙:

1. judge에는 질문, 기준 정답, hypothesis만 제공하고 retrieval 점수는 제공하지 않는다.
2. `correct`는 의미적으로 기준 정답을 충족하는지를 이진 판정한다.
3. `cited_evidence_session_ids`는 hypothesis 작성에 사용한 session만 기록한다.
4. evidence coverage는 required evidence session 중 cited session의 비율이다.
5. judge provider/model/prompt version을 반드시 기록한다.
6. 같은 `question_id`의 중복, unknown question, required evidence 불일치는 실패 처리한다.
7. 비용과 토큰 사용량은 외부 실행 로그 또는 별도 run note에 기록한다.

```bash
npm run quality:longmemeval:validate -- \
  --dataset .local/longmemeval/longmemeval_s_cleaned.json \
  --judge-results /path/to/judge-results.jsonl \
  --dataset-revision 98d7416c24c778c2fee6e6f3006e7a073259d48f \
  --output-dir artifacts/longmemeval-s/latest
```

judge 결과가 없으면 retrieval은 실행하되 task completion은 `judge_results_missing`으로 명시적으로 미실행 처리한다.

## 산출물

- `manifest.json`: dataset revision/hash, seed, Node/platform, vendoring 여부
- `results.json`: retrieval baseline과 task-completion 결과
- `limitations.md`: skip reason, 제외 사례, 해석 제한

데이터가 없으면 명령은 실패를 숨기지 않고 세 파일에 `dataset_missing`과 `not_run`을 기록한다. 커밋된 현재 상태 증거는 `docs/_work/testing/longmemeval-s/latest/`에 있다.

## 결과 해석 제한

- synthetic #455 결과와 실제 LongMemEval-S 결과는 corpus 규모와 질문 유형이 달라 직접적인 절대값 비교가 아니다.
- TF-IDF vector baseline은 외부 embedding 모델 없이 재현성을 우선한 비교선이다.
- task-completion accuracy는 사용한 reader와 judge model에 종속된다.
- retrieval 개선만으로 task completion 개선을 주장하지 않는다.
- graph-RRF는 실제 데이터 gate가 완료되기 전 기본 활성화하지 않는다.
