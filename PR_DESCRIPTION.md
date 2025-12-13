# feat: recall tool에 자동 앵커 설정 및 이웃 기억 포함 기능 추가

## 📋 개요

`recall` 도구에 **자동 앵커 설정** 및 **자동 이웃 기억 포함** 기능을 추가하여 검색 후 맥락 관리와 관련 정보 확장을 자동화합니다.

## 🎯 주요 기능

### 1. 자동 앵커 설정 (`auto_set_anchor`)
- 검색 결과의 첫 번째 항목을 슬롯 A에 자동으로 앵커로 설정
- 슬롯 회전 규칙: A → B → C → 제거 순서로 이동
- 슬롯 A의 pinned 앵커는 보호 (건너뛰기)
- 슬롯 B/C의 pinned 앵커는 경고 후 회전 규칙에 따라 이동/제거

### 2. 자동 이웃 기억 포함 (`include_neighbors`)
- 검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함
- 병렬 처리로 성능 최적화 (최대 2.5초 타임아웃)
- 개별 조회 타임아웃: 2초
- 유사도 임계값 필터링 지원

## 🔧 새로운 파라미터

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `auto_set_anchor` | boolean | `false` | 가장 관련성 높은 기억을 슬롯 A에 자동 앵커로 설정 |
| `include_neighbors` | boolean | `false` | 검색 결과의 상위 항목에 이웃 기억 자동 포함 |
| `neighbors_limit` | number | `3` | 이웃 기억을 포함할 상위 결과의 개수 (1-10) |
| `neighbors_per_item` | number | `5` | 각 검색 결과 항목당 조회할 이웃 기억의 최대 개수 (1-50) |
| `neighbors_similarity_threshold` | number | `0.8` | 이웃 기억 조회 시 유사도 임계값 (0.0-1.0) |

## 📊 변경 통계

- **파일 변경**: 4개 파일
- **추가된 코드**: +3,192줄
- **테스트**: 73개 테스트 모두 통과 ✅

## 🔄 주요 변경사항

### 구현
- ✅ `RecallSchema`에 새로운 파라미터 추가 및 검증
- ✅ 자동 앵커 설정 로직 구현 (`handleAutoSetAnchor`)
- ✅ 자동 이웃 기억 포함 로직 구현 (`handleIncludeNeighbors`)
- ✅ 응답 메타데이터 스키마 확장 (anchor_set, neighbors 필드)
- ✅ 슬롯 회전 로직 구현 (A→B→C→제거)
- ✅ 타임아웃 처리 및 에러 핸들링

### 버그 수정
- ✅ 배열 참조 문제 수정 (`Array.from` 사용)
- ✅ 타임아웃 강제 문제 수정 (Map 기반 완료 상태 추적)
- ✅ 슬롯 회전 로직 PRD 준수 (슬롯 C pinned 시에도 B→C 이동)

### 테스트
- ✅ 73개 단위 테스트 작성 및 통과
- ✅ given/when/then 구조 준수
- ✅ 모든 엣지 케이스 커버

## 🧪 테스트 결과

```bash
npm test -- recall-tool.spec.ts
# Test Files  1 passed (1)
# Tests  73 passed (73)
```

## 🔒 하위 호환성

- ✅ 모든 새 파라미터는 선택적(optional)이며 기본값 `false`
- ✅ 기존 `recall` 호출은 변경 없이 동작
- ✅ 응답 스키마는 기존 구조 유지 (새 필드는 optional)

## 📝 사용 예시

### 기본 사용 (자동 처리 없음)
```typescript
await mcp_memento_recall({
  query: "검색어"
});
```

### 자동 앵커 설정 활성화
```typescript
await mcp_memento_recall({
  query: "검색어",
  auto_set_anchor: true
});
```

### 이웃 기억 포함 활성화
```typescript
await mcp_memento_recall({
  query: "검색어",
  include_neighbors: true,
  neighbors_limit: 3,
  neighbors_per_item: 5,
  neighbors_similarity_threshold: 0.8
});
```

### 전체 기능 활성화
```typescript
await mcp_memento_recall({
  query: "검색어",
  auto_set_anchor: true,
  include_neighbors: true,
  neighbors_limit: 3
});
```

## 📚 관련 문서

- [PRD 문서](./tasks/0012-prd-recall-auto-anchor-neighbors.md)
- [작업 목록](./tasks/tasks-0012-prd-recall-auto-anchor-neighbors.md)

## ✅ 체크리스트

- [x] 코드 리뷰 준비 완료
- [x] 모든 테스트 통과
- [x] 하위 호환성 보장
- [x] 문서 업데이트
- [x] PRD 요구사항 충족

## 🔍 리뷰 포인트

1. **슬롯 회전 로직**: PRD 사양에 맞게 A→B→C→제거 순서로 회전하는지 확인
2. **타임아웃 처리**: 2.5초 데드라인이 엄격하게 준수되는지 확인
3. **에러 핸들링**: 앵커/이웃 기억 조회 실패 시 검색 결과가 정상 반환되는지 확인
4. **성능 영향**: 이웃 기억 조회로 인한 응답 시간 증가가 허용 범위 내인지 확인

