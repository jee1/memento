import type Database from 'better-sqlite3';

/** FR-006 sample cap — default and hard upper bound. */
export const DEFAULT_SAMPLE_LIMIT = 20;

/**
 * Hangul syllable block (가–힣): U+AC00–U+D7A3 → decimal 44032–55203.
 * Matches `kgPredicateNormalization` in quarantine-targets.ts.
 */
const HANGUL_SYLLABLE_SQL =
  `unicode(substr(predicate, length(predicate), 1)) BETWEEN 44032 AND 55203`;

export interface KgTriplePredicateQualityReport {
  total: number;
  hangul_termination_rate: number;
  whitespace_rate: number;
  average_length: number;
  non_hangul_termination_count: number;
  samples: {
    non_hangul_termination: string[];
    with_whitespace: string[];
  };
}

function clampSampleLimit(sampleLimit: number | undefined): number {
  const requested = sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  if (!Number.isFinite(requested) || requested < 0) {
    return DEFAULT_SAMPLE_LIMIT;
  }
  return Math.min(Math.floor(requested), DEFAULT_SAMPLE_LIMIT);
}

/**
 * Read-only aggregate of `kg_triple.predicate` quality (FR-005 / FR-006).
 * Does not mutate the database.
 */
export function buildKgTriplePredicateQualityReport(
  db: Database.Database,
  options: { sampleLimit?: number } = {},
): KgTriplePredicateQualityReport {
  const sampleLimit = clampSampleLimit(options.sampleLimit);

  const aggregates = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN ${HANGUL_SYLLABLE_SQL} THEN 1 ELSE 0 END) AS hangul_ending,
         SUM(CASE WHEN predicate LIKE '% %' THEN 1 ELSE 0 END) AS with_space,
         AVG(length(predicate)) AS avg_length
       FROM kg_triple
       WHERE predicate IS NOT NULL AND predicate <> ''`,
    )
    .get() as {
    total: number;
    hangul_ending: number | null;
    with_space: number | null;
    avg_length: number | null;
  };

  const total = Number(aggregates.total) || 0;
  const hangulEnding = Number(aggregates.hangul_ending) || 0;
  const withSpace = Number(aggregates.with_space) || 0;
  const averageLength = total === 0 ? 0 : Number(aggregates.avg_length) || 0;
  const nonHangul = total - hangulEnding;

  const nonHangulSamples = (
    db
      .prepare(
        `SELECT predicate
           FROM kg_triple
          WHERE predicate IS NOT NULL AND predicate <> ''
            AND NOT (${HANGUL_SYLLABLE_SQL})
          ORDER BY predicate
          LIMIT ?`,
      )
      .all(sampleLimit) as Array<{ predicate: string }>
  ).map(row => row.predicate);

  const whitespaceSamples = (
    db
      .prepare(
        `SELECT predicate
           FROM kg_triple
          WHERE predicate IS NOT NULL AND predicate <> ''
            AND predicate LIKE '% %'
          ORDER BY predicate
          LIMIT ?`,
      )
      .all(sampleLimit) as Array<{ predicate: string }>
  ).map(row => row.predicate);

  return {
    total,
    hangul_termination_rate: total === 0 ? 0 : hangulEnding / total,
    whitespace_rate: total === 0 ? 0 : withSpace / total,
    average_length: averageLength,
    non_hangul_termination_count: nonHangul,
    samples: {
      non_hangul_termination: nonHangulSamples,
      with_whitespace: whitespaceSamples,
    },
  };
}
