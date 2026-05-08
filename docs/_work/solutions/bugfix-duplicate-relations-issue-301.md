# Bugfix: Duplicate Relations in SemanticMemoryUpdateService (Issue #301)

## 현상 (Problem)
`SemanticMemoryUpdateService`가 `Episodic Memory`와 `Semantic Memory` 간의 관계(`extracted_from`, `supported_by`)를 생성할 때, 이미 관계가 존재함에도 불구하고 관계 생성을 시도하여 "이미 존재하는 관계입니다"라는 에러 로그가 빈번하게 발생함.

## 원인 (Root Cause)
1. `SemanticMemoryUpdateService.createEpisodicEdge` 메서드에서 `relationGraph.addRelation` 호출 시 `updateOnConflict` 옵션을 명시하지 않음 (기본값 `false`).
2. `RelationGraph` 내부에서 중복 관계 발생 시 던지는 에러 메시지가 `UNIQUE constraint`가 아닌 사용자 정의 메시지(`이미 존재하는 관계입니다...`)로 변경되어 있었음.
3. `SemanticMemoryUpdateService`의 기존 예외 처리 로직은 `error.message.includes('UNIQUE constraint')`만 체크하고 있어, 변경된 사용자 정의 에러 메시지를 걸러내지 못하고 `logger.error`를 기록함.

## 해결 방법 (Solution)
`SemanticMemoryUpdateService.createEpisodicEdge`에서 관계를 생성할 때 `updateOnConflict: true` 옵션을 명시적으로 전달하여 **Upsert(Update or Insert)** 전략을 사용하도록 수정함.

```typescript
// 수정 전
await this.relationGraph.addRelation(
  semanticMemoryId,
  episodicMemoryId,
  'extracted_from',
  {
    confidence,
    metadata: { ... },
    allowCyclic: true
  }
);

// 수정 후
await this.relationGraph.addRelation(
  semanticMemoryId,
  episodicMemoryId,
  'extracted_from',
  {
    confidence,
    metadata: { ... },
    updateOnConflict: true, // Upsert 활성화
    allowCyclic: true
  }
);
```

## 검증 결과 (Verification)
1. **재현 테스트 작성**: 동일한 에피소딕 기억과 시맨틱 기억에 대해 두 번의 `updateSemanticMemory`를 호출하는 테스트 코드를 작성.
2. **수정 전**: 두 번째 호출 시 `logger.error`가 "관계 생성 실패"를 출력하며 테스트 실패.
3. **수정 후**: `updateOnConflict: true` 적용 후 에러 로그 없이 정상적으로 기존 관계를 업데이트하며 테스트 통과.
4. **회귀 테스트**: `semantic-memory-update-service.spec.ts`의 기존 44개 테스트 케이스 모두 통과 확인.

## 교훈 (Lessons Learned)
- 관계 생성과 같이 중복 가능성이 있는 작업에서는 `updateOnConflict` 옵션 사용을 기본적으로 고려해야 함.
- 에러 메시지에 기반한 예외 처리는 메시지 문구가 변경될 경우 취약하므로, 가능하다면 에러 코드나 명시적인 옵션(Upsert)을 사용하는 것이 안전함.
