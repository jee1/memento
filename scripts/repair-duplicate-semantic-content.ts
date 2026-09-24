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
  return [row.subject, predicate, row.object, row.owner_id ?? '', row.project_id ?? ''].join('\x1f');
}

function renderContent(
  row: CandidateRow,
  scoring: SemanticMemoryScoring,
  canonicalizer: PredicateCanonicalizer,
): string {
  const snapshot = scoring.prepareNormalizedTriple(
    { subject: row.subject, predicate: row.predicate, object: row.object },
    0,
  );
  return scoring.tripleToNaturalLanguage(
    snapshot.subject,
    snapshot.predicate,
    snapshot.object,
  );
}

export function buildDuplicatePlan(db: CliDatabase): DuplicatePlan {
  const scoring = new SemanticMemoryScoring();
  const canonicalizer = new PredicateCanonicalizer();
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];

  const processed = candidates.map((row) => {
    const snapshot = scoring.prepareNormalizedTriple(
      { subject: row.subject, predicate: row.predicate, object: row.object },
      0,
    );
    const after = renderContent(row, scoring, canonicalizer);
    return { row, snapshot, after };
  });

  const rerender: RerenderEntry[] = [];
  for (const { row, after } of processed) {
    if (after !== row.content) {
      rerender.push({ id: row.id, before: row.content, after });
    }
  }

  const groups = new Map<string, Array<{ row: CandidateRow; confidence: number }>>();
  for (const { row, snapshot } of processed) {
    const key = groupKey(row, snapshot.predicate);
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

async function applyPlan(db: CliDatabase, plan: DuplicatePlan): Promise<void> {
  const updateContent = db.prepare('UPDATE memory_item SET content = ? WHERE id = ?');
  const softDelete = db.prepare('UPDATE memory_item SET is_deleted = 1 WHERE id = ?');
  const runAll = db.transaction(() => {
    for (const entry of plan.rerender) {
      updateContent.run(entry.after, entry.id);
    }
    for (const entry of plan.deletions) {
      softDelete.run(entry.id);
    }
  });
  runAll();

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
    console.log(`    - ${entry.before}`);
    console.log(`    + ${entry.after}`);
  }
  if (plan.rerender.length > 20) {
    console.log(`  … 외 ${plan.rerender.length - 20}건`);
  }
  if (plan.deletions.length > 0) {
    console.log(`완전중복 soft-delete: ${plan.deletions.length}건`);
    for (const entry of plan.deletions.slice(0, 20)) {
      console.log(`  ${entry.id} (유지: ${entry.keptId})`);
    }
    if (plan.deletions.length > 20) {
      console.log(`  … 외 ${plan.deletions.length - 20}건`);
    }
  }
}

async function main(): Promise<void> {
  const apply = parseCliArgs().args.includes('--apply');
  let db: CliDatabase | null = null;

  try {
    db = await initializeDatabase();
    const plan = buildDuplicatePlan(db);
    printPlan(plan, apply);

    if (apply && (plan.rerender.length > 0 || plan.deletions.length > 0)) {
      await applyPlan(db, plan);
      console.log('✅ 정리 완료');
    } else if (!apply && (plan.rerender.length > 0 || plan.deletions.length > 0)) {
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
    console.error('정리 실패:', error);
    process.exit(1);
  });
}
