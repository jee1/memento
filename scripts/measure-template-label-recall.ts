/**
 * #1445 읽기 전용 측정. #1448 백필은 건수만 세고 쓰지 않는다.
 * 사용: npx tsx scripts/measure-template-label-recall.ts [--embed]
 * DB_PATH 가 없으면 ~/.memento/.env 의 DB_PATH 를 읽는다. 경로와 본문은 출력하지 않는다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  meanReciprocalRank,
  parseTemplateFields,
  rankOfSelf,
  stripTemplate,
  summarizePairwiseJaccard,
  type TemplateFields,
} from '../packages/memento-core/src/domains/consolidation/services/template-label-recall-measure.js';
import { workRecordSearchText, type WorkRecord } from '../packages/memento-core/src/domains/memory/remember/work-record.js';

const LABEL_TOKENS = ['결정', '근거', '다음', '없음'] as const;
const PAIR_SAMPLE = 120;
const EMBED_SAMPLE = 48;

interface Row {
  type: string;
  content: string;
  created_at: string;
}

function envDbPath(): string | null {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  try {
    const text = readFileSync(join(homedir(), '.memento', '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^DB_PATH=(.*)$/);
      if (!match) continue;
      const value = match[1];
      if (value === undefined) continue;
      return value.trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    return null;
  }
  return null;
}

function memoryDbCandidates(): string[] {
  const found: string[] = [];
  const root = join(homedir(), '.memento');
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let isDir: boolean;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (name === 'node_modules') continue;
        walk(path, depth + 1);
      } else if (name === 'memory.db') {
        found.push(path);
      }
    }
  };
  walk(root, 0);
  const fromEnv = envDbPath();
  if (fromEnv) found.unshift(fromEnv);
  return [...new Set(found)];
}

function openMeasurementDb(): Database.Database {
  let best: { db: Database.Database; decisions: number } | null = null;
  for (const path of memoryDbCandidates()) {
    try {
      const db = new Database(path, { readonly: true, fileMustExist: true });
      const row = db.prepare("SELECT count(*) AS n FROM memory_item WHERE content LIKE '%결정:%'").get() as {
        n: number;
      };
      if (!best || row.n > best.decisions) {
        best?.db.close();
        best = { db, decisions: row.n };
      } else {
        db.close();
      }
    } catch {
      continue;
    }
  }
  if (!best || best.decisions === 0) {
    throw new Error('no readable memory.db with template rows');
  }
  return best.db;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(items: T[], count: number, random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const left = copy[i];
    const right = copy[j];
    if (left === undefined || right === undefined) continue;
    copy[i] = right;
    copy[j] = left;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function vectorAt(vectors: number[][], index: number): number[] {
  const vector = vectors[index];
  if (!vector) throw new Error('embedding index missing');
  return vector;
}

function toWorkRecord(fields: TemplateFields): WorkRecord {
  const failed = fields['안 통한 것'] === '없음' ? '' : fields['안 통한 것'];
  return {
    decision: fields.결정,
    rationale: fields.근거,
    rejected: fields['버린 대안'],
    failed,
    next_blocker: fields['다음 걸림돌'],
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarizeFields(rows: Array<{ fields: TemplateFields }>): { noneFailed: number } {
  const noneFailed = rows.filter((row) => row.fields['안 통한 것'] === '없음').length;
  return { noneFailed };
}

async function embedSample(
  rows: Array<{ content: string; fields: TemplateFields }>,
): Promise<Record<string, number>> {
  const { MiniLMEmbeddingService } = await import(
    '../packages/memento-core/src/domains/embedding/services/minilm-embedding-service.js'
  );
  const service = new MiniLMEmbeddingService();
  const labeledVectors: number[][] = [];
  const strippedVectors: number[][] = [];
  const queryVectors: number[][] = [];

  for (const row of rows) {
    const labeled = await service.generateEmbedding(row.content);
    const strippedText = stripTemplate(row.content);
    const stripped = await service.generateEmbedding(strippedText);
    const queryText = row.fields.결정 || strippedText;
    const query = await service.generateEmbedding(queryText);
    if (!labeled || !stripped || !query) {
      throw new Error('embedding returned null');
    }
    labeledVectors.push(Array.from(labeled.embedding));
    strippedVectors.push(Array.from(stripped.embedding));
    queryVectors.push(Array.from(query.embedding));
    process.stderr.write(`embed ${labeledVectors.length}/${rows.length}\n`);
  }

  const labeledRanks: number[] = [];
  const strippedRanks: number[] = [];
  const labeledGaps: number[] = [];
  const strippedGaps: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const queryVector = vectorAt(queryVectors, i);
    const labeledVector = vectorAt(labeledVectors, i);
    const strippedVector = vectorAt(strippedVectors, i);
    labeledRanks.push(rankOfSelf(queryVector, labeledVectors, i));
    strippedRanks.push(rankOfSelf(queryVector, strippedVectors, i));
    const labeledSelf = dot(queryVector, labeledVector);
    const strippedSelf = dot(queryVector, strippedVector);
    labeledGaps.push(labeledSelf - meanOthers(queryVector, labeledVectors, i));
    strippedGaps.push(strippedSelf - meanOthers(queryVector, strippedVectors, i));
  }

  let unrelatedLabeled = 0;
  let unrelatedStripped = 0;
  let pairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const leftLabeled = vectorAt(labeledVectors, i);
      const rightLabeled = vectorAt(labeledVectors, j);
      const leftStripped = vectorAt(strippedVectors, i);
      const rightStripped = vectorAt(strippedVectors, j);
      unrelatedLabeled += dot(leftLabeled, rightLabeled);
      unrelatedStripped += dot(leftStripped, rightStripped);
      pairs += 1;
    }
  }

  return {
    sample: rows.length,
    labeledMrr: round(meanReciprocalRank(labeledRanks)),
    strippedMrr: round(meanReciprocalRank(strippedRanks)),
    labeledTop1: labeledRanks.filter((rank) => rank === 1).length,
    strippedTop1: strippedRanks.filter((rank) => rank === 1).length,
    meanLabeledGap: round(average(labeledGaps)),
    meanStrippedGap: round(average(strippedGaps)),
    meanUnrelatedLabeledCosine: round(unrelatedLabeled / pairs),
    meanUnrelatedStrippedCosine: round(unrelatedStripped / pairs),
    labeledPairsAtLeast075: countAtLeast(labeledVectors, 0.75),
    strippedPairsAtLeast075: countAtLeast(strippedVectors, 0.75),
    labeledPairsAtLeast085: countAtLeast(labeledVectors, 0.85),
    strippedPairsAtLeast085: countAtLeast(strippedVectors, 0.85),
    pairCount: pairs,
  };
}

function dot(left: number[], right: number[]): number {
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += (left[i] ?? 0) * (right[i] ?? 0);
  return sum;
}

function meanOthers(query: number[], documents: number[][], selfIndex: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < documents.length; i++) {
    if (i === selfIndex) continue;
    const vector = documents[i];
    if (!vector) continue;
    sum += dot(query, vector);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

function countAtLeast(vectors: number[][], threshold: number): number {
  let count = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const left = vectors[i];
      const right = vectors[j];
      if (!left || !right) continue;
      if (dot(left, right) >= threshold) count += 1;
    }
  }
  return count;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ftsTop(db: Database.Database, token: string): { hitCount: number; top20Template: number; error?: string } {
  try {
    const hit = db
      .prepare('SELECT count(*) AS n FROM memory_item_fts WHERE memory_item_fts MATCH ?')
      .get(`"${token}"`) as { n: number };
    const rows = db
      .prepare(
        `SELECT m.content AS content
         FROM memory_item_fts
         JOIN memory_item m ON m.rowid = memory_item_fts.rowid
         WHERE memory_item_fts MATCH ?
         ORDER BY bm25(memory_item_fts)
         LIMIT 20`,
      )
      .all(`"${token}"`) as Array<{ content: string }>;
    return {
      hitCount: hit.n,
      top20Template: rows.filter((row) => parseTemplateFields(row.content) !== null).length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { hitCount: 0, top20Template: 0, error: message.slice(0, 180) };
  }
}

async function main(): Promise<void> {
  const embed = process.argv.includes('--embed');
  const db = openMeasurementDb();
  const columns = new Set(
    (db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  const deletedClause = columns.has('is_deleted') ? 'AND COALESCE(is_deleted, 0) = 0' : '';
  const rows = db
    .prepare(
      `SELECT type, content, created_at
       FROM memory_item
       WHERE created_at >= '2026-09-01'
         ${deletedClause}
         AND content LIKE '%결정:%'
         AND content LIKE '%근거:%'`,
    )
    .all() as Row[];

  const templates = rows
    .map((row) => ({ ...row, fields: parseTemplateFields(row.content) }))
    .filter((row): row is Row & { fields: TemplateFields } => row.fields !== null);

  const byType: Record<string, number> = {};
  let dashed = 0;
  for (const row of templates) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    if (/^[ \t]*-[ \t]*결정[ \t]*:/m.test(row.content)) dashed += 1;
  }

  const random = mulberry32(1445);
  const pairRows = sample(templates, PAIR_SAMPLE, random);
  const labeled = summarizePairwiseJaccard(pairRows.map((row) => row.content));
  const stripped = summarizePairwiseJaccard(pairRows.map((row) => stripTemplate(row.content)));

  const fts: Record<string, { hitCount: number; top20Template: number; error?: string }> = {};
  for (const token of LABEL_TOKENS) {
    fts[token] = ftsTop(db, token);
  }

  const sinceRows = db
    .prepare(
      `SELECT content FROM memory_item
       WHERE created_at >= '2026-09-01' ${deletedClause}`,
    )
    .all() as Array<{ content: string }>;
  const contentTokenScan: Record<string, { rowsWithToken: number; templateRows: number }> = {};
  for (const token of LABEL_TOKENS) {
    const tokenRe = new RegExp(`(?:^|\\s)${token}(?:$|\\s|:)`, 'm');
    let rowsWithToken = 0;
    let templateRows = 0;
    for (const row of sinceRows) {
      if (!tokenRe.test(row.content)) continue;
      rowsWithToken += 1;
      if (parseTemplateFields(row.content)) templateRows += 1;
    }
    contentTokenScan[token] = { rowsWithToken, templateRows };
  }

  let wouldRewrite = 0;
  let missingRequired = 0;
  for (const row of templates) {
    const record = toWorkRecord(row.fields);
    if (!record.decision || !record.rationale || !record.rejected || !record.next_blocker) {
      missingRequired += 1;
      continue;
    }
    if (workRecordSearchText(record) !== row.content.trim()) wouldRewrite += 1;
  }

  const report: Record<string, unknown> = {
    since: '2026-09-01',
    candidateRows: rows.length,
    templateRows: templates.length,
    byType,
    dashedDecision: dashed,
    failedIsNone: summarizeFields(templates).noneFailed,
    duplicationPenalty: {
      sample: pairRows.length,
      labeled: { ...labeled, mean: round(labeled.mean), p50: round(labeled.p50), p90: round(labeled.p90) },
      stripped: { ...stripped, mean: round(stripped.mean), p50: round(stripped.p50), p90: round(stripped.p90) },
    },
    fts,
    contentTokenScan,
    scannedRowsSince: sinceRows.length,
    backfillPlan: {
      parsed: templates.length,
      unparsedCandidates: rows.length - templates.length,
      missingRequired,
      wouldRewriteContent: wouldRewrite,
      apply: false,
    },
  };

  if (embed) {
    report.embedding = await embedSample(sample(templates, EMBED_SAMPLE, mulberry32(1446)));
  }

  db.close();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`measure failed: ${message.replace(/\/\S+/g, '/…')}\n`);
  process.exit(1);
});
