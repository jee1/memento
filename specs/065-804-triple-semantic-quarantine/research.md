# Phase 0 조사: 자동 triple semantic 격리

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Date**: 2026-08-22

spec의 32회차 브레인스토밍이 대부분의 미지를 실측으로 해소했다. 이 문서는 (1) spec이 명시적으로
plan에 넘긴 결정 하나와, (2) 러너 구현이 의존하는 기존 도구·제약의 확인 결과를 담는다.

---

## 결정 1 — `forget` 호출 방식 (FR-005d)

**Decision**: `@memento/core`가 공개 export하는 **`executeTool`**로 호출한다.

```ts
import { executeTool } from '@memento/core';
const result = await executeTool(
  'forget',
  { batch: ids, hard: true, confirm: true },
  { db, services: {} },
);
```

**Rationale**:
- `ForgetTool` 클래스는 **공개 API가 아니다**. `packages/memento-core/src/index.ts`가 재export하지
  않고, `packages/memento-core/package.json`의 `exports` 맵에도
  `./domains/memory/tools/forget-tool.js` 항목이 없다. 따라서 `tsx`로 러너를 돌리면
  `@memento/core`는 `dist/index.js`로 해석되고 직접 인스턴스화 경로는 **런타임에 해석 실패**한다.
  (vitest는 `@memento/core/<path>.js` → `packages/memento-core/src/<path>.ts` alias가 있어 테스트만
  통과하고 스크립트가 깨지는 함정이 있다 — 이 차이가 이 결정을 강제했다.)
- `executeTool`은 `index.ts:41`에서 export되고, 내부적으로
  `toolRegistry.execute(name, params, context)`를 호출한다. 레지스트리에는 `new ForgetTool()`이
  등록돼 있으므로 **실제 삭제 주체는 여전히 `ForgetTool`**이다 — 계약 불변식 2를 만족한다.
- `context.services?.telemetryService`가 없으면 telemetry 래핑 없이 곧바로 레지스트리로 간다
  (`tools/index.ts:164-174`). 별도 서비스 초기화가 필요 없다.
- `ToolContext`는 `db`와 `services`가 필수지만 `services`의 **모든 항목이 optional**이므로
  `{ db, services: {} }`로 충분하다(`tools/types.ts:41-61`).
  `createToolContext`는 완전한 `ServerServices`를 요구하므로 쓰지 않는다.
- `forget`의 하드 삭제 경로에서 서비스를 쓰는 곳은 `cleanupRelatedData` 하나이고, 거기서도
  `context.services.embeddingService?.isAvailable()`로 optional chaining을 쓴다 — 없으면 건너뛴다.
- 그 경로는 어차피 실효가 없다. vec 삭제가 `rowid`에 TEXT memory id를 넘겨 0행을 지운다.
  실제 연쇄 정리는 FK `ON DELETE CASCADE`와 `memory_embedding_vec_delete`·
  `memory_item_fts_delete` 트리거가 수행하며, 세 트리거 모두 라이브 DB에 실재함을 확인했다.
- MCP 서버·transport를 띄우지 않으므로 FR-008a("러너 외 쓰기 프로세스 없음")를 자연히 만족한다.

**반환 형태** — 러너가 진행 기록을 만들려면 이 구조를 파싱해야 한다.

```ts
// ToolResult.content[0].text 는 JSON 문자열이다 (base-tool.ts:46-55)
const payload = JSON.parse(result.content[0].text) as {
  batch_result: { successful: string[]; failed: Array<{ id: string; error: string }>; total: number };
};
```

**Alternatives considered**:
- *`new ForgetTool()` 직접 인스턴스화*: 위 exports 맵 제약으로 런타임 해석이 실패한다. 통과시키려면
  `packages/memento-core`의 export 표면을 넓혀야 하는데, 그것은 프로덕션 코드 변경이라
  graphify 게이트(헌법 IV)를 깨우고 Non-Goals에도 어긋난다.
- *러너 전용 stdio MCP 세션*: transport 계층을 하나 더 얹을 뿐 얻는 것이 없다. `dispatchTool`
  경유의 이점(동시성·audit)은 단독 프로세스에서는 무의미하다.
- *직접 SQL DELETE*: 이슈 #804의 "기존 도구 사용, 신규 기계 금지" 제약 위반이며 `forget`의
  권한 검사·이벤트 적재를 우회한다.

**주의 1**: `forget`의 배치 상한은 `maxItems: 100`이고 `handleBatchDelete`가 단건을 루프하므로
전체 원자성이 없다. 24,086건이면 **241회 호출**이다. 재개가 기본 경로다(FR-005b).

**주의 2**: `@memento/core`가 `dist/`로 해석되므로 러너 실행 전에
`npm run build -w @memento/core`가 선행되어야 한다(선례: `mcp:tool-surface` 스크립트).

---

## 결정 2 — 사본 프로브 실행 환경 (FR-003d)

**Decision**: before/after 프로브는 `DB_PATH`를 사본으로 지정한 **별도 서버 인스턴스**로
수행한다. 러너와 같은 프로세스에서 하지 않는다.

**Rationale**:
- `memory_injection`은 MCP 도구라 서버가 필요하다.
- 임베딩은 minilm(로컬 ONNX)이 28,427건으로 사실상 전량이라 외부 API 호출이 없다.
- `db:backup`이 online backup API로 DB 페이지 전체를 복사하므로 `memory_item_vec_*` 가상
  테이블도 사본에 따라온다.
- 프로덕션 서버는 이 시점에 켜져 있어도 무방하다 — 정지 구간은 라이브 격리에 한정된다(FR-008b).

**Alternatives considered**:
- *라이브에서 프로브*: `knowledge-context-bundle-builder`가 반환 기억의 `recall_count`·
  `g_value`·`consolidation_score`를 UPDATE하므로 FR-011을 위반하고 SC-001a의 전후 대조를
  자기충족적으로 만든다.

---

## 확인 1 — 연쇄 정리 주체

라이브 DB에서 직접 읽은 결과:

| 정리 방식 | 대상 |
|---|---|
| CASCADE | `memory_item_tag`, `memory_relation`(source·target), `memory_link`(source·target), `feedback_event`, `memory_embedding`, `meta_memory_stats`, `memory_review_candidate`, `memory_provenance`, `agent_memory_promotion_candidate.summary_memory_id` |
| SET NULL | `kg_triple.representative_memory_id`, `anchor.memory_id`, `agent_session.summary_memory_id`, `agent_memory_promotion_candidate.memory_id`·`merge_target_memory_id` |
| FK 없음 | `memory_forgetting_event` |

`memory_embedding_vec_delete`는 provider 분기 없이 5개 vec 테이블을 모두 지우고
`rowid = OLD.id`(= `memory_embedding.id`)를 올바르게 쓴다. 러너는 **`PRAGMA foreign_keys = ON`을
반드시 켜야 한다** — 끄면 `memory_item`만 지워지고 나머지가 통째로 고아가 된다.

## 확인 2 — 판별식 구현

`LIKE`가 아니라 **문자열 위치 비교**를 쓴다.

```sql
substr(content, 1, length(trim(subject))) = trim(subject)
AND substr(content, length(trim(subject)) + 2, 1) = ' '
```

`content LIKE subject || '_ %'`는 `subject` 값을 패턴에 그대로 삽입해 그 안의 `_`·`%`를
와일드카드로 해석한다. 실측상 `subject`에 `_`를 포함한 행이 941건이며, 현재는 세 방식(naive
LIKE / 이스케이프 LIKE / 위치 비교)이 모두 24,086건으로 일치하지만 그것은 우연이다.

`+2`가 공백 위치인 근거: `attachParticle`이 종성 유무·한글 여부와 무관하게 조사를 **정확히
1글자** 붙인다. `subject`·`predicate`·`object`에 앞뒤 공백·개행이 있는 행은 0건이지만 방어적으로
양쪽에 `trim`을 적용한다.

실행 계획은 `idx_memory_item_type`을 탄다. `idx_memory_item_triple`은 `(subject, predicate,
object)` 컬럼 인덱스라 이 쿼리에 쓸 수 없고, 26,137행을 훑어 24,086건을 반환하므로 인덱스가
오히려 무의미하다 — 최적화 대상이 아니다.

## 확인 3 — 백업 도구

`npm run db:backup`은 SQLite online backup API를 쓰고 `<DB_PATH 디렉터리>/backups/`에 만든다.
다만 산출물을 **무조건 신뢰할 수 없다** — 기존 산출물 19개 중 0바이트 파일이 실재하고
(`memory-backup-2026-06-15T12-41-09-792Z.db`) `-wal`·`-shm` sidecar 잔재도 남아 있다. 스크립트에
크기 0 삭제와 sidecar 정리 로직이 **둘 다 있는데도** 그렇다.

따라서 러너는 백업 직후 **크기 대조를 1차 게이트**로 건다(FR-007c). 그 뒤 사본 A 구동
검증(FR-007b)이 내용을 확인한다. 순서가 중요하다 — 부분 파일은 스키마가 온전해 구동에는
성공할 수 있다.

`backups/`에 쌓인 6,899개·5.0GB 중 6,880개는 `backup-manager.ts`의 **마이그레이션 백업**이며
`db:backup` 산출물이 아니다. 누적 정리는 이 작업의 범위 밖이다.

## 확인 4 — 검증 수단의 제약

`sqlite3` CLI에는 `vec0`·`fts5` 모듈이 없어 `memory_item_vec_*`와 `memory_item_fts`를 열 수
없다. SC-005의 "벡터·전문 검색 인덱스 잔재 0행"은 **확장을 로드한 경로**로 확인해야 한다 —
사본에 붙인 서버 인스턴스나 확장을 로드한 스크립트를 쓴다(FR-006j).

## 확인 5 — 디스크

여유 493GB. 라이브 548MB + 사본 A + 사본 B + 각각의 `VACUUM` 임시 공간(각 DB 크기만큼)을 모두
수용한다. `freelist_count`가 98페이지뿐이라 단편화가 거의 없으므로 `VACUUM` 회수량은 실제
삭제분에 비례한다.

## 확인 6 — DB 열기 규율

`@memento/core`의 `initializeDatabase()`는 **읽기 전용이 아니다**. 기존 DB를 감지하면
`migrateExistingDatabaseIfNeeded()`를 돌리고 `ensureMetaMemoryStatsSchema`·
`ensureMemoryReviewCandidateSchema`·`ensureQualityAssuranceSchema`·
`ensureMemoryItemTripleExtractionColumns`·`ensureMemoryEmbeddingMetadataDefaults`를 실행한다
(`infrastructure/database/sqlite/init.ts:30-70`). 즉 **호출만 해도 라이브 DB에 쓴다.**

따라서 러너는 `initializeDatabase`를 쓰지 않고 `better-sqlite3`를 직접 연다.

| 명령 | 여는 방식 | 이유 |
|---|---|---|
| `report`, `export-relations` | `new Database(path, { readonly: true })` | SC-004("행 수도 내용도 불변")를 약속이 아니라 **구조**로 만든다 |
| `rehearse`, `execute`, `cleanup`, `vacuum` | `new Database(path)` + `PRAGMA foreign_keys = ON` 실행 후 **되읽어 확인** | better-sqlite3는 FK를 기본 **OFF**로 연다. 켜지지 않으면 게이트 2(종료 코드 11)로 중단 |

`scripts/lib/cli.ts`의 `openDb(filename, options)`가 이미 `better-sqlite3` 래퍼이므로 그것을 쓴다.

## 미해결

**실행 소요 시간** 하나. 설계로 정할 수 없고 사본 B 전량 리허설이 산출한다(FR-006c). 그 값이
서버 정지 창구 산정의 근거가 된다.
