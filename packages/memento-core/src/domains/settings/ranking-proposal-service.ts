/* eslint-disable security/detect-non-literal-fs-filename -- 읽는 경로는 서버가 로드하는 ranking-weights.toml(env 설정 또는 패키지 기본 사본)이다. HTTP 입력이 닿지 않는다. */
/**
 * 랭킹 가중치 제안 (#1584)
 *
 * 화면에서 고른 값은 운영에 바로 반영하지 않는다. 제안은 config/ranking-weights.toml 에 대한
 * patch 로 저장하고, 운영 값은 그 patch 를 PR 로 머지하고 배포할 때만 바뀐다.
 * 이 모듈은 가중치 캐시와 process.env 를 바꾸지 않는다.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { TUNABLE_KNOBS, readKnob, validateKnobChanges, type KnobKey } from '../../shared/config/ranking-knobs.js';
import {
  getRankingWeights,
  getRankingWeightsSource,
  loadRankingWeights,
} from '../../shared/config/ranking-weights-loader.js';
import { applyRankingKnobChanges } from '../../shared/config/ranking-weights-patch.js';

const MAX_REASON_CHARS = 1000;
const MAX_LIST_LIMIT = 100;

type KnobValues = Partial<Record<KnobKey, number>>;

export interface RankingKnobView {
  key: KnobKey;
  /** 서버가 지금 로드해 쓰는 값 */
  value: number;
  /** 서버가 읽는 TOML 파일을 다시 파싱한 값 */
  file_value: number;
  min: number;
  max: number;
  drift: boolean;
}

export interface RankingWeightsView {
  knobs: RankingKnobView[];
  /** MEMENTO_RANKING_WEIGHTS_PATH 로 기본 사본을 바꿨을 때만 경로를 보인다. */
  source_path: string | null;
}

export interface RankingProposal {
  id: string;
  actor: string;
  reason: string;
  /** patch 의 기준이 된 파일 값 */
  current: KnobValues;
  proposed: KnobValues;
  patch: string;
  preview: unknown | null;
  previewed_at: string | null;
  created_at: string;
}

export type RankingProposalErrorCode = 'REASON_REQUIRED' | 'UNKNOWN_KNOB' | 'INVALID_VALUE' | 'NO_CHANGE';

export type CreateRankingProposalResult =
  | { ok: true; proposal: RankingProposal }
  | { ok: false; code: RankingProposalErrorCode; message: string };

interface ProposalRow {
  id: string;
  actor: string;
  reason: string;
  current_json: string;
  proposed_json: string;
  patch: string;
  preview_json: string | null;
  previewed_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, actor, reason, current_json, proposed_json, patch, preview_json, previewed_at, created_at';

function toProposal(row: ProposalRow): RankingProposal {
  return {
    id: row.id,
    actor: row.actor,
    reason: row.reason,
    current: JSON.parse(row.current_json) as KnobValues,
    proposed: JSON.parse(row.proposed_json) as KnobValues,
    patch: row.patch,
    preview: row.preview_json === null ? null : (JSON.parse(row.preview_json) as unknown),
    previewed_at: row.previewed_at,
    created_at: row.created_at,
  };
}

export function viewRankingWeights(): RankingWeightsView {
  const loaded = getRankingWeights();
  const source = getRankingWeightsSource();
  const file = loadRankingWeights(source.path);
  const knobs = (Object.keys(TUNABLE_KNOBS) as KnobKey[]).map((key) => {
    const value = readKnob(loaded, key);
    const fileValue = readKnob(file, key);
    const { min, max } = TUNABLE_KNOBS[key];
    return { key, value, file_value: fileValue, min, max, drift: value !== fileValue };
  });
  return { knobs, source_path: source.overridden ? source.path : null };
}

export function createRankingProposal(
  db: Database.Database,
  input: { changes: unknown; reason: unknown; actor: string },
): CreateRankingProposalResult {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', message: '사유가 필요합니다' };
  }
  if (reason.length > MAX_REASON_CHARS) {
    return { ok: false, code: 'INVALID_VALUE', message: `사유는 ${MAX_REASON_CHARS}자 이하여야 합니다` };
  }
  const changes = input.changes;
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return { ok: false, code: 'INVALID_VALUE', message: 'changes 는 knob → 값 객체여야 합니다' };
  }

  const { path } = getRankingWeightsSource();
  const file = loadRankingWeights(path);
  const error = validateKnobChanges(changes as Record<string, unknown>, file);
  if (error) {
    return { ok: false, code: error.code, message: error.message };
  }

  const current: KnobValues = {};
  const proposed: KnobValues = {};
  for (const [key, value] of Object.entries(changes as Record<KnobKey, number>) as Array<[KnobKey, number]>) {
    const fileValue = readKnob(file, key);
    if (value === fileValue) continue;
    current[key] = fileValue;
    proposed[key] = value;
  }
  if (Object.keys(proposed).length === 0) {
    return { ok: false, code: 'NO_CHANGE', message: '파일 값과 같은 값뿐이라 바꿀 것이 없습니다' };
  }

  const { diff } = applyRankingKnobChanges(readFileSync(path, 'utf8'), proposed);
  const row: ProposalRow = {
    id: randomUUID(),
    actor: input.actor,
    reason,
    current_json: JSON.stringify(current),
    proposed_json: JSON.stringify(proposed),
    patch: diff,
    preview_json: null,
    previewed_at: null,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO ranking_weight_proposal (id, actor, reason, current_json, proposed_json, patch, created_at)
     VALUES (@id, @actor, @reason, @current_json, @proposed_json, @patch, @created_at)`,
  ).run(row);
  return { ok: true, proposal: toProposal(row) };
}

export function listRankingProposals(db: Database.Database, limit = 20): RankingProposal[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 20, 1), MAX_LIST_LIMIT);
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM ranking_weight_proposal ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(capped) as ProposalRow[];
  return rows.map(toProposal);
}

export function getRankingProposal(db: Database.Database, id: string): RankingProposal | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM ranking_weight_proposal WHERE id = ?`).get(id) as
    | ProposalRow
    | undefined;
  return row ? toProposal(row) : null;
}

/** 미리보기는 제안당 한 번만 저장된다. 이미 있으면 false. */
export function saveRankingProposalPreview(db: Database.Database, id: string, preview: unknown): boolean {
  const result = db
    .prepare(
      `UPDATE ranking_weight_proposal SET preview_json = ?, previewed_at = ?
       WHERE id = ? AND preview_json IS NULL`,
    )
    .run(JSON.stringify(preview), new Date().toISOString(), id);
  return result.changes === 1;
}
