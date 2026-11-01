import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RankingWeightProposalMigration } from '../../../infrastructure/database/sqlite/migration/migrations/064-ranking-weight-proposal.js';
import { getRankingWeights, resetRankingWeightsCache } from '../../../shared/config/ranking-weights-loader.js';
import {
  createRankingProposal,
  getRankingProposal,
  listRankingProposals,
  saveRankingProposalPreview,
  viewRankingWeights,
} from '../ranking-proposal-service.js';

const REPO_TOML = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../config/ranking-weights.toml');
const ACTOR = 'session:abc';

describe('ranking proposal service', () => {
  let dir: string;
  let tomlPath: string;
  let db: Database.Database;
  const previousPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ranking-proposal-'));
    tomlPath = join(dir, 'ranking-weights.toml');
    copyFileSync(REPO_TOML, tomlPath);
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = tomlPath;
    resetRankingWeightsCache();
    db = new Database(':memory:');
    await new RankingWeightProposalMigration().up(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    if (previousPath === undefined) delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    else process.env.MEMENTO_RANKING_WEIGHTS_PATH = previousPath;
    resetRankingWeightsCache();
  });

  const create = (changes: unknown, reason: unknown = '실측 근거') => createRankingProposal(db, { changes, reason, actor: ACTOR });

  describe('viewRankingWeights', () => {
    it('knob 13개를 값, 파일 값, 범위와 함께 돌려주고 일치하면 drift 가 없다', () => {
      const view = viewRankingWeights();
      expect(view.knobs).toHaveLength(13);
      expect(view.knobs.find((k) => k.key === 'relevance_signal.scale')).toEqual({
        key: 'relevance_signal.scale',
        value: 2,
        file_value: 2,
        min: 0.5,
        max: 3,
        drift: false,
      });
      expect(view.knobs.some((k) => k.drift)).toBe(false);
      expect(view.source_path).toBe(tomlPath);
    });

    it('로드한 뒤 파일이 바뀌면 drift 로 드러낸다', () => {
      getRankingWeights();
      writeFileSync(tomlPath, readFileSync(tomlPath, 'utf8').replace('scale = 2.0', 'scale = 2.4'));
      const knob = viewRankingWeights().knobs.find((k) => k.key === 'relevance_signal.scale');
      expect(knob).toMatchObject({ value: 2, file_value: 2.4, drift: true });
    });

    it('기본 사본을 쓰면 source_path 를 숨긴다', () => {
      delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
      resetRankingWeightsCache();
      expect(viewRankingWeights().source_path).toBeNull();
    });
  });

  describe('createRankingProposal', () => {
    it('patch 와 감사 필드를 저장하고 운영 값과 파일은 그대로 둔다', () => {
      const weightsBefore = structuredClone(getRankingWeights());
      const fileBefore = readFileSync(tomlPath);

      const result = create({ 'relevance_signal.scale': 2.2, 'ranking_weights.alpha': 0.5 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.proposal).toMatchObject({
        actor: ACTOR,
        reason: '실측 근거',
        current: { 'relevance_signal.scale': 2, 'ranking_weights.alpha': 0.45 },
        proposed: { 'relevance_signal.scale': 2.2, 'ranking_weights.alpha': 0.5 },
        preview: null,
        previewed_at: null,
      });
      expect(result.proposal.patch).toContain('+scale = 2.2');
      expect(result.proposal.patch).toContain('+alpha = 0.50');

      expect(getRankingProposal(db, result.proposal.id)).toEqual(result.proposal);
      expect(getRankingWeights()).toEqual(weightsBefore);
      expect(readFileSync(tomlPath).equals(fileBefore)).toBe(true);
    });

    it('사유가 없거나 공백이면 REASON_REQUIRED', () => {
      for (const reason of [null, '', '   ', 7]) {
        expect(create({ 'relevance_signal.scale': 2.2 }, reason)).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
      }
      expect(listRankingProposals(db)).toEqual([]);
    });

    it('알 수 없는 knob 은 UNKNOWN_KNOB, 범위 밖과 숫자가 아닌 값은 INVALID_VALUE', () => {
      expect(create({ 'nope.x': 1 })).toMatchObject({ ok: false, code: 'UNKNOWN_KNOB' });
      expect(create({ 'relevance_signal.scale': 9 })).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(create({ 'relevance_signal.scale': '2.2' })).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(create({ 'ranking_weights.alpha': Number.NaN })).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(create({})).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(create(null)).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(create({ 'vector_length_decay.saturation_length': 30 })).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
      expect(listRankingProposals(db)).toEqual([]);
    });

    it('파일 값과 같은 값뿐이면 NO_CHANGE, 섞이면 다른 값만 남긴다', () => {
      expect(create({ 'relevance_signal.scale': 2 })).toMatchObject({ ok: false, code: 'NO_CHANGE' });
      const mixed = create({ 'relevance_signal.scale': 2, 'recency_signal.scale': 0.25 });
      expect(mixed.ok && mixed.proposal.proposed).toEqual({ 'recency_signal.scale': 0.25 });
    });
  });

  describe('목록과 미리보기 저장', () => {
    it('최신순으로 돌려주고 limit 를 지킨다', () => {
      const ids = [0.25, 0.26, 0.27].map((scale) => {
        const r = create({ 'recency_signal.scale': scale });
        return r.ok ? r.proposal.id : '';
      });
      expect(listRankingProposals(db).map((p) => p.id)).toEqual([...ids].reverse());
      expect(listRankingProposals(db, 2)).toHaveLength(2);
    });

    it('미리보기는 한 번만 저장된다', () => {
      const created = create({ 'recency_signal.scale': 0.25 });
      if (!created.ok) throw new Error('create failed');
      const { id } = created.proposal;
      expect(saveRankingProposalPreview(db, id, { a: 1 })).toBe(true);
      expect(saveRankingProposalPreview(db, id, { a: 2 })).toBe(false);
      expect(getRankingProposal(db, id)?.preview).toEqual({ a: 1 });
      expect(getRankingProposal(db, id)?.previewed_at).not.toBeNull();
    });

    it('없는 id 는 null', () => {
      expect(getRankingProposal(db, 'nope')).toBeNull();
    });
  });
});
