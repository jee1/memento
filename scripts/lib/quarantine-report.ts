/**
 * #804 격리 러너의 산출물 — dry-run 리포트와 관계 내보내기.
 *
 * 표본에 기억 본문이 들어가므로 경로 규칙을 여기서 강제한다 (FR-006b).
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { CliDatabase } from './cli.js';
import { QuarantineGateError } from './quarantine-gates.js';
import {
  attributionCounts, cascadeImpact, classifyForms, countTargets, crossVerifyTargets,
  fallbackTrendByMonth, importanceBuckets, kgPredicateNormalization, kgPreservation,
  listPreservedFormIds, pinnedCandidates, sampleTargets, TARGET_WHERE,
} from './quarantine-targets.js';

/**
 * FR-006b: .gitignore 가 .md·.json 을 막지 않으므로 경로 자체로 막는다.
 * 저장소 밖(예: /tmp)은 커밋 대상이 아니므로 그대로 허용한다.
 */
export function resolveOutDir(out: string, repoRoot: string): string {
  const abs = resolve(repoRoot, out);
  const insideRepo = abs === repoRoot || abs.startsWith(repoRoot + sep);
  const insideLocal = abs.startsWith(join(repoRoot, '.local') + sep);
  if (insideRepo && !insideLocal) {
    throw new QuarantineGateError(23, `산출물은 저장소 안이면 .local/ 아래여야 합니다: ${abs}`);
  }
  return abs;
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function table(header: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${header.join(' | ')} |`;
  const separator = `|${header.map(() => '---').join('|')}|`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, separator, body].join('\n');
}

/** FR-003: 파괴적 실행 이전에 "무엇을 지우게 되는가"에 답하는 산출물. DB 를 변경하지 않는다. */
export function buildDryRunReport(db: CliDatabase, options: { sampleSize: number }): string {
  const forms = classifyForms(db);
  const cross = crossVerifyTargets(db);
  const kg = kgPreservation(db);
  const predicate = kgPredicateNormalization(db);
  const attribution = attributionCounts(db);
  const pinned = pinnedCandidates(db);
  const preserved = listPreservedFormIds(db);

  return [
    '# dry-run 리포트 — 자동 triple semantic 격리 (#804)',
    '',
    `생성: ${new Date().toISOString()} · 이 파일은 기억 본문을 담는다. 커밋 금지 (FR-006b).`,
    '',
    '## 대상 건수',
    '',
    `격리 대상 **${countTargets(db)}건**`,
    '',
    '> `recall_count` 주의(FR-001f): `remember` 로 만든 기억은 1에서, `createSemanticMemory` 는',
    '> 이 컬럼을 INSERT 에 넣지 않아 0에서 시작한다. 두 값을 직접 비교하면 착시가 생긴다.',
    '',
    '## 본문 형태 분포',
    '',
    table(['형태', '건수', '처리'], [
      ['(1) 템플릿', forms.one, '격리'],
      ['(2) 원문 폴백', forms.two, '보존'],
      ['(3) · 조인', forms.three, '보존'],
      ['모수(subject 보유 semantic)', forms.total, '—'],
    ]),
    '',
    `보존되는 형태 (2)(3) ID ${preserved.length}건: ${preserved.join(', ') || '없음'}`,
    '',
    '## 오탐 전수 검증',
    '',
    table(['방식', '건수'], [
      ['위치 비교 (FR-002i)', cross.positional],
      ['이스케이프 LIKE', cross.escapedLike],
      ['대상 중 subject 결여', cross.emptySubject],
    ]),
    '',
    cross.agree ? '**일치 — 오탐 0건**' : '**불일치 — 실행하지 말 것**',
    '',
    '## 표본 A',
    '',
    sampleTargets(db, options.sampleSize)
      .map((row, index) => `${index + 1}. \`${row.id}\` (importance ${row.importance ?? 'NULL'})\n   - ${row.content}`)
      .join('\n') || '표본 없음',
    '',
    '## 귀속 분포',
    '',
    table(['항목', '건수'], [
      ['project_id 지정', attribution.withProject],
      ['owner_id 지정', attribution.withOwner],
      ['privacy_scope ≠ private', attribution.nonPrivate],
      ['소프트 삭제 표시', attribution.softDeleted],
      ['합계', attribution.total],
    ]),
    '',
    '## kg_triple 보존',
    '',
    `보존율 **${(kg.rate * 100).toFixed(2)}%** (${kg.total - kg.missing}/${kg.total}) · 미보존 ${kg.missing}건`,
    '',
    `predicate 정규화: 한글 종결 ${predicate.hangulEnding}/${predicate.total} · `
      + `공백 포함 ${predicate.withSpace} · 평균 ${predicate.avgLength.toFixed(1)}자`,
    '',
    '## 연쇄 영향',
    '',
    table(['테이블', '컬럼', 'ON DELETE', '행 수'],
      cascadeImpact(db).map((row) => [row.table, row.column, row.onDelete, row.rows])),
    '',
    '## 형태 (2) 월별 추이',
    '',
    table(['월', '생성', '폴백', '폴백률'],
      fallbackTrendByMonth(db).map((row) => [row.month, row.total, row.fallback, `${(row.rate * 100).toFixed(1)}%`])),
    '',
    '## 격리 제외 pinned',
    '',
    pinned.length === 0 ? '없음' : pinned.map((id) => `- \`${id}\``).join('\n'),
    '',
  ].join('\n');
}

/**
 * FR-006i: memory_relation 은 source·target 양쪽이 CASCADE 라 대상이 한쪽 끝인 관계가 전부 사라진다.
 * 반대쪽 끝은 예외 없이 생존 기억이고 kg_triple 이 이 정보를 보존하지 않으므로,
 * 이 내보내기가 유일한 복구 근거다 (FR-006l).
 */
export function exportRelations(db: CliDatabase, file: string): {
  rows: number; byType: Record<string, number>;
} {
  const rows = db.prepare(`
    SELECT r.source_id AS target_id, r.relation_type, r.target_id AS other_id, o.type AS other_type
    FROM memory_relation r
    JOIN memory_item o ON o.id = r.target_id
    WHERE r.source_id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
    UNION ALL
    SELECT r.target_id AS target_id, r.relation_type, r.source_id AS other_id, o.type AS other_type
    FROM memory_relation r
    JOIN memory_item o ON o.id = r.source_id
    WHERE r.target_id IN (SELECT id FROM memory_item WHERE ${TARGET_WHERE})
  `).all() as Array<{ target_id: string; relation_type: string; other_id: string; other_type: string }>;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8');

  const byType: Record<string, number> = {};
  for (const row of rows) {
    byType[row.relation_type] = (byType[row.relation_type] ?? 0) + 1;
  }
  return { rows: rows.length, byType };
}
