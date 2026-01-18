# Phase 5.1: MCP 도구 노출 정책 정합성 분석

## 현재 상태 분석

### 규칙 문서 요구사항
**파일**: `.cursor/rules/mcp-tools-architecture.mdc`
- MCP 클라이언트 도구는 **5개만** 노출해야 함
- 핵심 메모리 관리 기능만 포함:
  1. `remember` - 기억 저장
  2. `recall` - 기억 검색
  3. `pin` - 기억 고정
  4. `unpin` - 기억 고정 해제
  5. `forget` - 기억 삭제

### 실제 구현 상태
**파일**: `src/tools/index.ts`
- 현재 **14개 도구**가 등록되어 있음

#### 규칙에 포함된 도구 (5개) ✅
1. `RememberTool` - 기억 저장
2. `RecallTool` - 기억 검색
3. `ForgetTool` - 기억 삭제
4. `PinTool` - 기억 고정
5. `UnpinTool` - 기억 고정 해제

#### 규칙에 없는 도구 (9개) ❌

**AI Agent 사용 가능 기능 (6개):**
1. `MemoryInjectionPrompt` - 관련 기억을 프롬프트에 주입 (AI Agent가 사용 가능)
2. `GetMemoryNeighborsTool` - 메모리 이웃 조회 (AI Agent가 사용 가능)
3. `SetAnchorTool` - 앵커 설정 (앵커 시스템, AI Agent가 사용 가능)
4. `GetAnchorTool` - 앵커 조회 (앵커 시스템, AI Agent가 사용 가능)
5. `SearchLocalTool` - 로컬 검색 (앵커 시스템, AI Agent가 사용 가능)
6. `ClearAnchorTool` - 앵커 제거 (앵커 시스템, AI Agent가 사용 가능)

**관리/운영성 기능 (4개):**
7. `RestoreAnchorsTool` - 앵커 복원 (관리 기능)
8. `MigrateEmbeddingsTool` - 임베딩 마이그레이션 (관리 기능)
9. `ConvertEpisodicToSemanticTool` - 일화기억을 의미기억으로 변환 (관리 기능)
10. `GetMetaMemoryStatsTool` - 메타 메모리 통계 조회 (관리 기능)

## 불일치 요약

- **규칙 문서**: 5개 도구만 노출
- **실제 구현**: 14개 도구 등록
- **불일치**: 9개 도구가 규칙에 없음

## 의사결정 필요 사항

다음 단계에서 결정해야 할 사항:
1. 규칙 문서를 업데이트하여 실제 사용 중인 도구들을 포함시킬 것인가?
2. 실제 구현을 수정하여 규칙 문서에 맞춰 5개만 노출할 것인가?
3. 중간 지점: 핵심 5개 + AI Agent가 사용할 수 있는 기능들만 노출하고, 관리 기능은 HTTP API로만 제공할 것인가?

## 다음 단계

Phase 5.2에서 의사결정을 진행하여 정책 정합성 방향을 결정해야 합니다.
