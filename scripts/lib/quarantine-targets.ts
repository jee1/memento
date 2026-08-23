/**
 * #804 격리 대상의 판별과 집계. 읽기 전용 — 이 파일의 어떤 함수도 행을 바꾸지 않는다.
 */

import type { CliDatabase } from './cli.js';

/**
 * FR-001 + FR-002i. LIKE 를 쓰지 않는다 — subject 값이 패턴에 그대로 삽입되면
 * 그 안의 _ · % 가 와일드카드로 해석된다 (실측상 _ 포함 subject 941건).
 * +2 가 공백 자리인 근거: attachParticle 이 조사를 정확히 1글자 붙인다.
 */
export const TARGET_WHERE = `
  type = 'semantic'
  AND subject IS NOT NULL AND subject <> ''
  AND pinned = FALSE
  AND substr(content, 1, length(trim(subject))) = trim(subject)
  AND substr(content, length(trim(subject)) + 2, 1) = ' '
`;

export function countTargets(db: CliDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM memory_item WHERE ${TARGET_WHERE}`).get() as { n: number };
  return row.n;
}

/** ORDER BY id 로 결정적 순서를 준다. 재개 시 같은 배치 경계를 재현하기 위함이다. */
export function listTargetIds(db: CliDatabase, limit?: number): string[] {
  const sql = `SELECT id FROM memory_item WHERE ${TARGET_WHERE} ORDER BY id${limit === undefined ? '' : ' LIMIT ?'}`;
  const rows = (limit === undefined ? db.prepare(sql).all() : db.prepare(sql).all(limit)) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/** 형태 분류의 모수: subject 를 가진 semantic 전체 (pinned 포함 — 제외 규모를 알아야 한다) */
const FORM_UNIVERSE = `type = 'semantic' AND subject IS NOT NULL AND subject <> ''`;

const FORM_ONE_EXPR = `
  substr(content, 1, length(trim(subject))) = trim(subject)
  AND substr(content, length(trim(subject)) + 2, 1) = ' '
`;

/** 형태 (3) 도 LIKE 가 아니라 등호 비교를 쓴다 (FR-002i) */
const FORM_THREE_EXPR = `content = trim(subject) || ' · ' || trim(predicate) || ' · ' || trim(object)`;

export interface FormCounts {
  total: number;
  one: number;
  two: number;
  three: number;
}

export function classifyForms(db: CliDatabase): FormCounts {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${FORM_ONE_EXPR} THEN 1 ELSE 0 END) AS one,
      SUM(CASE WHEN ${FORM_THREE_EXPR} THEN 1 ELSE 0 END) AS three
    FROM memory_item
    WHERE ${FORM_UNIVERSE}
  `).get() as { total: number; one: number | null; three: number | null };

  const one = row.one ?? 0;
  const three = row.three ?? 0;
  return { total: row.total, one, three, two: row.total - one - three };
}

/** FR-001b·SC-003c: 격리에서 제외되는 형태 (2)(3) 의 ID 목록 */
export function listPreservedFormIds(db: CliDatabase): string[] {
  const rows = db.prepare(`
    SELECT id FROM memory_item
    WHERE ${FORM_UNIVERSE} AND NOT (${FORM_ONE_EXPR})
    ORDER BY id
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
