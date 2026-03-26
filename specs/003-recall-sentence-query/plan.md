# Implementation Plan: Recall 검색 품질 개선 — 자연어 쿼리 + TF-IDF Fallback 경고

**Branch**: `003-recall-sentence-query` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)

## Summary

`recall` 및 `memory_injection` 도구의 `query` 파라미터 설명을 자연어 문장 입력 권장 방식으로 변경하고, `recall`/`memory_injection` 실행 중 TF-IDF로 fallback 될 때 stderr 경고와 응답 메타데이터(`embedding_provider`)를 추가한다. 코드 변경은 최소 범위(4개 파일, 모두 `memento-core` 패키지)에 집중된다.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, zod, vitest
**Storage**: N/A (DB 스키마 변경 없음)
**Testing**: vitest (`npm test`, `npx vitest run`)
**Target Platform**: Node.js MCP server (stdio + HTTP)
**Project Type**: MCP server library
**Performance Goals**: 변경 없음 — 문자열 비교/출력만 추가
**Constraints**: MCP 프로토콜 준수 (stderr 사용, stdout 불가)
**Scale/Scope**: 단일 패키지 (`@memento/core`) 내 4개 파일 수정

## Constitution Check

Constitution이 템플릿 상태이므로 프로젝트 CLAUDE.md 기준으로 검토:

- ✅ 타입 안전성: `RecallResponseMetadata`에 optional 필드 추가, 기존 인덱스 시그니처와 호환
- ✅ 하위 호환: `query` 파라미터 타입 변경 없음(문자열), 기존 키워드 쿼리 계속 동작
- ✅ 테스트 필수: 각 변경 사항에 단위 테스트 추가
- ✅ MCP 프로토콜: 경고는 stderr로만 출력 (stdout 오염 없음)
- ✅ 코드 스타일: 2-space indent, single quotes, trailing commas 준수

## Project Structure

### Documentation (this feature)

```text
specs/003-recall-sentence-query/
├── plan.md              ← 이 파일
├── research.md          ← Phase 0 완료
├── data-model.md        ← Phase 1 완료
├── contracts/
│   └── tool-schema-changes.md
└── tasks.md             ← /speckit.tasks 에서 생성
```

### Source Code (변경 대상)

```text
packages/memento-core/src/domains/
├── memory/tools/
│   ├── recall-tool.ts                    ← query 설명 + metadata + 경고 로직
│   ├── memory-injection-prompt.ts        ← query 설명 (Zod + JSON Schema) + 경고 로직
│   └── __tests__/
│       ├── recall-tool.spec.ts           ← TF-IDF fallback 테스트 추가
│       └── memory-injection-prompt.spec.ts ← TF-IDF fallback 테스트 추가
├── embedding/services/
│   ├── unified-embedding-service.ts      ← getCurrentProviderName() 추가
│   └── __tests__/
│       └── unified-embedding-service.spec.ts ← getCurrentProviderName() 테스트
├── search/
│   ├── algorithms/hybrid-search-engine.ts ← SearchBySimilarityOutcome 반환 타입 추가,
│   │                                         쿼리 임베딩 provider 추적 필드 추가
│   └── factories/hybrid-search.factory.ts ← embeddingService 의존성 주입 방식 변경
└── memory/services/
    ├── memory-embedding-service.ts        ← getCurrentProviderName() 반환 타입 정규화
    └── __tests__/
        └── memory-embedding-service.spec.ts

packages/memento-core/src/shared/utils/
└── embedding-provider-diagnostics.ts     ← emitTfidfFallbackWarningIfNeeded() 공유 유틸리티 (신규)

packages/memento-core/src/
└── bootstrap.ts                          ← queryEmbeddingService 별도 인스턴스 분리

Note: src/ 루트 디렉터리의 동일 파일들도 레거시 코드베이스 동기화 목적으로 함께 수정됨
```

## Implementation Tasks

### Task 1: recall-tool.ts — query 파라미터 설명 변경

**파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`
**위치**: 라인 405-407

**변경 내용**:
```typescript
// Before
description: '검색 쿼리 (type이 core 또는 vault가 아닌 경우 필수). memory_types만 제공된 경우에도 query는 필수입니다.'

// After
description: '검색할 내용을 자연어 문장으로 입력하세요 (예: \'지난번에 JWT 토큰 만료 처리한 방법이 뭐였지?\'). 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다. type이 core 또는 vault가 아닌 경우 필수이며, memory_types만 제공된 경우에도 query는 필수입니다.'
```

**테스트**: 기존 recall 테스트가 계속 통과하는지 확인 (회귀 방지)

---

### Task 2: memory-injection-prompt.ts — query 파라미터 설명 변경

**파일**: `packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts`

**변경 내용** (두 곳):
1. Zod schema (라인 18-19):
   ```typescript
   // Before
   query: z.string().describe('검색할 쿼리')
   // After
   query: z.string().describe('검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.')
   ```

2. JSON Schema (라인 34-36):
   ```typescript
   // Before
   description: '검색할 쿼리'
   // After
   description: '검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.'
   ```

---

### Task 3: unified-embedding-service.ts — getCurrentProviderName() 추가

**파일**: `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts`

**변경 내용**: `currentProviderName` private 필드를 읽는 public 메서드 추가

```typescript
/**
 * 마지막으로 사용된 임베딩 제공자 이름 반환 (진단용)
 * recall 도구에서 TF-IDF fallback 감지에 사용됨
 */
getCurrentProviderName(): EmbeddingProvider | null {
  return this.currentProviderName;
}
```

**테스트**: `unified-embedding-service.spec.ts`에 getter 테스트 추가

---

### Task 4: recall-tool.ts — TF-IDF fallback 경고 + metadata 추가

**파일**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`

**위치**: 기존 `metadata.fallback_used` 할당 블록(라인 1070-1076) 이후

**변경 내용**:
1. `RecallResponseMetadata` 인터페이스에 `embedding_provider?: string` 추가 (라인 86-97 근처)
2. search 완료 후 embedding provider 감지 및 경고 출력:

```typescript
// embedding provider 감지 (recall/memory_injection 맥락에서만)
const usedProvider = context.services.embeddingService?.getCurrentProviderName?.();
if (usedProvider) {
  metadata.embedding_provider = usedProvider;
  if (usedProvider === 'tfidf') {
    process.stderr.write(
      `⚠️ [Memento] TF-IDF fallback 활성화: 기본 임베딩 제공자 사용 불가. 의미 기반 검색 품질이 저하될 수 있습니다.\n`
    );
  }
}
```

**테스트** (`recall-tool.spec.ts`에 추가):
- TF-IDF fallback 시 stderr에 경고 출력 검증
- TF-IDF fallback 시 `embedding_provider: 'tfidf'`가 메타데이터에 포함 검증
- MiniLM 정상 동작 시 경고 미출력 검증

---

## Acceptance Verification

모든 task 완료 후 다음을 확인:

```bash
# 1. 타입 체크
npm run type-check

# 2. 린트
npm run lint

# 3. 전체 테스트
npm test

# 4. recall-tool 단위 테스트만
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts
```

**SC 검증 체크리스트**:
- [ ] SC-001: `recall` 및 `memory_injection` query 설명에 "자연어 문장"이라는 표현 포함
- [ ] SC-002: TF-IDF fallback 시 stderr 경고 100% 출력 (테스트)
- [ ] SC-003: 기존 테스트 전체 통과
- [ ] SC-004: `recall` 응답 메타데이터에 `embedding_provider` 필드 포함 (테스트)
- [ ] SC-005: MiniLM 정상 동작 시 경고 미출력 (테스트)
