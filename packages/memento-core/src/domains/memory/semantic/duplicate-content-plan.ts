/**
 * #1137: 원문 폴백(#768 경로)이 만든 중복 본문 semantic 기억을 판정한다.
 *
 * 1) content 가 다른 semantic 행과 중복인 행만 고른다 (부채 행은 origin_source 가 비어 있어 조인 불가)
 * 2) triple 컬럼으로 다시 렌더한다 — canonicalize 성공분은 한국어 문장, 나머지는 `s · p · o`
 * 3) 재렌더 후에도 (subject, predicate, object, owner, project)가 같은 행은 진짜 중복이므로
 *    confidence 최대 1건만 남기고 soft-delete 한다
 *
 * 판정만 하고 DB 에 쓰지 않는다. 적용은 호출자가 한다.
 *
 * #1139: 이 파일이 판정 로직의 단일 출처다. `scripts/` 는 npm 발행 tarball 의 `files` 에 없어
 * 마이그레이션이 `scripts/` 를 import 하면 배포판에서 깨진다. 그래서 core 안에 둔다.
 */

import type Database from 'better-sqlite3';
import { PredicateCanonicalizer } from '../../relation/services/triple-extraction/predicate-canonicalizer.js';
import { SemanticMemoryScoring } from './semantic-memory-scoring.js';

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
 * content 가 다른 semantic 행과 중복인 행만 고른다.
 *
 * 부채 행은 `origin_source` 가 `{}` 라 원본 episodic 을 조인으로 찾을 수 없다(실측: 4,523행 중
 * `context.source_episodic_id` 보유가 343행, 그 중 content 가 원본과 일치하는 행은 0). 반면 증상인
 * «같은 본문 사본» 은 content 중복으로 정확히 집힌다(실측 1,566행·228그룹).
 *
 * 이미 triple 에서 올바르게 렌더된 행은 재렌더 판정(`after !== content`)에서 자연히 걸러지므로
 * 이 기준으로 정상 행이 바뀌지 않는다.
 */
const CANDIDATE_SQL = `
  WITH duplicated AS (
    SELECT content
    FROM memory_item
    WHERE type = 'semantic'
      AND is_deleted = 0
    GROUP BY content
    HAVING COUNT(*) > 1
  )
  SELECT s.id, s.subject, s.predicate, s.object, s.content,
         s.confidence, s.owner_id, s.project_id
  FROM memory_item s
  JOIN duplicated d ON s.content = d.content
  WHERE s.type = 'semantic'
    AND s.is_deleted = 0
    AND s.subject IS NOT NULL
    AND s.predicate IS NOT NULL
    AND s.object IS NOT NULL
  ORDER BY s.id
`;

function groupKey(row: CandidateRow, predicate: string): string {
  return [row.subject, predicate, row.object, row.owner_id ?? '', row.project_id ?? ''].join('\x1f');
}

/**
 * content는 저장된 subject/object와 canonical predicate에서만 만든다.
 *
 * prepareNormalizedTriple 은 EntityLinker 까지 적용해 `system`→`시스템` 으로 바꾸는데,
 * 이 경로는 subject/object 컬럼을 갱신하지 않으므로 그 값을 쓰면 content 와 컬럼이 갈라지고
 * (raw 기준인) 그룹 키와 content 가 어긋나 중복이 살아남는다. predicate 만 정규화한다.
 */
function renderContent(
  row: CandidateRow,
  scoring: SemanticMemoryScoring,
  predicate: string,
): string {
  return scoring.tripleToNaturalLanguage(row.subject, predicate, row.object);
}

export function buildDuplicatePlan(db: Database.Database): DuplicatePlan {
  const scoring = new SemanticMemoryScoring();
  const canonicalizer = new PredicateCanonicalizer();
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];

  const processed = candidates.map((row) => {
    // 쓰기 경로와 같은 사전을 쓰되 predicate 만 정규화한다 (subject/object 컬럼은 건드리지 않는다)
    const canonical = canonicalizer.canonicalize(row.predicate);
    const predicate = canonical.success ? canonical.canonical : row.predicate;
    const after = renderContent(row, scoring, predicate);
    return { row, predicate, after };
  });

  const rerender: RerenderEntry[] = [];
  for (const { row, after } of processed) {
    if (after !== row.content) {
      rerender.push({ id: row.id, before: row.content, after });
    }
  }

  const groups = new Map<string, Array<{ row: CandidateRow; confidence: number }>>();
  for (const { row, predicate } of processed) {
    const key = groupKey(row, predicate);
    const list = groups.get(key) ?? [];
    list.push({ row, confidence: row.confidence ?? 0 });
    groups.set(key, list);
  }

  const deletions: DeletionEntry[] = [];
  const deleteIds = new Set<string>();
  for (const members of groups.values()) {
    if (members.length <= 1) {
      continue;
    }
    const sorted = [...members].sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.row.id.localeCompare(b.row.id);
    });
    const kept = sorted[0]!;
    for (const loser of sorted.slice(1)) {
      deletions.push({ id: loser.row.id, keptId: kept.row.id });
      deleteIds.add(loser.row.id);
    }
  }

  const filteredRerender = rerender.filter((entry) => !deleteIds.has(entry.id));

  return { rerender: filteredRerender, deletions };
}
