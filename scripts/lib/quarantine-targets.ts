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

export interface FalsePositiveCheck {
  /** FR-002i 위치 비교 */
  positional: number;
  /** _ · % · \ 를 이스케이프한 LIKE — 독립 제2 방식 */
  escapedLike: number;
  /** 대상 중 subject 가 빈 행 (구조적으로 0이어야 한다) */
  emptySubject: number;
  agree: boolean;
}

/**
 * FR-002j: 오탐 판정은 표본이 아니라 전수 검증으로 한다.
 * 표본 50건은 오탐률 6% 미만만 보장하므로 판정 근거가 될 수 없다.
 */
export function crossVerifyTargets(db: CliDatabase): FalsePositiveCheck {
  const positional = countTargets(db);

  // TS 소스의 '\\' 는 SQL 문자열 안에서 백슬래시 1개다. 백슬래시를 먼저 이스케이프해야 한다.
  const escapedLikeRow = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_item
    WHERE type = 'semantic'
      AND subject IS NOT NULL AND subject <> ''
      AND pinned = FALSE
      AND content LIKE
        replace(replace(replace(trim(subject), '\\', '\\\\'), '_', '\\_'), '%', '\\%') || '_ %'
        ESCAPE '\\'
  `).get() as { n: number };

  const emptySubjectRow = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_item
    WHERE (${TARGET_WHERE}) AND (subject IS NULL OR trim(subject) = '')
  `).get() as { n: number };

  return {
    positional,
    escapedLike: escapedLikeRow.n,
    emptySubject: emptySubjectRow.n,
    agree: positional === escapedLikeRow.n && emptySubjectRow.n === 0,
  };
}

export interface SampleRow {
  id: string;
  subject: string;
  content: string;
  importance: number | null;
}

/**
 * FR-002d: ORDER BY id LIMIT n OFFSET <random> 은 연속 블록을 뽑아 같은 세션의 행만 나온다.
 * 반드시 ORDER BY random() 을 쓴다.
 */
export function sampleTargets(db: CliDatabase, size: number): SampleRow[] {
  return db.prepare(`
    SELECT id, subject, content, importance
    FROM memory_item
    WHERE ${TARGET_WHERE}
    ORDER BY random()
    LIMIT ?
  `).all(size) as SampleRow[];
}

export interface Bucket { bucket: string; count: number }

export function importanceBuckets(db: CliDatabase): Bucket[] {
  return db.prepare(`
    SELECT
      CASE
        WHEN importance IS NULL THEN 'NULL'
        WHEN importance >= 0.8 THEN '0.8~1.0'
        WHEN importance >= 0.6 THEN '0.6~0.8'
        WHEN importance >= 0.4 THEN '0.4~0.6'
        WHEN importance >= 0.2 THEN '0.2~0.4'
        ELSE '0.0~0.2'
      END AS bucket,
      COUNT(*) AS count
    FROM memory_item
    WHERE ${TARGET_WHERE}
    GROUP BY bucket
    ORDER BY bucket
  `).all() as Bucket[];
}

export interface Attribution {
  total: number;
  withProject: number;
  withOwner: number;
  nonPrivate: number;
  softDeleted: number;
}

/** FR-001d: NULL 이 아닌 값이 나타나면 파이프라인이 귀속을 채우기 시작했다는 뜻이다. */
export function attributionCounts(db: CliDatabase): Attribution {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) AS withProject,
      SUM(CASE WHEN owner_id IS NOT NULL THEN 1 ELSE 0 END) AS withOwner,
      SUM(CASE WHEN privacy_scope IS NOT NULL AND privacy_scope <> 'private' THEN 1 ELSE 0 END) AS nonPrivate,
      SUM(CASE WHEN is_deleted THEN 1 ELSE 0 END) AS softDeleted
    FROM memory_item
    WHERE ${TARGET_WHERE}
  `).get() as Attribution;
}

/** FR-001a: 판별식에 걸릴 뻔했으나 pinned 라 빠진 항목. forget 은 pinned 에서 예외를 던진다. */
export function pinnedCandidates(db: CliDatabase): string[] {
  const rows = db.prepare(`
    SELECT id FROM memory_item
    WHERE ${FORM_UNIVERSE} AND pinned = TRUE AND (${FORM_ONE_EXPR})
    ORDER BY id
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export interface MonthlyFallback { month: string; total: number; fallback: number; rate: number }

/** FR-001c: 형태 (2) 비중이 커지면 FR-001b 의 제외 근거(무시 가능)가 무너진다. */
export function fallbackTrendByMonth(db: CliDatabase): MonthlyFallback[] {
  const rows = db.prepare(`
    SELECT
      substr(created_at, 1, 7) AS month,
      COUNT(*) AS total,
      SUM(CASE WHEN (${FORM_ONE_EXPR}) OR (${FORM_THREE_EXPR}) THEN 0 ELSE 1 END) AS fallback
    FROM memory_item
    WHERE ${FORM_UNIVERSE}
    GROUP BY month
    ORDER BY month
  `).all() as Array<{ month: string; total: number; fallback: number }>;

  return rows.map((row) => ({ ...row, rate: row.total === 0 ? 0 : row.fallback / row.total }));
}
