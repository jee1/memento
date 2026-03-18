# 검색 품질 벤치마크

검색 품질을 CI에서 재현 가능하게 검증하기 위한 벤치마크 fixture 및 워크플로우 설명입니다.

## 개요

- **목적**: 전체 기억 스냅샷을 고정 corpus로 export하고, 사람이 라벨링한 Ground Truth로 검색 품질을 측정합니다.
- **기본 위치**: `tests/fixtures/search-quality/benchmark-v3/`
- **strict 모드**: CI에서는 `manifest.strict_ci === true`, `source === 'full-memory-snapshot'`, `ground_truth_reviewed === true`가 모두 필요합니다.

## 디렉터리 구조

```
tests/fixtures/search-quality/benchmark-v3/
  manifest.json      # 버전, 생성일, strict_ci, source, labeling_policy, ground_truth_reviewed 등
  corpus.jsonl       # 한 줄당 기억 하나 (benchmark_id, source_memory_id, content)
  queries.json       # 사용자-facing benchmark 질의 목록
  ground-truth.json  # queries.json 기준 relevantIds (benchmark_id 기준, 사람 라벨링)
  authoring-queries.json      # benchmark 제작/평가 내부 질문
  authoring-ground-truth.json # authoring-queries.json 기준 라벨 초안
  label-candidates.json  # 라벨링 편의용 후보 덤프 (선택)
```

## 워크플로우

### 1. 코퍼스 export

현재 DB의 전체 기억을 benchmark 전용 안정 ID와 함께 export합니다. **이미 초기화된 DB**(`memory_item` 테이블 존재)가 필요합니다. 워크트리에서 실행 시 메인 저장소 DB를 쓰려면 `DB_PATH`를 지정하세요.

```bash
npm run quality:benchmark:export
# 기존 DB 경로 지정 (예: 메인 저장소 data)
DB_PATH=/path/to/memory.db npm run quality:benchmark:export
# 또는 출력 디렉터리 지정
npm run quality:benchmark:export -- --output-dir tests/fixtures/search-quality/benchmark-v3
# dry-run (파일 미기록)
npm run quality:benchmark:export -- --dry-run
```

`no such table: memory_item`이 나오면 DB가 초기화되지 않았거나 빈 DB를 가리키는 경우입니다. `DB_PATH`로 기억이 있는 DB 경로를 지정하세요.

생성: `corpus.jsonl`, `manifest.json` (기존 `queries.json`, `ground-truth.json`이 있으면 개수도 함께 반영).

### 2. 쿼리 작성

`queries.json`에는 실제 사용자 질의를 유지합니다. 기억 본문 복붙은 피하고, 메타데이터(`query_id`, `language`, `category`, `notes`)를 활용합니다.

- `queries.json`: 사용자 recall 품질을 재는 질문
- `authoring-queries.json`: benchmark 제작/평가용 내부 질문

둘을 섞지 않는 것이 중요합니다. 내부 메트릭·fixture 관리 질문은 `authoring-queries.json`으로 분리하고, strict CI는 기본적으로 `queries.json`만 사용합니다.

### 3. 라벨링 후보 생성

각 쿼리에 대해 현재 검색 엔진 상위 결과 + 랜덤 네거티브를 합쳐 `label-candidates.json`을 만듭니다. **ground-truth.json은 이 스크립트가 쓰지 않습니다.**

```bash
npm run quality:benchmark:candidates -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3 --limit 30 --random-negatives 10
```

### 4. Ground Truth 라벨링

`label-candidates.json`과 코퍼스를 보고, 쿼리별로 **relevant**인 기억의 `benchmark_id`만 `ground-truth.json`의 `relevantIds`에 넣습니다. 사람이 직접 판단합니다.

- **relevant**: 해당 기억이 있으면 답변 품질이 실질적으로 좋아지는 경우
- **not relevant**: 키워드만 겹치고 질문에 도움이 되지 않는 경우

현재 기본 strict fixture는 `benchmark-v3`이며 `ground_truth_reviewed=true`까지 반영되어 있습니다. 새 버전을 만들 때는 사람이 검토를 끝내기 전까지 strict 품질 게이트로 승격하면 안 됩니다.

라벨링 전에 사람이 읽기 쉬운 Markdown 체크리스트를 생성할 수 있습니다.

```bash
npm run quality:benchmark:checklist -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3
```

생성물: `tests/fixtures/search-quality/benchmark-v3/review-checklist.md`

체크리스트를 보며 `ground-truth.json`을 수정한 뒤, 검토 상태를 검증합니다.

```bash
# reviewed=true까지 요구하는 기본 검증
npm run quality:benchmark:verify-review -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3

# 아직 reviewed 플래그를 올리기 전 중간 점검
npm run quality:benchmark:verify-review -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3 --allow-unreviewed
```

- `--allow-unreviewed` 없이 실행하면 `ground_truth_reviewed !== true`인 fixture는 실패합니다.
- 최종 검토가 끝난 뒤에만 `manifest.json`의 `ground_truth_reviewed`를 `true`로 올리십시오.

### 5. CI 품질 테스트 실행

벤치마크 fixture를 사용해 검색 품질 지표를 측정합니다.

```bash
npm run test:vector-search-quality
npm run test:vector-search-quality:ci
```

- 기본 CI는 별도 환경변수가 없으면 `tests/fixtures/search-quality/benchmark-v3`를 사용합니다.
- 다른 benchmark 버전을 실험할 때만 `MEMENTO_SEARCH_BENCHMARK_DIR`로 덮어씁니다.

### 6. 벤치마크 버전 갱신

코퍼스나 쿼리·ground truth를 크게 바꿀 때만 검토 후 버전을 올립니다. 일상적인 라벨 추가/수정은 같은 benchmark 디렉터리 내에서 하고, `manifest.json`의 `corpus_size`, `query_count`, `ground_truth_count`만 필요 시 수동으로 맞춥니다.

## 관련 스크립트

| 스크립트 | 설명 |
|----------|------|
| `npm run quality:benchmark:export` | 전체 기억 → corpus.jsonl + manifest.json export |
| `npm run quality:benchmark:candidates` | queries.json 기준 후보 생성 → label-candidates.json |
| `npm run quality:benchmark:checklist` | review-checklist.md 생성 |
| `npm run quality:benchmark:verify-review` | ground truth / manifest 검증 및 reviewed 상태 확인 |
| `npm run test:vector-search-quality` | 벡터 검색 품질 통합 테스트 (fixture 사용) |
| `npm run test:vector-search-quality:ci` | CI용 품질 테스트 (JUnit/JSON 리포트) |

## 참고

- 설계: `docs/plans/2026-03-17-search-quality-benchmark-design.md`
- 구현 계획: `docs/plans/2026-03-17-search-quality-benchmark.md`
