# Recall 성능 튜닝

**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) Phase 2 B (성능 최적화)

## 프로파일링

- **환경 변수**: `MEMENTO_RECALL_PROFILE=1` 로 설정하면 recall 호출 성공 시 로그에 `recall_profile` 메시지와 `total_ms`(전체 처리 시간, 밀리초)가 출력됩니다.
- 용도: recall 지연 원인 파악 및 튜닝 시 데이터 수집. 기본값은 비활성화입니다.

## 인덱스 (Procedural 버전 조회)

- **마이그레이션 014**에서 추가된 인덱스:
  - `idx_memory_item_procedural_version_series`: `(type, version_series_id)` (partial, `type = 'procedural'`)
  - `idx_memory_item_procedural_version`: `(type, version_series_id, version)` (partial, `type = 'procedural'`)
- procedural 버전 체인·최신 버전 조회 및 recall의 `version_filter` 후처리 성능 향상에 사용됩니다.

## FTS5 전문 검색

- recall의 텍스트/하이브리드 검색은 `memory_item_fts`(FTS5 가상 테이블)를 사용합니다.
- FTS5 사용 불가 시 자동으로 기본 검색으로 전환됩니다. 자세한 설정은 `src/domains/search/algorithms/search-engine.ts` 및 DB 초기화 스키마를 참고하세요.
