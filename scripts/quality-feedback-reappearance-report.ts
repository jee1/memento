#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * SC-001: 도입 전/후 top-5 재등장률 비교 리포트 (기준선)
 *
 * 두 번의 검색 결과 집계(예: 피드백 루프 적용 전 스냅샷 vs 후)를 비교할 때
 * 동일 쿼리·동일 ground truth에 대해 관련 문서가 top-5 안에 다시 나타난 비율을 계산합니다.
 * 인자로 두 JSON 파일 경로을 넘기지 않으면 사용법만 출력합니다.
 */

import { readFileSync } from 'fs';

interface Snapshot {
  /** queryId -> benchmark_id[] 상위 순서 */
  results: Record<string, string[]>;
}

/** 분모: `relevantByQuery`의 모든 쿼리(벤치마크 정의). 스냅샷에 키가 없으면 top-5가 비어 있는 것으로 보아 미스(0)로 처리 */
export function reappearanceRate(snap: Snapshot, relevantByQuery: Record<string, string[]>): number {
  const queryIds = Object.keys(relevantByQuery);
  if (queryIds.length === 0) {
    return 0;
  }
  let hit = 0;
  for (const q of queryIds) {
    const top5 = snap.results[q]?.slice(0, 5) ?? [];
    const rel = new Set(relevantByQuery[q] ?? []);
    if (top5.some((id) => rel.has(id))) {
      hit++;
    }
  }
  return hit / queryIds.length;
}

function main(): void {
  const argv = parseCliArgs().args;
  if (argv.length < 4) {
    console.log(`Usage:
  npx tsx scripts/quality-feedback-reappearance-report.ts --before <before.json> --after <after.json> --relevant <relevant.json>

relevant.json 형식: { "q1": ["id_a","id_b"], ... }
before/after.json 형식: { "results": { "q1": ["id_x", ...], ... } }

개선 목표: (after - before) / before >= 0.10 이면 SC-001 통과 후보.`);
    process.exit(0);
  }

  let beforePath = '';
  let afterPath = '';
  let relPath = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--before' && argv[i + 1]) {
      beforePath = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--after' && argv[i + 1]) {
      afterPath = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--relevant' && argv[i + 1]) {
      relPath = argv[i + 1]!;
      i++;
    }
  }

  if (!beforePath || !afterPath || !relPath) {
    console.error('Missing --before, --after, or --relevant');
    process.exit(1);
  }

  const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Snapshot;
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as Snapshot;
  const relevantByQuery = JSON.parse(readFileSync(relPath, 'utf8')) as Record<string, string[]>;

  const r0 = reappearanceRate(before, relevantByQuery);
  const r1 = reappearanceRate(after, relevantByQuery);
  const relImprove = r0 > 0 ? (r1 - r0) / r0 : r1 > 0 ? 1 : 0;

  console.log(JSON.stringify({
    reappearance_rate_before: r0,
    reappearance_rate_after: r1,
    relative_improvement: relImprove,
    sc001_target_met: relImprove >= 0.1,
  }, null, 2));
}

if (isMain(import.meta.url)) {
  main();
}
