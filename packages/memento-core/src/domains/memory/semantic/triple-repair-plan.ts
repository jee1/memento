/**
 * #768: 옛 triple 템플릿이 남긴 손상된 semantic memory 문장을 판정한다.
 *
 * 옛 템플릿은 `${subject}는 ${object}를 ${predicate}합니다` 였다. subject/predicate/object 컬럼이
 * 그대로 남아 있으므로, content 가 옛 템플릿과 정확히 일치하는 행만 골라 새 렌더러로 다시 만든다.
 * 정규식 대신 템플릿 동일성으로 고르기 때문에 `포함합니다` 같은 정상 문장을 건드리지 않는다.
 *
 * 판정만 하고 DB 에 쓰지 않는다. 적용은 호출자가 한다.
 *
 * #1156: 이 파일이 판정 로직의 단일 출처다. `scripts/` 는 npm 발행 tarball 의 `files` 에 없어
 * 마이그레이션이 `scripts/` 를 import 하면 배포판에서 깨진다. 그래서 core 안에 둔다.
 */

import type Database from 'better-sqlite3';
import { buildTripleSentence, hasBrokenTripleConjugation } from './triple-sentence.js';

interface CandidateRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  content: string;
}

export interface RepairPlanEntry {
  id: string;
  before: string;
  after: string;
}

export interface RepairPlan {
  repairable: RepairPlanEntry[];
  /** 옛 템플릿과 일치하지만 새 렌더러도 문장을 만들 수 없는 행 */
  unrenderable: string[];
  /** 손상 신호는 있으나 triple 컬럼이 없어 복구 불가능한 행 */
  missingComponents: string[];
}

/** 옛 템플릿과 정확히 일치하는 행만 고른다 (SQL 문자열 결합으로 오탐 0). */
const CANDIDATE_SQL = `
  SELECT id, subject, predicate, object, content
  FROM memory_item
  WHERE type = 'semantic'
    AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL
    AND content = subject || '는 ' || object || '를 ' || predicate || '합니다'
`;

const MISSING_COMPONENT_SQL = `
  SELECT id, content
  FROM memory_item
  WHERE type = 'semantic'
    AND (subject IS NULL OR predicate IS NULL OR object IS NULL)
`;

export function buildRepairPlan(db: Database.Database): RepairPlan {
  const candidates = db.prepare(CANDIDATE_SQL).all() as CandidateRow[];
  const repairable: RepairPlanEntry[] = [];
  const unrenderable: string[] = [];

  for (const row of candidates) {
    const rendered = buildTripleSentence(row.subject, row.predicate, row.object);
    if (!rendered) {
      unrenderable.push(row.id);
      continue;
    }
    if (rendered !== row.content) {
      repairable.push({ id: row.id, before: row.content, after: rendered });
    }
  }

  const missingComponents = (
    db.prepare(MISSING_COMPONENT_SQL).all() as Array<{ id: string; content: string }>
  )
    .filter((row) => hasBrokenTripleConjugation(row.content))
    .map((row) => row.id);

  return { repairable, unrenderable, missingComponents };
}
