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

  // SQLite LIKE is ASCII-case-insensitive by default; FR-002i positional equality is
  // case-sensitive. Without case_sensitive_like, form-(2) English titles like
  // subject=`task 4 (#766)` / content=`Task 4 (#766): …` inflate escapedLike
  // (live 2026-09-05: +6) and falsely block execute.
  db.pragma('case_sensitive_like = ON');
  let escapedLike: number;
  try {
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
    escapedLike = escapedLikeRow.n;
  } finally {
    db.pragma('case_sensitive_like = OFF');
  }

  const emptySubjectRow = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_item
    WHERE (${TARGET_WHERE}) AND (subject IS NULL OR trim(subject) = '')
  `).get() as { n: number };

  return {
    positional,
    escapedLike,
    emptySubject: emptySubjectRow.n,
    agree: positional === escapedLike && emptySubjectRow.n === 0,
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

export interface KgPreservation { total: number; missing: number; rate: number }

/** FR-004 (b): 자연어 서술이 사라져도 구조화된 사실은 남는다 — 이 확인이 그것을 보장한다. */
export function kgPreservation(db: CliDatabase): KgPreservation {
  // 바깥 조건을 서브쿼리로 분리한다. TARGET_WHERE 의 컬럼을 EXISTS 안에 그대로 두면
  // subject/predicate/object 가 kg_triple 쪽으로 해석돼 조용히 틀린 답이 나온다.
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM kg_triple k
        WHERE k.subject = m.subject AND k.predicate = m.predicate AND k.object = m.object
      ) THEN 0 ELSE 1 END) AS missing
    FROM memory_item m
    WHERE m.id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
  `).get() as { total: number; missing: number | null };

  const missing = row.missing ?? 0;
  return { total: row.total, missing, rate: row.total === 0 ? 1 : (row.total - missing) / row.total };
}

/**
 * FR-004d: 보존되는 저장소가 어떤 상태였는지의 기준선.
 * 한글 종결은 마지막 글자의 코드포인트가 완성형 한글 구간(가~힣)인지로 본다.
 */
export function kgPredicateNormalization(db: CliDatabase): {
  total: number; hangulEnding: number; withSpace: number; avgLength: number;
} {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN unicode(substr(predicate, length(predicate), 1)) BETWEEN 44032 AND 55203
               THEN 1 ELSE 0 END) AS hangulEnding,
      SUM(CASE WHEN predicate LIKE '% %' THEN 1 ELSE 0 END) AS withSpace,
      AVG(length(predicate)) AS avgLength
    FROM kg_triple
    WHERE predicate IS NOT NULL AND predicate <> ''
  `).get() as { total: number; hangulEnding: number | null; withSpace: number | null; avgLength: number | null };

  return {
    total: row.total,
    hangulEnding: row.hangulEnding ?? 0,
    withSpace: row.withSpace ?? 0,
    avgLength: row.avgLength ?? 0,
  };
}

/**
 * FR-006a·006e: 연쇄로 사라질 행과 NULL 이 될 참조를 미리 센다.
 * pragma_foreign_key_list 로 실제 스키마에서 읽으므로 스키마가 바뀌어도 따라간다.
 */
export function cascadeImpact(db: CliDatabase): Array<{
  table: string; column: string; onDelete: string; rows: number;
}> {
  const refs = db.prepare(`
    SELECT m.name AS table_name, fk."from" AS column_name, fk.on_delete AS on_delete
    FROM sqlite_master m
    JOIN pragma_foreign_key_list(m.name) fk
    WHERE m.type = 'table' AND fk."table" = 'memory_item'
    ORDER BY m.name, fk."from"
  `).all() as Array<{ table_name: string; column_name: string; on_delete: string }>;

  return refs.map((ref) => {
    // 식별자는 스키마에서 읽은 값이므로 사용자 입력이 아니다.
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM "${ref.table_name}"
      WHERE "${ref.column_name}" IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
    `).get() as { n: number };
    return { table: ref.table_name, column: ref.column_name, onDelete: ref.on_delete, rows: row.n };
  });
}

/** FR-004 (a): 대상이 episodic·procedural 집합과 겹치지 않음을 코퍼스 수준으로 확인한다. */
export function corpusOverlap(db: CliDatabase): {
  targets: number; episodic: number; procedural: number; overlap: number;
} {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM memory_item WHERE ${TARGET_WHERE}) AS targets,
      (SELECT COUNT(*) FROM memory_item WHERE type = 'episodic') AS episodic,
      (SELECT COUNT(*) FROM memory_item WHERE type = 'procedural') AS procedural,
      (SELECT COUNT(*) FROM memory_item
        WHERE type IN ('episodic', 'procedural')
          AND id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})) AS overlap
  `).get() as { targets: number; episodic: number; procedural: number; overlap: number };
  return row;
}

/**
 * FR-004c: 형태 (2) 는 본문이 원본 episodic 사본이므로 content 일치로 대조할 수 있다.
 * 앞 80자를 쓰는 이유는 원본이 이후 수정됐을 수 있기 때문이다.
 */
export function fallbackOriginSurvival(db: CliDatabase): {
  total: number; survived: number; orphanIds: string[];
} {
  const rows = db.prepare(`
    SELECT
      m.id AS id,
      EXISTS (
        SELECT 1 FROM memory_item e
        WHERE e.type = 'episodic'
          AND (e.content = m.content OR substr(e.content, 1, 80) = substr(m.content, 1, 80))
      ) AS survived
    FROM memory_item m
    WHERE m.type = 'semantic'
      AND m.subject IS NOT NULL AND m.subject <> ''
      AND m.id NOT IN (
        SELECT id FROM memory_item
        WHERE ${FORM_UNIVERSE} AND ((${FORM_ONE_EXPR}) OR (${FORM_THREE_EXPR}))
      )
    ORDER BY m.id
  `).all() as Array<{ id: string; survived: number }>;

  return {
    total: rows.length,
    survived: rows.filter((row) => row.survived === 1).length,
    orphanIds: rows.filter((row) => row.survived !== 1).map((row) => row.id),
  };
}

/**
 * FR-006d: memory_forgetting_event 는 FK 가 없어 cascadeImpact 의
 * pragma_foreign_key_list 로는 구조적으로 잡히지 않는다. 별도로 센다.
 */
export function orphanForgettingEvents(db: CliDatabase): number {
  const exists = db.prepare(`
    SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'memory_forgetting_event'
  `).get() as { n: number };
  if (exists.n === 0) {
    return 0;
  }
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM memory_forgetting_event
    WHERE memory_id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
  `).get() as { n: number };
  return row.n;
}

/** 에픽 #803 의 백필이 돌던 구간. 시기 조건은 판별식에 넣지 않고 보고로만 쓴다 (FR-002c). */
const BURST_MONTHS = ['2026-04', '2026-05'];

export interface BurstSplit {
  interval: string;
  total: number;
  one: number;
  two: number;
  three: number;
}

/** FR-002b·SC-003b: 구간 안/밖으로 나눈 건수와 구간별 형태 분포. 새로운 편중을 감시한다. */
export function burstIntervalSplit(db: CliDatabase): BurstSplit[] {
  const rows = db.prepare(`
    SELECT
      CASE WHEN substr(created_at, 1, 7) IN (${BURST_MONTHS.map(() => '?').join(',')})
           THEN 'in' ELSE 'out' END AS bucket,
      COUNT(*) AS total,
      SUM(CASE WHEN ${FORM_ONE_EXPR} THEN 1 ELSE 0 END) AS one,
      SUM(CASE WHEN ${FORM_THREE_EXPR} THEN 1 ELSE 0 END) AS three
    FROM memory_item
    WHERE ${FORM_UNIVERSE}
    GROUP BY bucket
  `).all(...BURST_MONTHS) as Array<{ bucket: string; total: number; one: number | null; three: number | null }>;

  return (['in', 'out'] as const).map((bucket) => {
    const row = rows.find((candidate) => candidate.bucket === bucket);
    const total = row?.total ?? 0;
    const one = row?.one ?? 0;
    const three = row?.three ?? 0;
    return {
      interval: bucket === 'in' ? '구간 안 (2026-04·05)' : '구간 밖',
      total,
      one,
      three,
      two: total - one - three,
    };
  });
}
