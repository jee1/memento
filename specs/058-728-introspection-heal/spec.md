# Feature Specification: Issue #728 introspection 기반 품질 치유 배치·API

**Feature Branch**: `jee1/feat-memory-introspection-api`
**Created**: 2026-08-12
**Status**: Draft
**Parent Epic**: #727 (Memory quality ops loop)
**Related**: #21 (meta-memory introspection 스캔, 선행), #666 (feedback), #730/#731/#732 (형제 이슈, 별도 PR)

## Problem Statement

`meta_memory_introspection` 배치는 저신뢰(avg_confidence < 0.5)·고실패(failure_count >= 2) 메모리를
스캔해 캐시(`IntrospectionScanCache`)와 `get_introspection_summary` 도구로 노출하지만, **결과를 소비해
실제로 고치는 액션이 없다**. 운영 DB에서 저신뢰 ~979 / 고실패 ~455건이 누적된 채 방치된다.

## Goals

스캔 결과를 다음 4가지 액션으로 전환하는 서비스 + 운영자용 HTTP API를 추가한다.

| 액션 | 조건 | 효과 |
|------|------|------|
| re-embed | provider 기준 임베딩 누락·차원 불일치 | `EmbeddingReindexService`로 재생성 |
| soft-delete | 고실패 + 비핀 + importance < 임계값 | `is_deleted=1` (기존 30일 grace period 재사용) |
| demote | 저신뢰 또는 고실패 (위 두 조건 미해당) | `importance` 하향 (floor까지) |
| review | pinned이거나 이미 floor에 도달 | DB 변경 없음, 응답에 ID만 노출 |

dry-run(기본값)과 apply 모드를 지원하고, 액션별 처리 건수·실패를 반환한다.

## Non-Goals

- 완전 자동 **하드** 삭제 (soft-delete만; hard delete는 기존 grace-period sweep에 위임)
- "저벡터점수"를 re-embed 조건에 포함 — 메모리별 벡터 검색 점수를 추적하는 인프라가 없음 (후속 이슈로 분리)
- LongMemEval 벤치 연동
- MCP 도구로 agent에 노출 — 기존 프로젝트 컨벤션상 대량 스캔·치유형 운영 도구
  (`migrate_embeddings`, `convert_episodic_to_semantic`, `restore_anchors`)는 모두
  `tools/index.ts`(MCP 레지스트리)에서 제외되고 `admin-tools.routes.ts`(HTTP 전용)로만 노출된다.
  본 기능도 동일 패턴을 따른다. 단일 ID를 대상으로 하는 `forget` 도구만 MCP에 남아 있다.
- 신규 BatchScheduler 주기 job (스케줄 자동 실행) — HTTP API가 acceptance criteria를 모두 충족하므로
  1단계 범위에서 제외. 별도 이슈로 분리 가능.

## Assumptions (unratified — 사용자 확인 없이 진행)

브레인스토밍 중 사용자에게 2가지 질문(실행 표면 MCP/HTTP/둘다, apply 모드의 soft-delete 자동 실행 여부)을
했으나 응답이 없었다 (`/goal` 자동 진행 세션). 아래 기본값으로 진행했다. 리뷰 시 이견 있으면 조정 가능.

1. **실행 표면 = HTTP admin route만.** 위 Non-Goals에 근거 설명. MCP 미노출.
2. **apply 모드가 soft-delete를 직접 실행.** 이슈 원문의 효과란("`is_deleted` 큐")과 비범위("완전 자동
   **하드** 삭제만 제외")에 근거. soft-delete는 기존 `ForgettingPolicyService`처럼 30일 grace period 후
   hard delete되는 가역적 메커니즘이라 별도 승인 없이도 안전하다고 판단.

## Design

### 1. `IntrospectionHealingService` (신규)

`packages/memento-core/src/domains/memory/services/introspection-healing-service.ts`

```ts
interface IntrospectionHealOptions {
  dryRun?: boolean;                        // 기본 true
  provider?: EmbeddingProvider;             // 기본 mementoConfig.embeddingProvider
  lowConfidenceThreshold?: number;          // 기본 0.5 (MetaMemoryIntrospectionService와 동일 기본값)
  highFailureCountThreshold?: number;       // 기본 2
  demoteFactor?: number;                    // 기본 0.8, env INTROSPECTION_HEAL_DEMOTE_FACTOR
  minImportance?: number;                   // 기본 0.1, env INTROSPECTION_HEAL_MIN_IMPORTANCE
  softDeleteImportanceThreshold?: number;   // 기본 0.3, env INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD
}

interface IntrospectionHealResult {
  dryRun: boolean;
  provider: EmbeddingProvider;
  scanned: { lowConfidence: number; highFailure: number; union: number };
  reEmbed: { memoryIds: string[]; storedCount: number; failedCount: number };
  softDelete: { memoryIds: string[]; softDeletedCount: number };
  demote: { memoryIds: string[]; demotedCount: number };
  review: { memoryIds: string[] };
  errors: string[];
}
```

매 호출마다 **캐시가 아닌 새 스캔**을 실행한다 (`MetaMemoryIntrospectionService.runScan`). 캐시는
프로세스 로컬이라 재시작 후 비어 있고, 스캔 자체가 인덱스 SELECT 2개라 비용이 낮다.

분류 알고리즘 (union = lowConfidence ∪ highFailure, id당 1회 분류, `is_deleted=0`인 것만):

1. provider 기준 native 임베딩이 없거나 차원 불일치 → **re-embed**
2. `pinned` → **review** (기존 `ForgettingPolicyService`처럼 pinned는 자동 조치 대상에서 완전 제외)
3. highFailure 이고 `importance < softDeleteImportanceThreshold` → **soft-delete**
4. `importance > minImportance` → **demote** (`importance = max(minImportance, importance * demoteFactor)`)
5. 그 외 (이미 floor 도달) → **review**

apply 모드 쓰기:

- re-embed: `EmbeddingReindexService.reindexByIds(ids, { provider, dryRun })` (신규 메서드, 아래 참고)
- soft-delete: `UPDATE memory_item SET is_deleted=1, deleted_at=?, last_accessed=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(pinned,0)=0`
  + `ForgettingEventRepository.insert({ action:'soft', reason:'introspection_heal', policy:'introspection-heal', ... })`
  (감사 로그는 `/admin/forgetting/events`에서 그대로 조회 가능)
- demote: `UPDATE memory_item SET importance = MAX(?, importance * ?) WHERE id = ?`

### 2. `EmbeddingReindexService.reindexByIds()` (확장)

`reindex()`는 provider의 **모든** 메모리를 스캔한다. 치유 대상은 이미 스캔으로 좁혀진 소수 ID이므로
동일한 스토어 로직을 ID 목록에 한정해 재사용하는 메서드를 추가한다 (`hasNativeEmbeddingRow` 등
기존 private 헬퍼 재사용).

### 3. `IntrospectionHealTool` (신규, `BaseTool` 서브클래스, MCP 미등록)

`packages/memento-core/src/domains/memory/tools/introspection-heal-tool.ts`. `MigrateEmbeddingsTool`과
동일한 형태 (zod 파라미터 검증, dry_run 기본값, 성공/실패 카운트 반환). `tools/index.ts`에는 추가하지
않고 `packages/memento-core/src/index.ts`에서만 export한다.

### 4. HTTP route (신규)

`admin-tools.routes.ts`에 `POST /introspection/heal` 추가 (기존 `/embeddings/migrate` 등과 동일 패턴 —
`createToolContext` → `tool.handle()` → 결과 언랩).

### 5. Env 플래그 (문서화 대상)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `INTROSPECTION_HEAL_DEMOTE_FACTOR` | 0.8 | demote 시 importance 곱셈 계수 (0, 1] |
| `INTROSPECTION_HEAL_MIN_IMPORTANCE` | 0.1 | demote 하한선 [0, 1] |
| `INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD` | 0.3 | soft-delete 판단 importance 상한 [0, 1] |

`docs/agents/commands.md`에 위 표를 추가한다.

## Testing

- `introspection-healing-service.spec.ts`: in-memory sqlite, `meta-memory-introspection-service.spec.ts`와
  동일한 스키마 픽스처 재사용. 케이스: (a) dry-run이 DB를 전혀 바꾸지 않음 — 각 테이블 count/값이
  호출 전후 동일함을 명시적으로 assert, (b) apply 모드에서 4개 액션 분류가 각각 올바른 테이블에 반영,
  (c) pinned 메모리는 soft-delete/demote 대상에서 제외되고 review에 들어감, (d) 이미 floor인 메모리는
  demote 대상에서 빠지고 review에 들어감, (e) union 중복 제거(양쪽 셋에 다 있는 ID는 1회만 분류).
- `embedding-reindex-service.spec.ts`에 `reindexByIds` 케이스 추가 (dry-run/정상/실패 카운트).
- HTTP route는 기존 admin route 테스트 컨벤션을 따라 최소 1개 통합 테스트 (`admin-tools.routes` 또는 신규
  spec 파일).

## Docs

- `docs/agents/commands.md`: env 플래그 3개 + 호출 예시 (`curl -X POST /admin/introspection/heal`).
- 운영 가이드: dry-run 먼저 확인 후 apply 실행 권장 문구.
