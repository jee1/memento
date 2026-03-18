# 검색 품질 벤치마크 스냅샷 설계

## 문제 정의
- 현재 검색 품질 측정에는 `precision@K`, `recall@K`, `nDCG@K`, `MRR` 같은 유용한 지표가 이미 존재한다.
- 하지만 현재 Ground Truth 생성 경로는 `random`, `first`, `pattern`, 또는 현재 검색 결과 상위 N개를 기반으로 relevantIds를 만들 수 있어, "적합한 기억이 실제로 조회되는가"를 증명하는 정답셋으로는 부적합하다.
- 또한 기본 Ground Truth 파일은 `data/`에 저장되어 로컬 상태에 의존하므로, CI에서 재현 가능한 품질 게이트로 쓰기 어렵다.

## 목표
1. 현재 DB에 있는 **전체 기억**을 출발점으로 삼아 재현 가능한 검색 코퍼스를 만든다.
2. 코퍼스는 한 시점의 **고정 스냅샷**으로 저장해 CI에서 반복 측정 가능하게 한다.
3. query별 정답셋은 **사람이 라벨링한 relevantIds**만 사용한다.
4. 검색 품질 테스트는 "정답셋이 없으면 0점"이 아니라, **명시적 benchmark fixture가 없으면 실패**하도록 강화한다.

## 비목표
- 운영 중인 라이브 DB를 그대로 매 실행마다 품질 측정에 사용하지 않는다.
- 자동 생성 Ground Truth를 품질 증명의 근거로 사용하지 않는다.
- 이번 범위에서 graded relevance(0/1/2/3)까지 확장하지 않는다. 초기 버전은 이진 relevance만 사용한다.

## 핵심 결정

### 1. 코퍼스는 "현재 전체 기억"에서 추출하되 스냅샷으로 고정한다
- 현재 저장된 전체 기억을 export해서 benchmark 전용 fixture로 저장한다.
- 이후 품질 측정은 라이브 DB가 아니라 fixture 코퍼스 + fixture ground truth를 기준으로 수행한다.
- 코퍼스에는 원본 `memory_id`를 보존하되, benchmark 전용 안정 ID(`bench_mem_000001`)를 함께 저장한다.
- 이유:
  - 현재 DB를 출발점으로 삼으면 실제 데이터 분포를 반영할 수 있다.
  - 안정 ID를 부여하면 DB 재생성이나 import 순서 변경에도 정답셋을 유지하기 쉽다.

### 2. Fixture는 버전 관리되는 디렉터리에 저장한다
권장 구조:

```text
tests/fixtures/search-quality/benchmark-v1/
  manifest.json
  corpus.jsonl
  queries.json
  ground-truth.json
  label-candidates.json
```

- `manifest.json`: benchmark 버전, 생성일, 코퍼스 크기, 제외 규칙, 생성 명령, 라벨링 규칙
- `corpus.jsonl`: 한 줄당 기억 1개(JSON Lines)
- `queries.json`: 사람이 작성한 질의 목록 및 메타데이터
- `ground-truth.json`: query별 relevantIds
- `label-candidates.json`: 라벨링 편의를 위한 후보군 덤프(선택)

`data/`는 임시/로컬 상태가 섞이므로 benchmark 저장 위치로 쓰지 않는다.

### 3. Query는 사람이 작성하고, relevantIds도 사람이 라벨링한다
- Query는 실제 사용자가 할 법한 문장으로 작성한다.
- 기억 본문을 그대로 복붙한 질의는 피한다.
- relevantIds는 사람이 판단한다. 초기 버전은 다음 기준만 쓴다.
  - **relevant**: 이 기억이 있으면 답변 품질이 실질적으로 좋아진다.
  - **not relevant**: 키워드가 겹쳐도 질문에 도움 되지 않는다.
- 애매한 경우는 초반 benchmark-v1에서는 제외한다.

### 4. 라벨링은 전체 코퍼스를 직접 전수검사하지 않고 후보 중심으로 진행한다
- 코퍼스는 전체 기억을 포함하되, 라벨링은 query별 후보군 중심으로 진행한다.
- 후보군 생성 방식:
  1. 현재 검색 엔진 상위 20개
  2. BM25/벡터/하이브리드 결과를 합친 후보군
  3. 랜덤 negative 10개
- 이렇게 하면 전체 코퍼스를 유지하면서도 라벨링 비용을 낮출 수 있다.
- 단, recall 품질을 높이기 위해 라벨링 중 누락이 의심되면 사람이 relevant를 추가할 수 있어야 한다.

### 5. CI에서는 benchmark fixture가 없으면 실패한다
- 로컬 편의를 위한 자동 생성 Ground Truth 경로는 유지하더라도, CI 경로에서는 허용하지 않는다.
- CI 또는 `--strict-benchmark` 모드에서는 다음 조건을 강제한다.
  - `queries.json` 존재
  - `ground-truth.json` 존재
  - Ground Truth가 사람이 확정한 버전임을 `manifest.json`으로 검증
- benchmark fixture가 없거나 불완전하면 테스트를 실패시킨다.

## 데이터 스키마 제안

### `corpus.jsonl`
한 줄당 기억 하나:

```json
{"benchmark_id":"bench_mem_000001","source_memory_id":"mem_1762647608082_2cegr0ixc","type":"episodic","tags":["http","server"],"created_at":"2025-11-08T10:00:00.000Z","content":"HTTP 서버 에러 처리 작업 완료..."}
```

### `queries.json`

```json
[
  {
    "query_id": "q_001",
    "query": "HTTP 서버 에러 처리",
    "language": "ko",
    "category": "incident",
    "notes": "에러 원인과 해결 기억을 찾는 질의"
  }
]
```

### `ground-truth.json`
현재 계산 로직과 호환되는 최소 포맷을 유지한다.

```json
[
  {
    "queryId": "HTTP 서버 에러 처리",
    "relevantIds": ["bench_mem_000012", "bench_mem_000031", "bench_mem_000044"]
  }
]
```

초기 버전은 기존 `GroundTruth` 인터페이스와 호환되도록 `queryId`를 실제 검색어 문자열로 유지한다. 이후 필요하면 `query_id` 기반 확장 포맷으로 마이그레이션한다.

### `manifest.json`

```json
{
  "benchmark_version": "v1",
  "created_at": "2026-03-17T00:00:00.000Z",
  "corpus_size": 0,
  "query_count": 0,
  "ground_truth_count": 0,
  "source": "full-memory-snapshot",
  "labeling_policy": "binary-human-labeled",
  "strict_ci": true,
  "notes": [
    "전체 기억 스냅샷 기반",
    "자동 생성 Ground Truth는 품질 증명에 사용하지 않음"
  ]
}
```

## 구현 방향

### 1. Export 단계
- 현재 DB에서 전체 기억을 읽는다.
- benchmark 전용 안정 ID를 부여한다.
- 민감 정보/비어 있는 내용/중복 여부를 필터링한다.
- `corpus.jsonl`과 `manifest.json`을 생성한다.

### 2. 라벨링 준비 단계
- 사람이 작성한 query 목록을 읽는다.
- 현재 검색 엔진으로 query별 후보군을 만든다.
- 후보군을 `label-candidates.json`에 저장한다.
- 라벨러는 이 파일을 보고 relevantIds를 확정한다.

### 3. 측정 단계
- 품질 측정 코드는 fixture benchmark를 로드한다.
- Ground Truth와 query를 기준으로 실제 검색을 수행한다.
- 결과를 `precision@5/10`, `recall@5/10`, `nDCG@5/10`, `MRR`로 계산한다.
- CI에서는 `manifest.strict_ci === true`가 아니면 실패시킨다.

## 검증 전략
- 단위 테스트
  - corpus loader/validator
  - manifest validator
  - benchmark strict mode 판정
  - benchmark ID ↔ source memory ID 매핑
- 통합 테스트
  - fixture benchmark를 로드해 실제 검색 품질 지표 계산
  - fixture가 없거나 깨졌을 때 실패하는지 검증
- CI 테스트
  - benchmark fixture를 읽어 `test:vector-search-quality:ci`가 통과/실패를 정확히 반영하는지 검증

## 리스크 및 대응
- **리스크: 전체 기억을 그대로 쓰면 노이즈가 많다**
  - 대응: 코퍼스는 전체 기억 기반으로 만들되, 명백한 빈 메모/중복/민감 정보를 export 단계에서 필터링
- **리스크: relevantIds 라벨링 비용이 크다**
  - 대응: 후보군 중심 라벨링 + query 30~50개부터 시작
- **리스크: source tree가 루트 `src/`와 `packages/memento-core/src/`에 중복 존재한다**
  - 대응: 구현 전 첫 작업에서 canonical source를 확인하고, 필요한 경우 변경을 동기화

## 성공 기준
- benchmark fixture가 버전 관리된다.
- 자동 생성 Ground Truth 없이도 `test:vector-search-quality:ci`가 재현 가능하게 동작한다.
- benchmark fixture가 없거나 사람이 확정하지 않은 데이터면 CI가 실패한다.
- query 30개 이상에 대해 `precision@5`, `recall@10`, `nDCG@10`, `MRR`를 안정적으로 측정할 수 있다.
