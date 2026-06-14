# Recall 성능 튜닝

recall 호출이 느릴 때 원인을 파악하고 개선하기 위한 방법을 설명합니다. 크게 세 가지 도구가 있습니다: 프로파일링 환경 변수, procedural 버전 인덱스, 그리고 앵커 기반 지역 검색으로의 전환입니다.

## 프로파일링 활성화

recall의 처리 시간을 측정하려면 `MEMENTO_RECALL_PROFILE=1` 환경 변수를 설정합니다. 이 변수가 활성화된 상태에서 recall 호출이 성공하면, 서버 로그에 `recall_profile` 메시지와 함께 `total_ms` 필드(전체 처리 시간, 밀리초)가 출력됩니다.

```bash
MEMENTO_RECALL_PROFILE=1 npm run dev
```

`total_ms`가 예상보다 높게 나타나면, FTS5 인덱스 상태·임베딩 계산 시간·procedural 버전 필터링 중 어느 단계가 병목인지 확인해야 합니다. 이 변수는 기본값이 비활성화이므로 프로덕션에서는 필요할 때만 켜고, 측정이 끝나면 다시 제거합니다.

## Procedural 버전 인덱스

마이그레이션 014는 procedural 메모리의 버전 체인 조회와 최신 버전 필터링 성능을 개선하기 위해 두 개의 인덱스를 추가했습니다.

- `idx_memory_item_procedural_version_series`: `(type, version_series_id)` — partial 인덱스, `type = 'procedural'` 조건
- `idx_memory_item_procedural_version`: `(type, version_series_id, version)` — partial 인덱스, `type = 'procedural'` 조건

recall에 `version_filter` 옵션을 사용할 때, 이 인덱스들이 없으면 procedural 기억 전체를 스캔해야 하므로 기억 수가 늘어날수록 성능이 급격히 저하됩니다. 마이그레이션 014가 적용되지 않은 환경에서는 `npm run db:migrate`를 실행하여 인덱스를 추가하십시오.

## FTS5 전문 검색

recall의 텍스트 검색과 하이브리드 검색은 `memory_item_fts`(FTS5 가상 테이블)를 사용합니다. FTS5 인덱스가 없거나 사용 불가 상태인 경우 자동으로 기본 LIKE 검색으로 전환되는데, 이 경우 텍스트 검색 성능이 크게 떨어집니다. FTS5 설정은 `packages/memento-core/src/domains/search/` 내의 검색 엔진과 DB 초기화 스키마에서 확인할 수 있습니다.

## 앵커 기반 지역 검색 (search_local)

recall은 전체 메모리 공간을 대상으로 검색합니다. 이미 관련 컨텍스트가 특정 앵커 주변에 집중되어 있다는 사실을 알고 있다면, `recall` 대신 `search_local` MCP 도구를 사용하는 것이 더 효율적입니다.

`search_local`은 지정된 앵커 슬롯(A, B, C)을 기준으로 hop 거리 내의 메모리만 탐색합니다. 탐색 공간이 좁기 때문에 대규모 메모리 데이터베이스에서 recall보다 훨씬 빠르게 결과를 반환합니다.

```json
{
  "name": "search_local",
  "arguments": {
    "agent_id": "default",
    "slot": "A",
    "query": "관련 질의",
    "hop_limit": 3,
    "limit": 10
  }
}
```

앵커 슬롯의 기본 hop_limit 설정은 슬롯별로 다릅니다. Slot A는 hop_limit=2·threshold=0.7(가장 좁은 범위), Slot B는 hop_limit=3·threshold=0.6(중간 범위), Slot C는 hop_limit=5·threshold=0.5(넓은 범위)입니다. 작업 컨텍스트가 명확할수록 hop_limit이 작은 슬롯을 선택하는 것이 성능에 유리합니다.

앵커 시스템의 전체 사용법은 [앵커 연결 확인 방법](./how-to-check-anchor-connections.md) 문서를 참고하십시오.
