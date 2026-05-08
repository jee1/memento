# Issue #301 Duplicate Relations - Design (Root Cause + Structural Fix)

## 1. 배경과 문제 정의
Issue #301은 `SemanticMemoryUpdateService`가 Episodic-Semantic 관계(`extracted_from`, `supported_by`)를 반복 생성하는 경로에서 중복 관계가 발생할 때, 불필요한 오류 로그가 발생한 문제다.

최근 패치로 `updateOnConflict: true`가 적용되어 단기 증상은 완화되었지만, 근본적으로는 계층 간 에러 계약 불일치가 남아 있다.

## 2. 근본원인 (RCA)
근본원인은 단일 포인트가 아니라 다음 세 가지의 조합이다.

1. 호출부 정책 누락
- `SemanticMemoryUpdateService.createEpisodicEdge`의 관계 생성 호출에서 중복 허용 정책(`updateOnConflict`)이 누락되면 기본값 `false`로 동작한다.

2. 예외 의미의 변환
- `RelationGraph`는 DB 고유 제약(UNIQUE) 충돌을 내부적으로 처리하며, 일부 경로에서 사용자 친화 메시지(예: "이미 존재하는 관계입니다")로 변환한다.

3. 문자열 기반 분기
- 상위 계층/툴 계층이 `error.message.includes('UNIQUE constraint')`, `includes('이미 존재하는 관계')` 등 문자열 매칭에 의존한다.
- 메시지 문구/언어 변경 시 회귀 위험이 높다.

## 3. 목표
- 중복 관계 처리 계약을 타입 중심으로 안정화한다.
- 호출자별 정책(중복 허용/비허용)을 코드에서 명확히 드러낸다.
- 메시지 기반 예외 분기를 제거해 회귀 가능성을 낮춘다.

## 4. 비목표 (Non-Goals)
- relation schema 변경, migration 추가
- relation scoring/ranking 알고리즘 변경
- API 응답 스키마 대규모 변경

## 5. 설계 제안 (권장안)

### 5.1 타입드 에러 도입
`RelationGraph` 도메인에 명시적 예외 타입을 도입한다.

- `RelationGraphError` (base)
- `DuplicateRelationError`
- `CyclicRelationError`

적용 원칙:
- 중복 + `updateOnConflict=false` -> `DuplicateRelationError`
- 순환 감지 실패 -> `CyclicRelationError`
- 기타 시스템 예외 -> 원본 예외 유지

### 5.2 호출자 정책 명시
호출자별로 중복 처리 정책을 명확히 한다.

- `SemanticMemoryUpdateService`
  - 중복이 정상 시나리오이므로 `updateOnConflict: true`를 명시적으로 유지
  - 문자열 기반 UNIQUE 분기 제거

- `AddRelationTool`
  - 기본적으로 중복 비허용(`updateOnConflict=false`) 유지
  - `instanceof DuplicateRelationError`, `instanceof CyclicRelationError` 기반 매핑
  - 사용자 응답 코드(`DUPLICATE_RELATION`, `CYCLIC_RELATION`)는 유지

### 5.3 에러 처리 규약
- 도메인 예외: 타입으로 분기 (예상 가능한 제어 흐름)
- 시스템 예외: 로깅 + 상위 전파 (운영 장애 신호)
- 금지: `error.message.includes(...)` 기반 제어 흐름

## 6. 데이터/오류 흐름

### 6.1 중복 허용 경로 (SemanticMemoryUpdateService)
1) `addRelation(..., { updateOnConflict: true })`
2) 기존 관계 존재 시 upsert 성공
3) 예외 없이 다음 파이프라인 진행

### 6.2 중복 비허용 경로 (AddRelationTool)
1) `addRelation(..., { updateOnConflict: false })`
2) 중복 발생 시 `DuplicateRelationError`
3) tool 응답 `DUPLICATE_RELATION` 반환

### 6.3 순환 경로
- 순환 감지 시 `CyclicRelationError` -> tool 응답 `CYCLIC_RELATION`

## 7. 구현 범위 (파일 단위)
- `packages/memento-core/src/domains/relation/services/relation-graph.ts`
  - 타입드 에러 throw 경로로 정리
- `packages/memento-core/src/domains/memory/services/semantic-memory/semantic-memory-update-service.ts`
  - 문자열 분기 제거 + typed flow 정리
- `packages/memento-core/src/domains/relation/tools/add-relation-tool.ts`
  - 문자열 분기 제거 + `instanceof` 분기
- (신규) relation domain error types 파일

## 8. 테스트 전략

### 8.1 단위 테스트
- `RelationGraph`
  - 중복 + `updateOnConflict=false` -> `DuplicateRelationError`
  - 중복 + `updateOnConflict=true` -> 기존 relation id 유지/업데이트
  - 순환 -> `CyclicRelationError`

- `SemanticMemoryUpdateService`
  - 동일 관계 재처리 시 에러 로그 없이 성공
  - 문자열 메시지 변경과 무관하게 동작

- `AddRelationTool`
  - `DuplicateRelationError` 매핑 -> `DUPLICATE_RELATION`
  - `CyclicRelationError` 매핑 -> `CYCLIC_RELATION`

### 8.2 회귀 테스트
- 기존 #301 재현 시나리오 고정
- 기존 relation-graph 관련 테스트와의 호환성 확인

## 9. 위험요소 및 완화
- 위험: 에러 타입 전환으로 기존 문자열 의존 테스트 실패
  - 완화: 단계적 치환 + 테스트 먼저 갱신
- 위험: 일부 호출부 누락
  - 완화: 문자열 분기 검색(`includes`) 전수 점검

## 10. 롤아웃 전략
1) 에러 타입 도입 + RelationGraph 내부 적용
2) AddRelationTool 전환
3) SemanticMemoryUpdateService 전환
4) 전체 테스트/린트/타입체크

## 11. 수용 기준 (Acceptance Criteria)
- 문자열 기반 예외 분기 제거 (`relation`, `memory` 관련 핵심 경로)
- #301 시나리오에서 중복 관계 생성 시 오류 로그 미발생
- 수동 relation 추가 시 중복/순환이 안정적으로 도메인 코드로 매핑
- 기존 공용 테스트 세트 통과

## 12. 대안 비교 요약
- 대안 A: 호출부에 upsert만 확대 적용 -> 빠르지만 계약 취약성 잔존
- 대안 B(채택): typed error + 정책 명문화 -> 재발 방지 효과 최대
- 대안 C: 로깅 억제 위주 대응 -> 구조적 문제 미해결
