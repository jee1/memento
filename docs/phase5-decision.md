# Phase 5.2: 정책 정합성 방향 결정

## 의사결정 결과

### 결정: 옵션 3 (중간 지점) 채택

**핵심 원칙 준수:**
- "AI Agent가 직접 사용하는 핵심 기능만 MCP에 노출"
- "시스템 관리자용 기능은 HTTP API로만 제공"

## 도구 분류

### MCP 클라이언트 도구 (11개)

#### 1. 핵심 메모리 관리 (5개)
- `RememberTool` - 기억 저장
- `RecallTool` - 기억 검색
- `ForgetTool` - 기억 삭제
- `PinTool` - 기억 고정
- `UnpinTool` - 기억 고정 해제

#### 2. 고급 메모리 기능 (2개)
- `MemoryInjectionPrompt` - 관련 기억을 프롬프트에 주입 (AI Agent가 컨텍스트 주입 시 사용)
- `GetMemoryNeighborsTool` - 메모리 이웃 조회 (AI Agent가 관련 기억 탐색 시 사용)

#### 3. 앵커 시스템 (4개)
- `SetAnchorTool` - 앵커 설정 (AI Agent가 컨텍스트 관리 시 사용)
- `GetAnchorTool` - 앵커 조회 (AI Agent가 컨텍스트 조회 시 사용)
- `SearchLocalTool` - 앵커 주변 검색 (AI Agent가 앵커 주변 검색 시 사용)
- `ClearAnchorTool` - 앵커 제거 (AI Agent가 앵커 제거 시 사용)

### HTTP 관리 API로만 제공 (4개)

#### 관리/운영성 기능
- `RestoreAnchorsTool` - 앵커 복원 (시스템 초기화/복구 시 사용)
- `MigrateEmbeddingsTool` - 임베딩 마이그레이션 (관리자 작업)
- `ConvertEpisodicToSemanticTool` - 일화기억을 의미기억으로 변환 (일괄 변환 작업)
- `GetMetaMemoryStatsTool` - 메타 메모리 통계 조회 (관리자 통계 조회)

## 결정 근거

### 옵션 비교

#### 옵션 1: 규칙 문서 업데이트 (실제 구현에 맞춤)
- ❌ 규칙 문서의 핵심 원칙과 모순
- ❌ 관리 기능이 MCP에 노출됨

#### 옵션 2: 실제 구현 수정 (규칙 문서에 맞춰 5개만)
- ❌ AI Agent가 사용할 수 있는 유용한 기능들 제거
- ❌ 기존 사용자에게 영향

#### 옵션 3: 중간 지점 (핵심 5개 + AI Agent 사용 가능 기능) ✅
- ✅ 규칙 문서의 핵심 원칙 준수
- ✅ 관리 기능을 HTTP API로 분리하여 보안성 확보
- ✅ AI Agent가 실제로 사용하는 유용한 기능들 유지
- ✅ 실용성과 원칙의 균형

## 규칙 문서 업데이트 필요 사항

1. "5개만" → "AI Agent가 직접 사용하는 핵심 기능만 노출"로 변경
2. 구체적인 도구 목록 명시 (11개)
3. 관리 기능은 HTTP API로만 제공 명시

## 다음 단계

- Phase 5.3: 관리/운영성 도구 분리 (4개 도구를 MCP에서 제거하고 HTTP API로 이동)
- Phase 5.4: 규칙 문서 업데이트
