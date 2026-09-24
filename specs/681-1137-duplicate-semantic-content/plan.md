# #1137 중복 본문 semantic 기억 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** triple 재조립 실패가 같은 본문의 semantic 기억 사본을 만들지 못하게 하고, 기존 1,566행 부채를 정리하며, `memory_injection`이 사본으로 토큰 예산을 태우지 않게 한다.

**Architecture:** 5개 축을 상류→하류 순으로 쌓는다. (1) semantic content를 triple에만 종속시켜 사본 생성 자체를 구조적으로 불가능하게 만들고(A), (2) canonicalizer가 영문 변형을 어간으로 되돌려 predicate 게이트 통과율을 올리고(B2), (3) 추출 프롬프트가 predicate 형태를 강제해 상류에서 영문 predicate를 없애고(B1), (4) `memory_injection`이 content 기준으로 중복을 제거하고(D), (5) 정리 스크립트가 기존 행을 재렌더한 뒤 완전중복만 soft-delete 한다(E).

**Tech Stack:** TypeScript (Node ≥24), better-sqlite3, Vitest, tsx 스크립트, OpenAI SDK(gpt-4o-mini, 프로브 전용)

**Spec:** `specs/681-1137-duplicate-semantic-content/spec.md`

## Global Constraints

- 작업 위치: 워크트리 `/home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content`, 브랜치 `issue/1137-duplicate-semantic-content`. **모든 경로는 이 워크트리 기준이며, 원본 저장소(`~/git/memento`)를 수정하지 않는다.**
- Task 0을 먼저 끝낸다 (`npm install` 없이 `tsc: not found` — AGENTS §3.1 「신규 worktree」).
- PR 전 필수: `npm run lint` · `npm run type-check` · `npm test` 전량 통과 (AGENTS §3).
- 커밋 메시지는 Conventional Commits, 본문 한국어. 마지막 줄에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `main` 직접 커밋 금지 — 브랜치 → PR.
- `graphify-out/`은 커밋하지 않는다 (로컬 생성물).
- 스크립트 출력·에러에 **절대 경로를 노출하지 않는다** (AGENTS §3.1 `log_rotation`·`db:backup:cleanup` 선례).
- DB 실측은 항상 읽기 전용으로 연다: `sqlite3 "file:$HOME/.memento/data/memory.db?mode=ro"`.
- `MEMENTO_TYPE_PARAM_MODE` 기본값이 `error`이므로 테스트에서 `remember`/`recall`을 호출할 땐 `type`을 명시한다.
- 새 canonical predicate를 추가하면 **반드시** 프롬프트 목록에도 추가한다 (Task 3의 계약 테스트가 이를 강제한다).

---

### Task 0: 워크트리 준비

**Files:** 없음 (환경 준비)

**Interfaces:**
- Consumes: 없음
- Produces: 실행 가능한 `npm test` 환경

- [ ] **Step 1: 워크트리에서 의존성 설치**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npm install
```

- [ ] **Step 2: 기준선 확인 — 건드릴 테스트가 지금 통과하는지**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
  packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.spec.ts \
  packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts \
  scripts/repair-triple-sentence-memories.spec.ts
```

Expected: 전부 PASS. 하나라도 실패하면 이 계획을 시작하기 전에 원인을 보고한다 (기존 회귀와 내 변경을 섞지 않는다).

---

### Task 1: A — content를 triple에만 종속시킨다

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts:11-42`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts:63-69`
- Test: `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts:101-126` (교체)
- Test(Create): `packages/memento-core/src/domains/memory/semantic/semantic-memory-fallback-content.spec.ts`

**Interfaces:**
- Consumes: `buildTripleSentence(subject, predicate, object): string | null` (`triple-sentence.ts`, 기존), `SemanticMemoryUpdateService.updateSemanticMemoryWithEvidence({ triples, extractionInfo }, { episodicMemoryId, confidenceThreshold })` (기존)
- Produces: `SemanticMemoryScoring.tripleToNaturalLanguage(subject: string, predicate: string, object: string): string` — **4번째 파라미터 `fallbackText`가 제거된 3-인자 시그니처**. Task 5가 이 함수를 그대로 재사용한다.

- [ ] **Step 1a: 실제로 실패하는 persist 테스트를 새로 만든다**

단위 테스트만으로는 red가 안 나온다 — 3-인자로 호출하면 `fallbackText`가 `undefined`라 현재 코드도 구성 요소를 반환한다. 원문 복사는 **호출부가 4번째 인자를 넘기는 경로**에서만 발생하므로, 그 경로를 타는 테스트가 필요하다.

`semantic-memory-fallback-content.spec.ts`를 새로 만든다. 하네스는 `predicate-gate-persist.spec.ts:16-54`와 같은 구성이다.

```ts
/**
 * #1137: 재조립 불가 triple이 원본 episodic 본문을 content로 복사하지 않는지 고정한다.
 *
 * 게이트(#813)는 triple-extraction-service 앞단에 있고,
 * semantic-memory-update-pipeline.ts:212 의 prepareNormalizedTriple 은 canonicalize 실패를
 * 통과시킨다. 즉 게이트를 우회해 들어오는 경로가 존재하므로 쓰기 측 방어선이 필요하다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import type { Triple } from '../../../shared/types/triple-extraction.js';

describe('재조립 불가 triple의 content (#1137)', () => {
  let db: Database.Database;
  let service: SemanticMemoryUpdateService;
  const episodicContent = '합성 episodic 원문 — 원문 폴백이면 이 문자열이 content가 된다';

  beforeEach(async () => {
    db = await setupTestDatabase();
    service = new SemanticMemoryUpdateService(
      db,
      createRelationGraph(db),
      undefined,
      undefined,
      {
        createAndStoreEmbedding: vi.fn().mockResolvedValue(undefined),
      } as unknown as MemoryEmbeddingService
    );
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, is_deleted)
      VALUES ('episode-1137', 'episodic', ?, 0.5, 0)
    `, [episodicContent]);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.restoreAllMocks();
  });

  function semanticRows(): Array<{ content: string; predicate: string }> {
    return DatabaseUtils.all(db, `
      SELECT content, predicate FROM memory_item WHERE type = 'semantic' AND is_deleted = 0
    `, []) as Array<{ content: string; predicate: string }>;
  }

  it('한 episodic에서 나온 재조립 불가 triple 3개가 서로 다른 content를 갖는다', async () => {
    // 정규화를 거치지 않고 직접 투입한다 — 게이트 밖 경로를 재현한다
    const triples: Triple[] = [
      { subject: 'llmbasedrelationextractor', predicate: 'zzstores', object: 'initializedproviders' },
      { subject: 'isollamaavailable', predicate: 'zzchecks', object: 'ollama' },
      { subject: 'tests', predicate: 'zzcover', object: 'determineprovider' },
    ];

    const evidence = await service.updateSemanticMemoryWithEvidence(
      {
        triples,
        extractionInfo: {
          steps: { canonicalization: false, entityLinking: false },
        },
      },
      { episodicMemoryId: 'episode-1137', confidenceThreshold: 0.25 }
    );

    expect(evidence.result.created).toBe(3);

    const rows = semanticRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.content).not.toBe(episodicContent);
    }
    expect(new Set(rows.map((row) => row.content)).size).toBe(3);
  });
});
```

`predicate`에 `zz` 접두사를 붙인 이유: Task 2에서 `stores`·`checks`가 어간화로 canonical에 연결되면 이 테스트가 「재조립 불가」를 더 이상 검증하지 못한다. 사전에 절대 들어가지 않을 토큰을 써서 폴백 경로를 고정한다.

- [ ] **Step 1b: 단위 테스트도 새 계약으로 교체**

`semantic-memory-scoring.spec.ts`의 `describe('SemanticMemoryScoring.tripleToNaturalLanguage (#768)', ...)` 블록 전체(파일 101~126행)를 아래로 바꾼다.

```ts
describe('SemanticMemoryScoring.tripleToNaturalLanguage (#768 → #1137)', () => {
  const scoring = new SemanticMemoryScoring();

  it('재조립 가능한 triple은 문장으로 만든다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', '사용함', '기능')).toBe(
      '시스템은 기능을 사용합니다',
    );
  });

  it('재조립할 수 없으면 triple 구성 요소를 남긴다 — 원문을 복사하지 않는다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', 'use', '기능')).toBe('시스템 · use · 기능');
  });

  it('같은 원본에서 나온 서로 다른 triple은 서로 다른 content가 된다 (#1137 SC-002)', () => {
    const contents = [
      scoring.tripleToNaturalLanguage('llmbasedrelationextractor', 'stores', 'initializedproviders'),
      scoring.tripleToNaturalLanguage('isollamaavailable', 'uses', "initializedproviders.includes('ollama')"),
      scoring.tripleToNaturalLanguage('tests', 'cover', 'relation determineprovider'),
    ];

    expect(new Set(contents).size).toBe(3);
  });

  it('빈 구성 요소는 빼고 남은 것만 이어붙인다', () => {
    expect(scoring.tripleToNaturalLanguage('', 'use', '  ')).toBe('use');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/memory/semantic/semantic-memory-fallback-content.spec.ts
```

Expected: **FAIL** — 3행의 content가 모두 `episodicContent`와 같아서 `not.toBe(episodicContent)`가 깨지고, `new Set(...).size`가 3이 아니라 1이 된다. 이게 이슈의 실제 증상이다.

통과해 버리면 멈추고 보고한다 — 파이프라인이 이미 다른 이유로 이 triple을 거르고 있다는 뜻이고(예: confidence 임계값), 그러면 `confidenceThreshold`를 낮추거나 `subject`/`object`를 entityLinker가 통과시키는 값으로 바꿔 폴백 경로를 실제로 타게 만들어야 한다.

단위 테스트(Step 1b)는 3-인자 호출이라 현재 코드에서도 통과한다 — 새 계약을 고정하는 회귀 방어용이며 red 판정 대상이 아니다.

- [ ] **Step 3: `tripleToNaturalLanguage`에서 원문 폴백 제거**

`semantic-memory-scoring.ts`에서 `FALLBACK_TEXT_MAX_LENGTH` 상수(11-12행)를 삭제하고, 메서드를 아래로 바꾼다.

```ts
  /**
   * triple을 문장으로 만든다. 재조립할 수 없으면 triple 구성 요소를 그대로 남긴다.
   *
   * #768은 재조립 실패 시 원본 episodic 본문을 보존했다. 그 폴백은 triple에 의존하지 않아,
   * 한 episodic에서 뽑은 triple k개가 모두 실패하면 같은 본문의 semantic 행 k개가 생겼다 (#1137).
   * 원문은 episodic 행과 `origin_source.context.source_episodic_id`로 추적되므로
   * content는 triple에만 종속시킨다.
   */
  tripleToNaturalLanguage(subject: string, predicate: string, object: string): string {
    const sentence = buildTripleSentence(subject, predicate, object);
    if (sentence) {
      return sentence;
    }

    return [subject, predicate, object]
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0)
      .join(' · ');
  }
```

- [ ] **Step 4: 호출부에서 원문 인자 제거**

`semantic-memory-crud.ts:63-69`를 아래로 바꾼다.

```ts
    // #1137: content는 triple에만 종속된다. 원문 폴백(#768)은 같은 본문 사본을 양산했다.
    const content = this.scoring.tripleToNaturalLanguage(
      snapshot.subject,
      snapshot.predicate,
      snapshot.object
    );
```

- [ ] **Step 5: 다른 호출부가 남아 있지 않은지 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
grep -rn "tripleToNaturalLanguage" --include="*.ts" packages/ scripts/ | grep -v "/dist/"
```

Expected: `semantic-memory-scoring.ts`(정의), `semantic-memory-crud.ts`(호출 1곳), `semantic-memory-scoring.spec.ts`(테스트)만 나온다. 4-인자 호출이 하나라도 남아 있으면 그 자리도 3-인자로 고친다.

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/memory/semantic/ && npx tsc --noEmit -p packages/memento-core
```

Expected: vitest PASS, 타입 오류 0.

- [ ] **Step 7: 커밋**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts \
        packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts \
        packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
        packages/memento-core/src/domains/memory/semantic/semantic-memory-fallback-content.spec.ts
git commit -m "$(cat <<'EOF'
fix(semantic): triple 재조립 실패 시 원문 대신 구성 요소를 content로 쓴다 (#1137)

원문 폴백(#768)은 triple에 의존하지 않아 한 episodic에서 뽑은 triple k개가
모두 재조립에 실패하면 같은 본문의 semantic 행 k개를 만들었다. 원문은
episodic 행과 origin_source.context.source_episodic_id 로 추적되므로
content를 triple에만 종속시킨다. 형태(2)가 쓰기 경로에서 0이 되어
#813 SC-006(라이브 신규 형태(2) < 1%)을 구조적으로 만족한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: B2 — canonicalizer 영문 어간 재시도 + canonical 5종 추가

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.ts:27-89`(사전), `:124-126`(normalizeKey 인접), `:131-171`(canonicalize)
- Test: `packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.spec.ts` (파일 끝에 describe 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `PredicateCanonicalizer.canonicalize(predicate: string): PredicateCanonicalizationResult` — 동작만 확장(시그니처 불변). 신규 canonical 키 `해결함`·`실행함`·`종료함`·`통과함`·`추가함`. Task 3의 계약 테스트가 `getCanonicalPredicates()`로 이 목록을 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`predicate-canonicalizer.spec.ts` 파일 맨 끝(최상위 `describe` 블록 닫힘 뒤)에 추가한다.

```ts
describe('PredicateCanonicalizer 영문 변형·신규 canonical (#1137)', () => {
  let canonicalizer: PredicateCanonicalizer;

  beforeEach(() => {
    canonicalizer = new PredicateCanonicalizer();
  });

  it('영문 3인칭·복수 변형을 어간으로 되돌려 기존 사전으로 해결한다', () => {
    const cases: Array<[string, string]> = [
      ['uses', '사용함'],
      ['includes', '포함함'],
      ['contains', '포함함'],
      ['updated', '업데이트함'],
    ];

    for (const [input, expected] of cases) {
      const result = canonicalizer.canonicalize(input);
      expect(result.success, `${input} → ${expected}`).toBe(true);
      expect(result.canonical).toBe(expected);
    }
  });

  it('신규 등재 동사를 canonical로 변환한다', () => {
    const cases: Array<[string, string]> = [
      ['resolve', '해결함'],
      ['resolved', '해결함'],
      ['execute', '실행함'],
      ['closes', '종료함'],
      ['closed', '종료함'],
      ['pass', '통과함'],
      ['requires', '필요함'],
      ['fix', '업데이트함'],
      ['added', '추가함'],
    ];

    for (const [input, expected] of cases) {
      const result = canonicalizer.canonicalize(input);
      expect(result.success, `${input} → ${expected}`).toBe(true);
      expect(result.canonical).toBe(expected);
    }
  });

  it('계사·속성 라벨은 여전히 canonicalize 실패다 (#1137 범위 밖)', () => {
    for (const input of ['is', 'are', 'status', 'date', 'description', 'in', 'on']) {
      expect(canonicalizer.canonicalize(input).success, input).toBe(false);
    }
  });

  it('어간화가 짧은 단어·이중자음을 잘라내지 않는다', () => {
    // pass → pas 로 잘리면 사전 미스가 되므로 직접 매칭이 우선해야 한다
    expect(canonicalizer.canonicalize('pass').canonical).toBe('통과함');
    // 2글자 이하는 어간화 대상이 아니다
    expect(canonicalizer.canonicalize('as').success).toBe(false);
  });

  it('모든 canonical predicate는 buildTripleSentence로 재조립된다 (#813 게이트 통과 조건)', () => {
    for (const canonical of canonicalizer.getCanonicalPredicates()) {
      expect(buildTripleSentence('시스템', canonical, '기능'), canonical).not.toBeNull();
    }
  });
});
```

파일 상단 import에 아래를 추가한다.

```ts
import { buildTripleSentence } from '../../../memory/semantic/triple-sentence.js';
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.spec.ts -t '#1137'
```

Expected: 「영문 3인칭·복수 변형」과 「신규 등재 동사」가 FAIL (`uses`·`resolve` 등이 `success: false`).

- [ ] **Step 3: 사전에 canonical 5종·동의어 2건 추가**

`predicate-canonicalizer.ts`의 `DEFAULT_PREDICATE_DICTIONARY`에서 두 항목을 수정하고, 사전 끝(`'후행함'` 항목 뒤)에 5개를 추가한다.

수정 — `require`와 `fix`를 기존 키에 넣는다.

```ts
  // 업데이트/수정 관련
  '업데이트함': ['업데이트한다', '업데이트함', '수정한다', '수정함', '변경한다', '변경함', 'update', 'modify', 'change', 'fix'],

  // 필요/필요함 관련
  '필요함': ['필요하다', '필요함', '필수이다', 'required', 'need', 'necessary', 'require'],
```

추가 — 실측 상위 동사(#1137 §2.2)를 능동 ㅁ형 canonical로 등재한다. 피동 `됨`형은 조사가 맞지 않아 쓰지 않는다.

```ts
  // 해결 관련 (#1137: resolved 29건)
  '해결함': ['해결한다', '해결함', 'resolve', 'solve'],

  // 실행 관련 (#1137: execute 18건)
  '실행함': ['실행한다', '실행함', 'execute', 'run'],

  // 종료 관련 (#1137: closes 17건 + closed 8건)
  '종료함': ['종료한다', '종료함', 'close', 'finish'],

  // 통과 관련 (#1137: pass 14건)
  '통과함': ['통과한다', '통과함', 'pass'],

  // 추가 관련 (#1137: added 8건)
  '추가함': ['추가한다', '추가함', 'add', 'append']
```

`'후행함'` 항목 끝의 콤마 처리를 잊지 말 것 (`'후행함': [...],` 로 바꾸고 새 항목 마지막에는 콤마를 두지 않는다).

- [ ] **Step 4: 영문 어간 재시도 구현**

`predicate-canonicalizer.ts`의 `import` 아래(클래스 밖)에 헬퍼를 추가한다.

```ts
/** 공백 제거 후의 영문 키만 어간화 대상이다 (normalizeKey가 공백을 지운 뒤 호출된다). */
const ASCII_PREDICATE_KEY = /^[a-z0-9'-]+$/;

/**
 * 영문 변형 → 어간 후보 (#1137).
 *
 * 사전에는 `use`·`include`처럼 원형만 있어서 `uses`·`includes`가 canonicalize 실패했고,
 * 실패한 predicate는 원문 폴백 경로로 흘러 같은 본문의 semantic 사본을 만들었다.
 * 후보를 순서대로 조회하므로 잘못 자른 어간(`us`)은 사전 미스가 되어 자연히 버려진다.
 */
function englishStemCandidates(key: string): string[] {
  if (!ASCII_PREDICATE_KEY.test(key)) {
    return [];
  }

  const candidates: string[] = [];
  if (key.endsWith('ies') && key.length > 4) {
    candidates.push(`${key.slice(0, -3)}y`);
  }
  if (key.endsWith('es') && key.length > 3) {
    candidates.push(key.slice(0, -2));
  }
  if (key.endsWith('s') && !key.endsWith('ss') && key.length > 3) {
    candidates.push(key.slice(0, -1));
  }
  if (key.endsWith('ed') && key.length > 3) {
    candidates.push(key.slice(0, -2));
    candidates.push(key.slice(0, -1));
  }
  if (key.endsWith('ing') && key.length > 4) {
    candidates.push(key.slice(0, -3));
    candidates.push(`${key.slice(0, -3)}e`);
  }
  return candidates;
}
```

클래스 안 `canonicalize`의 조회부(현재 `:154-155`)를 바꾼다.

```ts
    // 정규화된 키로 검색 (실패 시 영문 어간으로 한 번 더, #1137)
    const normalizedKey = this.normalizeKey(trimmed);
    const canonical = this.reverseIndex.get(normalizedKey)
      ?? this.resolveEnglishVariant(normalizedKey);
```

그리고 `canonicalizeBatch` 위에 private 메서드를 추가한다.

```ts
  /** 영문 변형(-s/-es/-ied/-ed/-ing)을 어간으로 되돌려 사전을 한 번 더 조회한다 (#1137). */
  private resolveEnglishVariant(normalizedKey: string): string | undefined {
    for (const candidate of englishStemCandidates(normalizedKey)) {
      const hit = this.reverseIndex.get(candidate);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
```

- [ ] **Step 5: 테스트 통과 확인 — 기존 canonicalizer 테스트 포함**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/relation/services/triple-extraction/
```

Expected: 신규 5개 + 기존 predicate-canonicalizer·triple-normalizer·predicate-gate 테스트 전부 PASS.
`triple-extraction-predicate-gate.spec.ts`가 "영문 predicate는 drop"을 단언하는데 `uses` 같은 입력을 쓰고 있으면, 그 테스트는 이제 accept가 정답이다 — 단언을 뒤집기 전에 **어떤 predicate로 drop을 검증하는지 읽고**, 계사(`is`·`status`)로 교체해 drop 경로를 계속 지키게 한다. 단언을 지우지 말 것.

- [ ] **Step 6: 커밋**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add packages/memento-core/src/domains/relation/services/triple-extraction/
git commit -m "$(cat <<'EOF'
fix(relation): 영문 predicate 변형을 어간으로 되돌려 canonical에 연결한다 (#1137)

사전에 use·include 원형만 있어 uses·includes 가 canonicalize 실패했고,
실패한 predicate가 원문 폴백 경로로 흘러 중복 본문 semantic 을 만들었다.
-s/-es/-ies/-ed/-ing 어간 재시도를 붙이고, 실측 상위 동사를 능동 ㅁ형
canonical 5종(해결함·실행함·종료함·통과함·추가함)으로 등재했다.
피동 됨형은 템플릿의 목적격 조사와 맞지 않아 제외했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: B1 — 추출 프롬프트가 predicate 형태를 강제한다

**Files:**
- Modify: `packages/memento-core/prompts/triple-extraction.txt`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-prompt-contract.spec.ts`
- Create(커밋하지 않음): `<scratchpad>/probe-triple-prompt.ts`

**Interfaces:**
- Consumes: `PredicateCanonicalizer.getCanonicalPredicates(): string[]` (Task 2), `PromptTemplateLoader.loadTemplate('triple-extraction'): string`
- Produces: 프롬프트 파일 계약 — canonical 목록 전체가 프롬프트 본문에 등장한다

- [ ] **Step 1: 실패하는 계약 테스트 작성**

`triple-extraction-prompt-contract.spec.ts`를 새로 만든다.

```ts
/**
 * #1137: 추출 프롬프트가 predicate 형태를 강제하는지 고정한다.
 *
 * 게이트(#813)의 실질 통과 조건은 사전 등재가 아니라 「공백 없는 한글 종결 단일 토큰 +
 * buildTripleSentence 성공」이다(triple-normalizer.ts:88-95). 프롬프트가 그 형태를 요구하지
 * 않으면 LLM이 영문 predicate를 뱉고 게이트가 전량 drop한다.
 */

import { describe, expect, it } from 'vitest';
import { PromptTemplateLoader } from '../../../../shared/utils/prompt-template-loader.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';

const prompt = PromptTemplateLoader.loadTemplate('triple-extraction');

describe('triple-extraction 프롬프트 predicate 계약 (#1137)', () => {
  it('한글 ㅁ 명사화형을 명시적으로 요구한다', () => {
    expect(prompt).toContain('ㅁ 명사화형');
    expect(prompt).toContain('영문');
  });

  it('모든 canonical predicate가 프롬프트 목록에 있다', () => {
    const canonicals = new PredicateCanonicalizer().getCanonicalPredicates();
    const missing = canonicals.filter((canonical) => !prompt.includes(canonical));

    expect(missing, `프롬프트에 없는 canonical: ${missing.join(', ')}`).toEqual([]);
  });

  it('적절한 동사가 없으면 추출하지 말라고 지시한다', () => {
    expect(prompt).toContain('추출하지');
  });

  it('영문 predicate 금지를 대조 예시로 보여준다', () => {
    expect(prompt).toContain('stores');
    expect(prompt).toContain('저장함');
  });

  it('observation 플레이스홀더를 유지한다', () => {
    expect(prompt).toContain('{observation}');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-prompt-contract.spec.ts
```

Expected: 「한글 ㅁ 명사화형」·「canonical 목록」·「추출하지」·「대조 예시」 FAIL. `{observation}`만 PASS.

- [ ] **Step 3: 프롬프트에 predicate 제약 추가**

`packages/memento-core/prompts/triple-extraction.txt`의 `2. **추출 원칙**:` 블록 **뒤**, `3. **출력 형식**:` **앞**에 아래 절을 삽입하고, 기존 번호 3·4를 4·5로 밀어 쓴다.

```
3. **predicate 형태 (필수)**:
   - predicate는 **한국어 ㅁ 명사화형 단일 토큰**으로 씁니다: `사용함`, `정의됨`, `포함함`.
   - 영문 predicate를 쓰지 마세요. 공백이 들어간 구도 쓰지 마세요.
   - 가능하면 아래 표준 목록에서 고르세요:
     `좋아함`, `사용함`, `생성함`, `삭제함`, `업데이트함`, `포함함`, `의존함`, `원인함`,
     `참조함`, `소유함`, `속함`, `일치함`, `다름`, `연결함`, `관련함`, `필요함`, `지원함`,
     `반대함`, `따라옴`, `선행함`, `후행함`, `해결함`, `실행함`, `종료함`, `통과함`, `추가함`
   - 목록에 없는 관계라면 같은 형태로 새로 만드세요 (`저장함`, `측정함`).
   - 적절한 동사가 없는 관계(상태·날짜·설명 같은 속성 라벨)는 **트리플을 추출하지 마세요.**
   - 대조 예시:
     - ✗ `{"subject": "서비스", "predicate": "stores", "object": "설정"}`
     - ✓ `{"subject": "서비스", "predicate": "저장함", "object": "설정"}`
     - ✗ `{"subject": "이슈 1137", "predicate": "status", "object": "resolved"}` → 추출하지 않음
```

목록은 Task 2에서 등재한 canonical 26개 전량이다. **새 canonical을 추가할 때 이 목록도 같이 고쳐야 한다** — Step 1의 계약 테스트가 누락을 잡는다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/relation/services/triple-extraction/
```

Expected: 계약 테스트 5건 PASS, 기존 추출 테스트 회귀 없음.

- [ ] **Step 5: 실 LLM 프로브 작성 (SC-004, 커밋하지 않음)**

스크래치패드에 `probe-triple-prompt.ts`를 만든다. 저장소에 커밋하지 않는다 — 일회성 측정이고 API 키·비용이 따른다.

```ts
/**
 * #1137 SC-004: 프롬프트 제약 전/후로 gpt-4o-mini의 predicate 형태 준수율과
 * #813 게이트 통과율을 비교한다. 일회성 측정 — 저장소에 커밋하지 않는다.
 *
 * 실행:
 *   cd <워크트리>
 *   npx tsx <scratchpad>/probe-triple-prompt.ts
 */

import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { TripleNormalizer } from '@memento/core';

const SAMPLE_SIZE = 20;
const MODEL = 'gpt-4o-mini';

/** 중복 본문을 만든 episodic 원문을 표본으로 쓴다 (읽기 전용). */
function sampleObservations(): string[] {
  const db = new Database(`${process.env.HOME}/.memento/data/memory.db`, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT DISTINCT e.content
      FROM memory_item s
      JOIN memory_item e
        ON e.id = json_extract(s.origin_source, '$.context.source_episodic_id')
      WHERE s.type = 'semantic'
        AND s.predicate GLOB '*[a-zA-Z0-9)]'
        AND e.type = 'episodic'
        AND length(e.content) BETWEEN 200 AND 4000
      LIMIT ?
    `).all(SAMPLE_SIZE) as Array<{ content: string }>;
    return rows.map((row) => row.content);
  } finally {
    db.close();
  }
}

/** 변경 전 프롬프트는 git에서 가져온다 (현재 워킹트리는 이미 새 프롬프트다). */
function loadPrompts(): { before: string; after: string } {
  const before = execFileSync('git', [
    'show',
    'HEAD~1:packages/memento-core/prompts/triple-extraction.txt',
  ], { encoding: 'utf-8' });
  const after = execFileSync('cat', [
    'packages/memento-core/prompts/triple-extraction.txt',
  ], { encoding: 'utf-8' });
  return { before, after };
}

function endsWithHangul(value: string): boolean {
  const code = value.slice(-1).codePointAt(0);
  return code !== undefined && code >= 0xac00 && code <= 0xd7a3;
}

async function measure(label: string, template: string, observations: string[]): Promise<void> {
  const client = new OpenAI();
  const normalizer = new TripleNormalizer();
  let total = 0;
  let hangulForm = 0;
  let accepted = 0;

  for (const observation of observations) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: template.replace('{observation}', observation) }],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{"triples":[]}');
    const triples = Array.isArray(parsed.triples) ? parsed.triples : [];
    total += triples.length;
    hangulForm += triples.filter((t: { predicate?: string }) =>
      typeof t.predicate === 'string' && endsWithHangul(t.predicate) && !/\s/.test(t.predicate),
    ).length;
    accepted += normalizer.normalize(triples).length;
  }

  const pct = (n: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));
  console.log(`${label}: triple ${total}건, 한글 ㅁ형 ${hangulForm}건 (${pct(hangulForm)}%), 게이트 통과 ${accepted}건 (${pct(accepted)}%)`);
}

const observations = sampleObservations();
console.log(`표본 ${observations.length}건`);
const { before, after } = loadPrompts();
await measure('before', before, observations);
await measure('after', after, observations);
```

- [ ] **Step 6: 프로브 실행하고 수치를 스펙에 기록**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx tsx /tmp/claude-1000/-home-jee1lee-git-memento/de7fb42d-64a1-4d39-9575-495eb3ae35c9/scratchpad/probe-triple-prompt.ts
```

`OPENAI_API_KEY`가 필요하다. 없으면 **추측하지 말고** 사용자에게 `! export OPENAI_API_KEY=...` 실행을 요청하거나, 이 단계를 건너뛰고 「SC-004 미측정」으로 보고한다. 절대 수치를 만들어 쓰지 않는다.

측정되면 `specs/681-1137-duplicate-semantic-content/spec.md` §6의 「실 LLM 프로브」 항목 아래에 before/after 수치와 측정일을 적는다.

- [ ] **Step 7: 커밋 (프롬프트·계약 테스트·스펙 수치만)**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add packages/memento-core/prompts/triple-extraction.txt \
        packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-prompt-contract.spec.ts \
        specs/681-1137-duplicate-semantic-content/spec.md
git commit -m "$(cat <<'EOF'
fix(relation): 추출 프롬프트가 predicate를 한글 ㅁ형으로 강제한다 (#1137)

프롬프트가 predicate 어휘를 전혀 제약하지 않아 gpt-4o-mini 가 영문
predicate 를 뱉었고, #813 게이트가 그걸 전량 drop했다. 게이트의 실질
통과 조건인 「공백 없는 한글 종결 단일 토큰」을 프롬프트에 명시하고
canonical 26종 목록·대조 예시를 넣었다. 계약 테스트가 canonical 목록과
프롬프트의 동기화를 강제한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: D — memory_injection content 중복 제거

**Files:**
- Modify: `packages/memento-core/src/domains/memory/services/knowledge-context-bundle-builder.ts:270-290`(필터 헬퍼 인접), `:376-420`(overfetch 루프·사후 필터)
- Test: `packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts` (파일 끝에 describe 추가)

**Interfaces:**
- Consumes: `HybridSearchResult`(`id`·`content`·`type`·`importance`·`finalScore` 필드), 기존 `filterBrokenTripleContent(memories): { clean, excluded }`
- Produces: 모듈 내부 함수 `dedupeByContent(memories: HybridSearchResult[]): { unique: HybridSearchResult[]; excluded: number }` — export하지 않는다 (통합 테스트로 검증)

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`knowledge-context-bundle-builder.spec.ts` 끝에 추가한다. 최상위 `describe` 안에 넣을 것 — `stubSearchHit`과 `db`·`context` 픽스처를 쓴다.

```ts
  it('같은 본문 사본이 예산을 먹지 않는다 (#1137 SC-003)', async () => {
    const duplicateBody = 'dedupe 대상 원문: LLM provider 라우팅을 정리하고 4잡 override 대칭을 맞췄다';
    const copies = Array.from({ length: 5 }, (_, i) =>
      stubSearchHit({
        id: `dup_${i}`,
        content: duplicateBody,
        finalScore: 1 - i * 0.01,
      }),
    );
    const distinct = stubSearchHit({
      id: 'distinct_1',
      content: 'dedupe 별개 기억: 검색 랭킹 가중치를 조정했다',
      finalScore: 0.5,
    });

    const ranked = [...copies, distinct];
    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => ({
      items: ranked.slice(0, query.limit ?? 10),
      total_count: ranked.length,
      query_time: 1,
      union_count: ranked.length,
      reranked_count: ranked.length,
    }));

    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: { search } as unknown as HybridSearchEngine },
      { query: 'dedupe', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(2);
    expect(bundle.promptText).toContain('dedupe 별개 기억');
    // 사본은 1건만 남는다
    const occurrences = bundle.promptText.split(duplicateBody).length - 1;
    expect(occurrences).toBe(1);
  });

  it('500자로 잘린 사본과 원문 행을 같은 중복으로 본다 (#1137)', async () => {
    const full = `잘림 판정 원문 ${'가'.repeat(700)}`;
    const truncated = `${full.slice(0, 500)}…`;

    const ranked = [
      stubSearchHit({ id: 'trunc_copy', content: truncated, type: 'semantic', finalScore: 0.9 }),
      stubSearchHit({ id: 'full_origin', content: full, type: 'episodic', finalScore: 0.8 }),
    ];
    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => ({
      items: ranked.slice(0, query.limit ?? 10),
      total_count: ranked.length,
      query_time: 1,
      union_count: ranked.length,
      reranked_count: ranked.length,
    }));

    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: { search } as unknown as HybridSearchEngine },
      { query: '잘림 판정', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
  });

  it('앞부분이 달라지면 별개 기억으로 남긴다 (#1137)', async () => {
    const ranked = [
      stubSearchHit({ id: 'sep_1', content: '별개 판정 첫 번째 기억 본문', finalScore: 0.9 }),
      stubSearchHit({ id: 'sep_2', content: '별개 판정 두 번째 기억 본문', finalScore: 0.8 }),
    ];
    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => ({
      items: ranked.slice(0, query.limit ?? 10),
      total_count: ranked.length,
      query_time: 1,
      union_count: ranked.length,
      reranked_count: ranked.length,
    }));

    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: { search } as unknown as HybridSearchEngine },
      { query: '별개 판정', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(2);
  });

  it('중복 그룹에서 finalScore+importance가 가장 높은 행을 남긴다 (#1137)', async () => {
    const body = '대표 선택 판정용 동일 본문';
    const ranked = [
      stubSearchHit({ id: 'low', content: body, finalScore: 0.2, importance: 0.2 }),
      stubSearchHit({ id: 'high', content: body, finalScore: 0.9, importance: 0.9 }),
    ];
    const search = vi.fn(async (_db: Database.Database, query: { limit?: number }) => ({
      items: ranked.slice(0, query.limit ?? 10),
      total_count: ranked.length,
      query_time: 1,
      union_count: ranked.length,
      reranked_count: ranked.length,
    }));

    const bundle = await buildKnowledgeContextBundle(
      { db, hybridSearchEngine: { search } as unknown as HybridSearchEngine },
      { query: '대표 선택', maxMemories: 5, tokenBudget: 4000 },
    );

    expect(bundle.itemCount).toBe(1);
    expect(bundle.topMemoryId).toBe('high');
  });
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts -t '#1137'
```

Expected: 「같은 본문 사본」이 `itemCount: 5`로 FAIL, 「잘린 사본」이 `2`로 FAIL.

- [ ] **Step 3: `dedupeByContent` 구현**

`knowledge-context-bundle-builder.ts`의 `filterBrokenTripleContent` 함수 **뒤**에 추가한다.

```ts
/** 중복 판정 키 길이. 500자로 잘린 사본과 원문 행이 같은 그룹이 되도록 프리픽스를 쓴다. */
const DEDUPE_KEY_LENGTH = 200;

function dedupeKey(content: string): string {
  return content
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/…$/, '')
    .slice(0, DEDUPE_KEY_LENGTH);
}

/** summarizeMemories와 같은 정렬 키 — 대표 선택이 요약 단계와 어긋나지 않게 한다. */
function dedupeRankScore(memory: HybridSearchResult): number {
  return memory.finalScore + memory.importance;
}

/**
 * 같은 본문의 사본이 토큰 예산을 먹는 것을 막는다 (#1137).
 *
 * 폴백 content가 원본 episodic 본문을 그대로 쓰던 시기(#768 경로)에 만들어진 사본이 대상이다.
 * 한계: 앞 200자가 같고 뒤가 다른 별개 기억은 한 건으로 합쳐진다. 실측 사본은 전부 바이트
 * 동일이라 현재 데이터에서는 위험이 없고, 정확 비교로 좁히려면 DEDUPE_KEY_LENGTH 절단을 없애면 된다.
 */
function dedupeByContent(memories: HybridSearchResult[]): {
  unique: HybridSearchResult[];
  excluded: number;
} {
  const representatives = new Map<string, HybridSearchResult>();

  for (const memory of memories) {
    const key = dedupeKey(memory.content);
    const kept = representatives.get(key);
    if (!kept) {
      representatives.set(key, memory);
      continue;
    }
    const score = dedupeRankScore(memory);
    const keptScore = dedupeRankScore(kept);
    if (score > keptScore || (score === keptScore && memory.id < kept.id)) {
      representatives.set(key, memory);
    }
  }

  const unique = memories.filter((memory) => representatives.get(dedupeKey(memory.content)) === memory);
  return { unique, excluded: memories.length - unique.length };
}
```

- [ ] **Step 4: overfetch 루프와 사후 필터에 연결**

`buildKnowledgeContextBundle` 안에서 세 곳을 고친다.

(1) 루프 앞 상태 변수(현재 `let excludedEarly = 0;` 인접)에 추가:

```ts
  let excludedDuplicateEarly = 0;
```

(2) 루프 안, `const { clean, excluded } = filterBrokenTripleContent(candidates);` 아래 3줄을 바꾼다:

```ts
    const { clean, excluded } = filterBrokenTripleContent(candidates);
    // #1137: 중복 제거를 루프 안에서 해야 사본이 걷힌 만큼 searchLimit이 확장돼 예산이 굶지 않는다.
    const { unique, excluded: excludedDuplicates } = dedupeByContent(clean);
    memories = unique;
    excludedEarly = excluded;
    excludedDuplicateEarly = excludedDuplicates;
```

(3) 루프 뒤 사후 필터를 바꾼다:

```ts
  // DiD 사후 필터 (유일한 예산 보호가 아님 — 위 early filter + expand가 주경로)
  const { clean: didClean, excluded: excludedDid } = filterBrokenTripleContent(memories);
  const { unique: dedupedClean, excluded: excludedDuplicatePost } = dedupeByContent(didClean);
  memories = dedupedClean;
  const corruptedCount = excludedEarly + excludedDid;
  if (corruptedCount > 0) {
    logger.warn('[knowledge-context-bundle] 손상된 triple 문장 제외', {
      excluded: corruptedCount,
      hint: 'npm run memory:repair-triple-sentences -- --apply',
    });
  }
  const duplicateCount = excludedDuplicateEarly + excludedDuplicatePost;
  if (duplicateCount > 0) {
    logger.warn('[knowledge-context-bundle] 중복 본문 기억 제외', {
      excluded: duplicateCount,
      hint: 'npm run memory:repair-duplicate-semantic -- --apply',
    });
  }
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts
```

Expected: 신규 4건 + 기존 테스트(#811 adaptive overfetch, project/owner 필터) 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add packages/memento-core/src/domains/memory/services/
git commit -m "$(cat <<'EOF'
fix(memory): memory_injection 이 같은 본문 사본으로 예산을 채우지 않는다 (#1137)

원문 폴백이 만든 사본 k개가 토큰 예산을 전부 먹고 정작 찾는 기억이
반환되지 않았다. overfetch 루프 안에서 content 프리픽스 기준으로 중복을
제거해, 사본이 걷힌 만큼 searchLimit 이 확장되게 했다. 500자로 잘린
사본과 원문 행도 같은 그룹으로 묶인다. 대표는 summarizeMemories 와 같은
finalScore+importance 정렬 키로 고른다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: E — 기존 1,566행 정리 스크립트

**Files:**
- Create: `scripts/repair-duplicate-semantic-content.ts`
- Create: `scripts/repair-duplicate-semantic-content.spec.ts`
- Modify: `package.json`(scripts 블록, `memory:repair-triple-sentences` 다음 줄)
- Modify: `docs/agents/commands.md:173-178` 인접

**Interfaces:**
- Consumes: `SemanticMemoryScoring.tripleToNaturalLanguage(subject, predicate, object)` (Task 1의 3-인자 시그니처), `PredicateCanonicalizer` (Task 2의 어간화), `scripts/lib/cli.js`의 `isMain`·`parseArgs`·`CliDatabase`, `@memento/core`의 `initializeDatabase`·`closeDatabase`·`MemoryEmbeddingService`
- Produces: `buildDuplicatePlan(db: CliDatabase): DuplicatePlan` — 테스트가 이 이름으로 import한다

- [ ] **Step 1: `@memento/core`가 필요한 심볼을 export하는지 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
grep -rn "SemanticMemoryScoring\|PredicateCanonicalizer" packages/memento-core/src/index.ts
```

Expected: 둘 다 export되어 있다. 하나라도 없으면 `packages/memento-core/src/index.ts`에 `export { SemanticMemoryScoring } from './domains/memory/semantic/semantic-memory-scoring.js';` 형태로 추가하고, `scripts/repair-triple-sentence-memories.spec.ts:7-12`가 하는 것과 같은 export 회귀 테스트를 Step 2 테스트 파일 맨 위에 넣는다.

- [ ] **Step 2: 실패하는 테스트 작성**

`scripts/repair-duplicate-semantic-content.spec.ts`를 만든다.

```ts
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDuplicatePlan } from './repair-duplicate-semantic-content.js';

let db: Database.Database;

function insertEpisodic(id: string, content: string): void {
  db.prepare(
    "INSERT INTO memory_item (id, type, content, is_deleted) VALUES (?, 'episodic', ?, 0)",
  ).run(id, content);
}

function insertSemantic(row: {
  id: string;
  content: string;
  subject: string;
  predicate: string;
  object: string;
  sourceId: string;
  confidence?: number;
}): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, confidence, is_deleted, origin_source)
    VALUES (?, 'semantic', ?, ?, ?, ?, ?, 0, ?)
  `).run(
    row.id,
    row.content,
    row.subject,
    row.predicate,
    row.object,
    row.confidence ?? 0.5,
    JSON.stringify({ tool: 'extract_triples', context: { source_episodic_id: row.sourceId } }),
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      confidence REAL,
      owner_id TEXT,
      project_id TEXT,
      origin_source TEXT,
      is_deleted INTEGER DEFAULT 0
    )
  `);
});

afterEach(() => {
  db.close();
});

describe('buildDuplicatePlan (#1137)', () => {
  it('원문을 content로 쓰는 행만 고르고 triple로 재렌더한다', () => {
    insertEpisodic('ep_1', '오늘 LLM provider 라우팅을 정리했다');
    insertSemantic({
      id: 'sem_1',
      content: '오늘 LLM provider 라우팅을 정리했다',
      subject: '서비스',
      predicate: 'uses',
      object: '설정',
      sourceId: 'ep_1',
    });
    // 정상 문장 행은 대상이 아니다
    insertSemantic({
      id: 'sem_ok',
      content: '시스템은 기능을 사용합니다',
      subject: '시스템',
      predicate: '사용함',
      object: '기능',
      sourceId: 'ep_1',
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender.map((entry) => entry.id)).toEqual(['sem_1']);
    // uses → 어간화로 사용함이 되어 한국어 문장이 된다
    expect(plan.rerender[0]!.after).toBe('서비스는 설정을 사용합니다');
    expect(plan.deletions).toEqual([]);
  });

  it('canonicalize 불가 predicate는 구성 요소로 렌더해 서로 구별시킨다', () => {
    insertEpisodic('ep_2', '같은 본문 하나');
    insertSemantic({
      id: 'sem_a',
      content: '같은 본문 하나',
      subject: 'tests',
      predicate: 'cover',
      object: 'determineprovider',
      sourceId: 'ep_2',
    });
    insertSemantic({
      id: 'sem_b',
      content: '같은 본문 하나',
      subject: 'review',
      predicate: 'status',
      object: 'approved',
      sourceId: 'ep_2',
    });

    const plan = buildDuplicatePlan(db);
    const afters = plan.rerender.map((entry) => entry.after);

    expect(afters).toHaveLength(2);
    expect(new Set(afters).size).toBe(2);
    expect(plan.deletions).toEqual([]);
  });

  it('500자로 잘린 사본도 대상으로 고른다', () => {
    const long = `절단 판정 ${'가'.repeat(700)}`;
    insertEpisodic('ep_3', long);
    insertSemantic({
      id: 'sem_trunc',
      content: `${long.slice(0, 500)}…`,
      subject: '모듈',
      predicate: 'includes',
      object: '계약',
      sourceId: 'ep_3',
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender.map((entry) => entry.id)).toEqual(['sem_trunc']);
    expect(plan.rerender[0]!.after).toBe('모듈은 계약을 포함합니다');
  });

  it('triple까지 같은 행은 confidence 최대 1건만 남기고 나머지를 삭제 대상으로 표시한다', () => {
    insertEpisodic('ep_4', '완전중복 본문');
    insertSemantic({
      id: 'sem_dup_low',
      content: '완전중복 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      sourceId: 'ep_4',
      confidence: 0.3,
    });
    insertSemantic({
      id: 'sem_dup_high',
      content: '완전중복 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      sourceId: 'ep_4',
      confidence: 0.9,
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.deletions).toEqual([{ id: 'sem_dup_low', keptId: 'sem_dup_high' }]);
    expect(plan.rerender.map((entry) => entry.id)).toEqual(['sem_dup_high']);
  });

  it('is_deleted=1 행과 triple 컬럼이 없는 행은 건드리지 않는다', () => {
    insertEpisodic('ep_5', '제외 대상 본문');
    insertSemantic({
      id: 'sem_deleted',
      content: '제외 대상 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      sourceId: 'ep_5',
    });
    db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'sem_deleted'").run();
    db.prepare(`
      INSERT INTO memory_item (id, type, content, is_deleted, origin_source)
      VALUES ('sem_no_triple', 'semantic', '제외 대상 본문', 0, ?)
    `).run(JSON.stringify({ context: { source_episodic_id: 'ep_5' } }));

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run scripts/repair-duplicate-semantic-content.spec.ts
```

Expected: FAIL — `Failed to load .../repair-duplicate-semantic-content.js` (모듈 없음).

- [ ] **Step 4: 스크립트 구현**

`scripts/repair-duplicate-semantic-content.ts`를 만든다.

```ts
#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';
/**
 * #1137: 원문 폴백(#768 경로)이 만든 중복 본문 semantic 기억을 정리한다.
 *
 * 1) content가 원본 episodic 본문(또는 500자 절단형)과 정확히 일치하는 semantic 행만 고른다
 * 2) triple 컬럼으로 다시 렌더한다 — canonicalize 성공분은 한국어 문장, 나머지는 `s · p · o`
 * 3) 재렌더 후에도 (subject, predicate, object, owner, project)가 같은 행은 진짜 중복이므로
 *    confidence 최대 1건만 남기고 soft-delete 한다
 *
 * 사용:
 *   DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic            # dry-run
 *   DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic -- --apply
 */

import {
  closeDatabase,
  initializeDatabase,
  MemoryEmbeddingService,
  PredicateCanonicalizer,
  SemanticMemoryScoring,
} from '@memento/core';

interface CandidateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  content: string;
  confidence: number | null;
  owner_id: string | null;
  project_id: string | null;
}

export interface RerenderEntry {
  id: string;
  before: string;
  after: string;
}

export interface DeletionEntry {
  id: string;
  keptId: string;
}

export interface DuplicatePlan {
  rerender: RerenderEntry[];
  deletions: DeletionEntry[];
}

/**
 * 원문 폴백 형태만 정확히 고른다. 정규식이 아니라 원본 본문과의 문자열 동일성으로 판정하므로
 * 정상 문장 행을 건드릴 수 없다 (repair-triple-sentence-memories.ts와 같은 원리).
 */
const CANDIDATE_SQL = `
  SELECT s.id, s.subject, s.predicate, s.object, s.content,
         s.confidence, s.owner_id, s.project_id
  FROM memory_item s
  JOIN memory_item e
    ON e.id = json_extract(s.origin_source, '$.context.source_episodic_id')
  WHERE s.type = 'semantic'
    AND s.is_deleted = 0
    AND s.subject IS NOT NULL
    AND s.predicate IS NOT NULL
    AND s.object IS NOT NULL
    AND json_valid(s.origin_source)
    AND e.type = 'episodic'
    AND (
      s.content = e.content
      OR s.content = substr(e.content, 1, 500) || '…'
    )
  ORDER BY s.id
`;

function groupKey(row: CandidateRow, predicate: string): string {
  return [row.subject, predicate, row.object, row.owner_id ?? '', row.project_id ?? ''].join(' ');
}

export function buildDuplicatePlan(db: CliDatabase): DuplicatePlan {
  const scoring = new SemanticMemoryScoring();
  const canonicalizer = new PredicateCanonicalizer();
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];

  const groups = new Map<string, Array<{ row: CandidateRow; after: string }>>();

  for (const row of candidates) {
    // 쓰기 경로와 같은 정규화를 거쳐야 재렌더 결과가 신규 생성과 일치한다
    const canonical = canonicalizer.canonicalize(row.predicate);
    const predicate = canonical.success ? canonical.canonical : row.predicate;
    const after = scoring.tripleToNaturalLanguage(row.subject, predicate, row.object);
    const key = groupKey(row, predicate);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push({ row, after });
    } else {
      groups.set(key, [{ row, after }]);
    }
  }

  const rerender: RerenderEntry[] = [];
  const deletions: DeletionEntry[] = [];

  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) => {
      const confidenceDiff = (b.row.confidence ?? 0) - (a.row.confidence ?? 0);
      return confidenceDiff !== 0 ? confidenceDiff : a.row.id.localeCompare(b.row.id);
    });
    const [kept, ...rest] = sorted;
    if (!kept) {
      continue;
    }
    if (kept.after !== kept.row.content) {
      rerender.push({ id: kept.row.id, before: kept.row.content, after: kept.after });
    }
    for (const duplicate of rest) {
      deletions.push({ id: duplicate.row.id, keptId: kept.row.id });
    }
  }

  rerender.sort((a, b) => a.id.localeCompare(b.id));
  deletions.sort((a, b) => a.id.localeCompare(b.id));
  return { rerender, deletions };
}

async function applyPlan(db: CliDatabase, plan: DuplicatePlan): Promise<void> {
  const updateContent = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');
  const softDelete = db.prepare('UPDATE memory_item SET is_deleted = 1 WHERE id = ?');

  const runAll = db.transaction((input: DuplicatePlan) => {
    for (const entry of input.rerender) {
      updateContent.run(entry.after, entry.id);
    }
    for (const entry of input.deletions) {
      softDelete.run(entry.id);
    }
  });
  runAll(plan);

  // content가 바뀐 행의 기존 임베딩은 낡은 벡터다. 실패해도 content 복구는 커밋되었으므로 경고만.
  const embeddingService = new MemoryEmbeddingService();
  for (const entry of plan.rerender) {
    try {
      await embeddingService.createAndStoreEmbedding(db, entry.id, entry.after, 'semantic');
    } catch (error) {
      console.warn(
        `[repair] 임베딩 재생성 실패 (무시): ${entry.id} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function printPlan(plan: DuplicatePlan, apply: boolean): void {
  console.log(`재렌더 대상: ${plan.rerender.length}건 (${apply ? '적용' : 'dry-run'})`);
  for (const entry of plan.rerender.slice(0, 20)) {
    console.log(`  ${entry.id}`);
    console.log(`    - ${entry.before.slice(0, 120)}`);
    console.log(`    + ${entry.after}`);
  }
  if (plan.rerender.length > 20) {
    console.log(`  … 외 ${plan.rerender.length - 20}건`);
  }

  console.log(`완전중복 soft-delete 대상: ${plan.deletions.length}건`);
  for (const entry of plan.deletions.slice(0, 20)) {
    console.log(`  ${entry.id} → 유지 ${entry.keptId}`);
  }
  if (plan.deletions.length > 20) {
    console.log(`  … 외 ${plan.deletions.length - 20}건`);
  }
}

async function main(): Promise<void> {
  const apply = parseCliArgs().args.includes('--apply');
  let db: CliDatabase | null = null;

  try {
    db = await initializeDatabase();
    const plan = buildDuplicatePlan(db);
    printPlan(plan, apply);

    const total = plan.rerender.length + plan.deletions.length;
    if (apply && total > 0) {
      await applyPlan(db, plan);
      console.log('✅ 정리 완료');
    } else if (!apply && total > 0) {
      console.log('ℹ️ 실제 수정은 --apply 를 붙여 실행하세요');
    }
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error('정리 실패:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run scripts/repair-duplicate-semantic-content.spec.ts
```

Expected: 5건 PASS. `status` 케이스가 실패하면 `tripleToNaturalLanguage`가 `review · status · approved`를 만드는지 확인한다.

- [ ] **Step 6: npm 스크립트 등재**

`package.json`의 `"memory:repair-triple-sentences"` 줄 **다음**에 추가한다.

```json
    "memory:repair-duplicate-semantic": "tsx scripts/repair-duplicate-semantic-content.ts",
```

- [ ] **Step 7: 라이브 DB에 dry-run — 대상 규모가 실측과 맞는지 확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
DB_PATH=$HOME/.memento/data/memory.db npm run memory:repair-duplicate-semantic 2>&1 | tail -20
```

Expected: 재렌더 + 삭제 대상 합계가 스펙 §2.1의 중복 본문 1,566행과 같은 자릿수(수백~1,566)여야 한다.
**수십 건 이하로 나오면 멈추고 보고한다** — `origin_source.context.source_episodic_id` 조인이 구형 행을 못 잡는다는 뜻이고, 그때는 `extracted_from` 관계 테이블 경유 조인을 추가해야 한다(계획 변경 사항이므로 사용자 승인 필요). `--apply`는 이 단계에서 실행하지 않는다.

- [ ] **Step 8: 운영 문서 갱신**

`docs/agents/commands.md`의 `memory:repair-triple-sentences` 블록(173-178행) 바로 뒤에 추가한다.

```markdown
#1137 의 중복 본문 semantic 기억(원문 폴백이 만든 사본)은 재렌더 후 완전중복만 정리합니다. 기본이 dry-run이고, `--apply` 전에 MCP 서버를 멈추세요.

```bash
DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic            # dry-run
DB_PATH=./data/memory.db npm run memory:repair-duplicate-semantic -- --apply # 적용
```
```

- [ ] **Step 9: 커밋**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add scripts/repair-duplicate-semantic-content.ts \
        scripts/repair-duplicate-semantic-content.spec.ts \
        package.json docs/agents/commands.md
git commit -m "$(cat <<'EOF'
feat(scripts): 중복 본문 semantic 기억 정리 스크립트를 추가한다 (#1137)

원문 폴백이 만든 사본 1,566행을 triple 컬럼으로 재렌더하고, 재렌더 후에도
(subject, predicate, object, owner, project)가 같은 행만 confidence 최대
1건을 남겨 soft-delete 한다. 대상 선정은 정규식이 아니라 원본 episodic
본문과의 문자열 동일성이라 정상 문장 행을 건드릴 수 없다. 기본 dry-run,
적용은 --apply.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 전수 검증 · CHANGELOG · PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `specs/681-1137-duplicate-semantic-content/spec.md` (§5 성공 기준 실측값)

**Interfaces:**
- Consumes: Task 1~5 전체
- Produces: PR

- [ ] **Step 1: 전수 검증**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npm run lint && npm run type-check && npm test
```

Expected: 전부 exit 0. 실패하면 수치·에러 원문을 그대로 보고한다 — 통과했다고 쓰지 않는다.

- [ ] **Step 2: 회귀 초점 테스트 재확인**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
npx vitest run \
  packages/memento-core/src/domains/memory/semantic/ \
  packages/memento-core/src/domains/relation/services/triple-extraction/ \
  packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts \
  scripts/repair-duplicate-semantic-content.spec.ts \
  scripts/repair-triple-sentence-memories.spec.ts
```

Expected: 전부 PASS. 특히 `predicate-gate-persist.spec.ts`·`semantic-memory-quality-persistence.spec.ts`·`episodic-semantic-conversion.spec.ts`에 회귀가 없어야 한다.

- [ ] **Step 3: CHANGELOG 항목 추가**

`CHANGELOG.md` 최신 미배포 섹션에 추가한다 (기존 항목 형식을 그대로 따른다).

```markdown
- fix(semantic): triple 재조립 실패 시 원문 대신 triple 구성 요소를 content로 쓴다. 같은 본문의 semantic 사본이 더 이상 생기지 않는다 (#1137)
- fix(relation): 영문 predicate 변형(-s/-es/-ed/-ing)을 어간으로 되돌려 canonical에 연결하고, 추출 프롬프트가 한글 ㅁ형 predicate를 강제한다 (#1137)
- fix(memory): `memory_injection`이 content 기준으로 중복을 제거해 사본이 토큰 예산을 먹지 않는다 (#1137)
- feat(scripts): `npm run memory:repair-duplicate-semantic` — 기존 중복 본문 semantic 기억을 재렌더하고 완전중복만 정리한다 (#1137)
```

- [ ] **Step 4: graphify 재빌드 (커밋하지 않음)**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git status --porcelain | grep graphify-out || echo "graphify-out 미추적 확인"
```

Expected: `graphify-out/`이 커밋 대상에 들어가지 않는다.

- [ ] **Step 5: 스펙 성공 기준에 실측값 기록**

`specs/681-1137-duplicate-semantic-content/spec.md` §5 표의 각 SC 옆에 실제 측정 결과를 적는다.
SC-004(실 LLM 프로브)를 실행하지 못했다면 「미측정 — OPENAI_API_KEY 없음」으로 명시한다. 추정값을 쓰지 않는다.
SC-005는 `--apply`를 아직 하지 않았다면 「dry-run 대상 N건 확인, 적용 대기」로 적는다.

- [ ] **Step 6: 커밋하고 PR 생성**

```bash
cd /home/jee1lee/git/memento-worktrees/issue-1137-duplicate-semantic-content
git add CHANGELOG.md specs/681-1137-duplicate-semantic-content/spec.md
git commit -m "$(cat <<'EOF'
docs(changelog): #1137 중복 본문 semantic 기억 수정 기록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin issue/1137-duplicate-semantic-content
gh pr create --title "fix(semantic): triple 폴백이 만든 중복 본문 semantic 기억을 막고 기존 부채를 정리한다 (#1137)" --body "$(cat <<'EOF'
## 무엇을

#1137. triple 재조립 실패 시 원문 폴백이 같은 본문의 semantic 행을 다수 만들고, `memory_injection`이 그 사본으로 토큰 예산을 태우는 문제.

## 실측으로 확인한 것

쓰기 측 누수는 #813 게이트(`3e3b31b0`, 2026-09-05)로 **이미 닫혀 있었다** — 게이트 이후 생성된 semantic 832행 중 중복 본문 0건, 영문 predicate semantic 마지막 생성은 2026-09-04. 이슈 본문의 "2026-09에도 쌓인다"는 게이트 이전(9/01~9/04) 물량이다. 그래서 남은 과제를 **기존 부채 1,566행 정리 + 읽기 측 중복 제거**로 재정의하고, 쓰기 경로 수정은 회귀 방지 다중 방어선으로 넣었다.

## 변경

- **A** `tripleToNaturalLanguage`의 원문 폴백을 제거하고 `s · p · o`로 대체. content가 triple에 종속되므로 사본이 구조적으로 불가능해진다. 형태(2)가 쓰기 경로에서 0이 되어 #813 SC-006을 더 강하게 만족한다
- **B1** 추출 프롬프트가 predicate를 한글 ㅁ형 단일 토큰으로 강제. 게이트의 실질 통과 조건을 프롬프트에 명시하고 canonical 26종 목록·대조 예시를 넣었다. 계약 테스트가 사전↔프롬프트 동기화를 강제한다
- **B2** canonicalizer가 `-s`/`-es`/`-ies`/`-ed`/`-ing` 변형을 어간으로 되돌린다 (`uses`→`use`→`사용함`). 실측 상위 동사를 능동 ㅁ형 canonical 5종으로 등재
- **D** `memory_injection`이 content 프리픽스 기준으로 중복을 제거. overfetch 루프 안에서 하므로 사본이 걷힌 만큼 `searchLimit`이 확장된다
- **E** `npm run memory:repair-duplicate-semantic` — 기존 행을 재렌더하고 완전중복만 soft-delete (기본 dry-run)

## 범위 밖 (스펙 §7)

계사·속성 predicate 지원(`A은 B를 입니다` 조사 불일치 → 렌더러 재설계 필요), long tail 수용(#813 동결 유지), importance 0.1→0.95 점프, Reflexion procedural 중복, #804 FR-001b 재검토.

## 검증

`npm run lint` · `type-check` · `test` 전량 통과. 설계·실측은 `specs/681-1137-duplicate-semantic-content/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: 라이브 적용은 별도 승인 후**

`--apply`는 PR 머지 후 운영 절차로 실행한다. 실행 전 MCP 서버를 멈추고, `npm run db:pre-docker-deploy`로 무결성을 점검하고, dry-run 출력을 사용자에게 보여 승인을 받는다. 이 계획은 `--apply`를 자동 실행하지 않는다.
