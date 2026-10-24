/**
 * Episodic 작업 기록 (#1446).
 * 라벨은 출력에서만 붙인다. 저장 본문, 임베딩, FTS 는 필드 값만 본다.
 */

import type Database from 'better-sqlite3';
import { z } from 'zod';
import { stripMemoryTemplateLabels } from '../../consolidation/services/template-label-normalizer.js';

export const WorkRecordSchema = z.object({
  decision: z.string().min(1),
  rationale: z.string().min(1),
  rejected: z.string().min(1),
  failed: z.string(),
  next_blocker: z.string().min(1),
}).strict();

export type WorkRecord = z.infer<typeof WorkRecordSchema>;

const FIELD_ORDER = ['decision', 'rationale', 'rejected', 'failed', 'next_blocker'] as const;

const DISPLAY_LABEL: Record<(typeof FIELD_ORDER)[number], string> = {
  decision: '결정',
  rationale: '근거',
  rejected: '버린 대안',
  failed: '안 통한 것',
  next_blocker: '다음 걸림돌',
};

export function workRecordSearchText(record: WorkRecord): string {
  return FIELD_ORDER
    .map((field) => record[field].trim())
    .filter((value) => value.length > 0)
    .join('\n');
}

export function renderWorkRecord(record: WorkRecord): string {
  return FIELD_ORDER
    .map((field) => `${DISPLAY_LABEL[field]}: ${record[field].trim()}`)
    .join('\n');
}

function isWorkRecord(value: unknown): value is WorkRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<WorkRecord>;
  return FIELD_ORDER.every((field) => typeof record[field] === 'string');
}

/** 저장 content. record 가 있으면 라벨 없는 본문이고, 추가 content 는 라벨을 지운 뒤 붙인다. */
export function resolveStoredContent(content: string | undefined, record: WorkRecord | undefined): string {
  if (!record) return content ?? '';
  const search = workRecordSearchText(record);
  const extra = content?.trim();
  if (!extra) return search;
  const stripped = stripMemoryTemplateLabels(extra).replace(/[ \t]+\n/g, '\n').trim();
  if (!stripped || stripped === search) return search;
  return `${search}\n\n${stripped}`;
}

/** recall 과 memory_injection 이 사람에게 보여주는 본문. */
export function displayWorkRecordContent(storedContent: string, workRecordJson: string | null | undefined): string {
  if (!workRecordJson) return storedContent;
  let parsed: unknown;
  try {
    parsed = JSON.parse(workRecordJson);
  } catch {
    return storedContent;
  }
  if (!isWorkRecord(parsed)) return storedContent;
  const search = workRecordSearchText(parsed);
  const rendered = renderWorkRecord(parsed);
  if (storedContent === search) return rendered;
  if (storedContent.startsWith(`${search}\n\n`)) {
    return rendered + storedContent.slice(search.length);
  }
  return rendered;
}

export function overlayWorkRecordDisplay<
  T extends { id?: string; memory_id?: string; content: string; work_record?: string | null }
>(
  db: Database.Database,
  items: T[],
): T[] {
  if (items.length === 0) return items;
  const missingIds = items
    .filter((item) => item.work_record === undefined)
    .map((item) => item.id ?? item.memory_id)
    .filter((id): id is string => Boolean(id));
  if (missingIds.length === 0) {
    return items.map((item) => {
      if (!item.work_record) return item;
      return { ...item, content: displayWorkRecordContent(item.content, item.work_record) };
    });
  }
  try {
    const placeholders = missingIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, work_record AS workRecord FROM memory_item WHERE id IN (${placeholders}) AND work_record IS NOT NULL`,
    ).all(...missingIds) as Array<{ id: string; workRecord: string }>;
    const byId = new Map(rows.map((row) => [row.id, row.workRecord]));
    return items.map((item) => {
      const id = item.id ?? item.memory_id;
      const json = item.work_record !== undefined ? item.work_record : (id ? byId.get(id) : undefined);
      if (!json) return item;
      return { ...item, content: displayWorkRecordContent(item.content, json) };
    });
  } catch {
    return items;
  }
}
