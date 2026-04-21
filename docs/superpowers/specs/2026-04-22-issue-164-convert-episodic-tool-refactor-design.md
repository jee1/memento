# Design: ConvertEpisodicToSemanticTool.handle() 함수 분리 (Issue #164)

**Date:** 2026-04-22  
**Issue:** [#164](https://github.com/jee1lee/memento/issues/164)  
**Status:** Approved

---

## 문제

`ConvertEpisodicToSemanticTool.handle()`이 344줄, complexity 43, 중첩 깊이 9로 단일 메서드가 너무 많은 책임을 진다.

현재 `handle()`이 하는 일:
1. Zod 파라미터 파싱
2. DB 가용성 체크
3. 단일 메모리 조회 (skip_converted 로직 포함)
4. 배치 메모리 조회 (WHERE절 동적 빌더)
5. 이미 변환된 ID 일괄 조회 (N+1 방지)
6. 배치 처리 루프 (BATCH_SIZE=3, Promise.all)
7. 성공 경로: semantic update + confidence 수집 + DB 상태 업데이트
8. 실패 경로(triple 없음): retry count + DB 상태 업데이트
9. 예외 경로: 에러 분류 + DB 상태 업데이트

---

## 결정

- **분리 방식**: 같은 파일 내 private 메서드 (별도 파일 없음)
- **기존 패턴**: `remember-tool.ts`의 private 메서드 패턴과 동일하게 맞춤
- **테스트 전략**: 리팩토링 전 미커버 경계 케이스 테스트 추가 → 그린 확인 → 분리

---

## 아키텍처

```
ConvertEpisodicToSemanticTool
├─ handle()                          파싱 + 오케스트레이션 (~40줄, complexity ~5)
│
├─ private resolveMemories()         [조회 진입점]
│    ├─ memory_id 있으면 → fetchSingleMemory()
│    └─ 없으면 → fetchBatchMemories()
│
├─ private fetchSingleMemory()       단일 조회 + skip_converted 처리 (~40줄)
├─ private fetchBatchMemories()      배치 조회 + WHERE절 동적 빌더 (~35줄)
├─ private fetchAlreadyConverted()   N+1 방지 일괄 converted ID 조회 (~20줄)
│
├─ private convertSingleMemory()     항목 처리 진입점 + try/catch (~25줄)
│    ├─ 성공 → handleConversionSuccess()
│    ├─ triple 없음 → handleNoTriples()
│    └─ 예외 → handleConversionError()
│
├─ private handleConversionSuccess() semantic update + confidence + DB 업데이트 (~60줄)
├─ private handleNoTriples()         retry count + DB 업데이트 (~40줄)
└─ private handleConversionError()   에러 분류 + DB 업데이트 (~30줄)
```

목표: 각 private 메서드 complexity **10 이하**.

---

## 타입 정의

파일 상단(클래스 외부)에 추가:

```ts
type EpisodicMemoryRow = {
  id: string;
  content: string;
  importance: number;
};

type ConversionResults = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  semantic_memory_ids: string[];
};
```

---

## 메서드 시그니처

```ts
private resolveMemories(
  db: Database.Database,
  memoryId: string | undefined,
  skipConverted: boolean,
  retryFailed: boolean,
  limit: number,
): Promise<EpisodicMemoryRow[] | ToolResult>

private fetchSingleMemory(
  db: Database.Database,
  memoryId: string,
  skipConverted: boolean,
): Promise<EpisodicMemoryRow[] | ToolResult>

private fetchBatchMemories(
  db: Database.Database,
  skipConverted: boolean,
  retryFailed: boolean,
  limit: number,
): EpisodicMemoryRow[] | ToolResult

private fetchAlreadyConverted(
  db: Database.Database,
  memories: EpisodicMemoryRow[],
  skipConverted: boolean,
): Set<string>

private convertSingleMemory(
  episodicMemory: EpisodicMemoryRow,
  extractionResult: ExtractionResult,
  db: Database.Database,
  context: ToolContext,
  results: ConversionResults,
): Promise<void>

private handleConversionSuccess(
  episodicMemory: EpisodicMemoryRow,
  extractionResult: ExtractionResult,
  db: Database.Database,
  context: ToolContext,
  results: ConversionResults,
): Promise<void>

private handleNoTriples(
  episodicMemory: EpisodicMemoryRow,
  extractionResult: ExtractionResult,
  db: Database.Database,
  results: ConversionResults,
): Promise<void>

private handleConversionError(
  episodicMemory: EpisodicMemoryRow,
  error: unknown,
  semanticUpdateStarted: boolean,
  db: Database.Database,
  results: ConversionResults,
): Promise<void>
```

`resolveMemories`와 `fetchSingleMemory`는 조기 종료가 필요한 경우 `ToolResult`를 반환하고, `handle()`에서 `instanceof` 또는 sentinel로 구별한다.

---

## 데이터 흐름

```
handle(params, context)
  1. ConvertEpisodicToSemanticSchema.parse(params)
  2. db 체크
  3. resolveMemories() → EpisodicMemoryRow[] 또는 조기 ToolResult 반환
  4. fetchAlreadyConverted() → Set<string>
  5. filter: toProcess = memories.filter(not in converted set)
  6. results.skipped += (memories.length - toProcess.length)
  7. new TripleExtractionService()
  8. for batch chunks (BATCH_SIZE=3):
       Promise.all(extractTriples per item)
       for each item: convertSingleMemory() — results 뮤테이션
  9. return createSuccessResult(results)
```

`results` 객체는 `convertSingleMemory()` 내부에서 직접 뮤테이션 (현재 동작 유지, 반환값 없음).

---

## 테스트 전략

### 순서

1. **테스트 추가** (미커버 경계 케이스 5개) → `npm test` 그린 확인
2. **리팩토링** — private 메서드 단계별 추출
3. **각 추출 후 `npm test`** — 레드가 되면 즉시 되돌리기

### 추가할 테스트 케이스

| 테스트 | 검증 내용 |
|--------|-----------|
| `skip_converted=false` + 이미 변환된 단일 메모리 | 재처리 시도됨 (skipped=0) |
| `retry_failed=true` + `skip_converted=false` 조합 | 성공 포함 모든 항목 재처리 |
| 배치에서 일부 성공 + 일부 실패 혼합 | `success + failed = total` |
| `limit=2`, episodic 3개 → 2개만 처리 | `total=2` |
| `triple_extracted_status='abandoned'` 항목 → 배치 제외 | `total`에 포함 안 됨 |

---

## 구현 순서 (리팩토링 단계)

1. 타입 `EpisodicMemoryRow`, `ConversionResults` 파일 상단에 추가
2. `fetchSingleMemory()` 추출 → 테스트 통과 확인
3. `fetchBatchMemories()` 추출 → 테스트 통과 확인
4. `resolveMemories()` 추출 (fetchSingle/fetchBatch 위임) → 테스트 통과 확인
5. `fetchAlreadyConverted()` 추출 → 테스트 통과 확인
6. `handleConversionSuccess()` 추출 → 테스트 통과 확인
7. `handleNoTriples()` 추출 → 테스트 통과 확인
8. `handleConversionError()` 추출 → 테스트 통과 확인
9. `convertSingleMemory()` 추출 (3개 핸들러 위임) → 테스트 통과 확인
10. `handle()` 최종 정리 → 전체 테스트 통과 확인

---

## 성공 기준

- `handle()` 줄 수: 344 → ~40
- `handle()` complexity: 43 → ~5
- 중첩 깊이: 9 → ~3
- 기존 테스트 8개 + 신규 5개 = 13개 모두 통과
- 동작 변경 없음 (순수 구조 리팩토링)
