import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRankingWeights, resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { RankingWeightProposalMigration } from '@memento/core/infrastructure/database/sqlite/migration/migrations/064-ranking-weight-proposal.js';
import { createSessionStore } from '../../auth/session-store.js';
import {
  createSessionAuthMiddleware,
  DASHBOARD_SESSION_COOKIE_NAME,
} from '../../middleware/session-auth.middleware.js';
import { registerAdminRankingRoutes, type AdminRankingRouteOptions } from './admin-ranking.routes.js';
import type { PreviewOutcome } from './ranking-preview-runner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const REPO_TOML = join(ROOT, 'config/ranking-weights.toml');
const MINI = join(ROOT, 'tests/fixtures/search-quality/ranking-preview-mini');

interface Created {
  id: string;
  current: Record<string, number>;
  proposed: Record<string, number>;
  patch: string;
  commands: { preview: string; branch_and_pr: string };
}

describe('admin ranking routes (#1584)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let sessionId: string;
  let work: string;
  let tomlPath: string;
  const savedPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;
  const savedProvider = process.env.EMBEDDING_PROVIDER;

  async function start(options: AdminRankingRouteOptions): Promise<void> {
    db = new Database(':memory:');
    await new RankingWeightProposalMigration().up(db);
    const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
    sessionId = store.create().sessionId;
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminRankingRoutes(router, db, options);
    app.use('/admin', createSessionAuthMiddleware({ store, cookieName: DASHBOARD_SESSION_COOKIE_NAME }), router);
    app.use('/no-session', router);
    server = await new Promise<Server>((resolveListen) => {
      const listener = app.listen(0, '127.0.0.1', () => resolveListen(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'admin-ranking-'));
    tomlPath = join(work, 'ranking-weights.toml');
    copyFileSync(REPO_TOML, tomlPath);
    process.env.MEMENTO_RANKING_WEIGHTS_PATH = tomlPath;
    resetRankingWeightsCache();
  });

  afterEach(async () => {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    db.close();
    rmSync(work, { recursive: true, force: true });
    if (savedPath === undefined) delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    else process.env.MEMENTO_RANKING_WEIGHTS_PATH = savedPath;
    if (savedProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = savedProvider;
    resetRankingWeightsCache();
  });

  const call = (method: string, path: string, body?: unknown, prefix = '/admin') =>
    fetch(`${baseUrl}${prefix}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
        Cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function propose(changes: object, reason = '실측 근거'): Promise<Created> {
    const response = await call('POST', '/ranking/proposals', { changes, reason });
    expect(response.status).toBe(201);
    return (await response.json()) as Created;
  }

  describe('제안과 조회', () => {
    beforeEach(async () => {
      await start({ env: {}, projectRoot: null });
    });

    it('knob 별 로드 값과 파일 값과 범위와 drift 를 돌려준다', async () => {
      const body = (await (await call('GET', '/ranking/weights')).json()) as {
        knobs: Array<{ key: string; value: number; file_value: number; min: number; max: number; drift: boolean }>;
        source_path: string | null;
        preview_enabled: boolean;
      };
      expect(body.knobs).toHaveLength(13);
      expect(body.knobs.find((k) => k.key === 'relevance_signal.scale')).toEqual({
        key: 'relevance_signal.scale',
        value: 2,
        file_value: 2,
        min: 0.5,
        max: 3,
        drift: false,
      });
      expect(body.source_path).toBe(tomlPath);
      expect(body.preview_enabled).toBe(false);
    });

    it('제안을 만들면 patch 와 명령을 주고 목록에 최신순으로 나온다', async () => {
      const first = await propose({ 'relevance_signal.scale': 2.2 });
      const second = await propose({ 'recency_signal.scale': 0.25 }, '두 번째');
      expect(first.patch).toContain('+scale = 2.2');
      expect(first.current).toEqual({ 'relevance_signal.scale': 2 });
      expect(first.commands.preview).toContain('npm run ranking:preview -- --changes');
      expect(first.commands.branch_and_pr).toContain(`git apply ranking-${first.id}.patch`);

      const list = (await (await call('GET', '/ranking/proposals?limit=1')).json()) as {
        proposals: Array<{ id: string; actor: string; patch?: string }>;
      };
      expect(list.proposals.map((p) => p.id)).toEqual([second.id]);
      expect(list.proposals[0]!.actor).toMatch(/^session:/);
      expect(list.proposals[0]!.patch).toBeUndefined();
    });

    it('patch 를 text/x-diff 첨부로 내려준다', async () => {
      const created = await propose({ 'relevance_signal.scale': 2.2 });
      const response = await call('GET', `/ranking/proposals/${created.id}/patch`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/x-diff');
      expect(response.headers.get('content-disposition')).toBe(`attachment; filename="ranking-${created.id}.patch"`);
      expect(await response.text()).toBe(created.patch);
      expect((await call('GET', '/ranking/proposals/nope/patch')).status).toBe(404);
    });

    it('거절 코드를 구분한다', async () => {
      const post = async (body: unknown) => {
        const response = await call('POST', '/ranking/proposals', body);
        return { status: response.status, code: ((await response.json()) as { code: string }).code };
      };
      expect(await post({ changes: { 'relevance_signal.scale': 2.2 } })).toEqual({ status: 400, code: 'REASON_REQUIRED' });
      expect(await post({ changes: { 'relevance_signal.scale': 2.2 }, reason: '  ' })).toEqual({ status: 400, code: 'REASON_REQUIRED' });
      expect(await post({ changes: { 'nope.x': 1 }, reason: 'r' })).toEqual({ status: 404, code: 'UNKNOWN_KNOB' });
      expect(await post({ changes: { 'relevance_signal.scale': 9 }, reason: 'r' })).toEqual({ status: 400, code: 'INVALID_VALUE' });
      expect(await post({ changes: { 'relevance_signal.scale': 2 }, reason: 'r' })).toEqual({ status: 400, code: 'NO_CHANGE' });
      expect(await post({ reason: 'r' })).toEqual({ status: 400, code: 'INVALID_VALUE' });
    });

    it('세션이 없으면 모든 경로가 401', async () => {
      const responses = await Promise.all([
        call('GET', '/ranking/weights', undefined, '/no-session'),
        call('POST', '/ranking/proposals', { changes: {}, reason: 'r' }, '/no-session'),
        call('GET', '/ranking/proposals', undefined, '/no-session'),
        call('GET', '/ranking/proposals/x/patch', undefined, '/no-session'),
        call('POST', '/ranking/proposals/x/preview', undefined, '/no-session'),
      ]);
      expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    });
  });

  describe('미리보기 실행 정책', () => {
    const okOutcome: PreviewOutcome = {
      status: 'ok',
      result: { dev_query_count: 1, current: { ndcg_at_10: 1, mrr: 1 }, proposed: { ndcg_at_10: 1, mrr: 1 }, tie_gate: { passed: true } },
    };

    it('RANKING_PREVIEW_ENABLED 가 true 가 아니면 409 와 CLI 명령을 준다', async () => {
      const runPreview = vi.fn();
      await start({ env: { RANKING_PREVIEW_ENABLED: 'false' }, projectRoot: ROOT, runPreview });
      const created = await propose({ 'relevance_signal.scale': 2.2 });
      const response = await call('POST', `/ranking/proposals/${created.id}/preview`);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'PREVIEW_DISABLED', command: created.commands.preview });
      expect(runPreview).not.toHaveBeenCalled();
    });

    it('런너나 fixture 가 없으면 409 PREVIEW_UNAVAILABLE', async () => {
      await start({ env: { RANKING_PREVIEW_ENABLED: 'true' }, projectRoot: null, runPreview: vi.fn() });
      const created = await propose({ 'relevance_signal.scale': 2.2 });
      const response = await call('POST', `/ranking/proposals/${created.id}/preview`);
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe('PREVIEW_UNAVAILABLE');
    });

    it('동시에 하나만 돌리고 두 번째는 409 PREVIEW_BUSY', async () => {
      let release!: (outcome: PreviewOutcome) => void;
      const runPreview = vi.fn(() => new Promise<PreviewOutcome>((resolveRun) => { release = resolveRun; }));
      await start({ env: { RANKING_PREVIEW_ENABLED: 'true' }, projectRoot: ROOT, runPreview });
      const a = await propose({ 'relevance_signal.scale': 2.2 });
      const b = await propose({ 'recency_signal.scale': 0.25 });
      const first = call('POST', `/ranking/proposals/${a.id}/preview`);
      await vi.waitFor(() => expect(runPreview).toHaveBeenCalledTimes(1));
      const busy = await call('POST', `/ranking/proposals/${b.id}/preview`);
      expect(busy.status).toBe(409);
      expect(((await busy.json()) as { code: string }).code).toBe('PREVIEW_BUSY');
      release(okOutcome);
      expect((await first).status).toBe(200);
      runPreview.mockResolvedValueOnce(okOutcome);
      expect((await call('POST', `/ranking/proposals/${b.id}/preview`)).status).toBe(200);
    });

    it('시간 상한을 넘으면 504, 실패하면 502 이고 아무것도 저장하지 않는다', async () => {
      const runPreview = vi.fn<() => Promise<PreviewOutcome>>();
      await start({ env: { RANKING_PREVIEW_ENABLED: 'true' }, projectRoot: ROOT, runPreview });
      const created = await propose({ 'relevance_signal.scale': 2.2 });
      runPreview.mockResolvedValueOnce({ status: 'timeout' });
      const timeout = await call('POST', `/ranking/proposals/${created.id}/preview`);
      expect(timeout.status).toBe(504);
      expect(((await timeout.json()) as { code: string }).code).toBe('PREVIEW_TIMEOUT');
      runPreview.mockResolvedValueOnce({ status: 'failed', message: 'boom' });
      const failed = await call('POST', `/ranking/proposals/${created.id}/preview`);
      expect(failed.status).toBe(502);
      expect(JSON.stringify(await failed.json())).not.toContain('boom');
      expect(db.prepare('SELECT preview_json FROM ranking_weight_proposal').get()).toEqual({ preview_json: null });
    });

    it('성공하면 결과를 한 번 저장하고 다시 누르면 저장본을 돌려준다', async () => {
      const runPreview = vi.fn().mockResolvedValue(okOutcome);
      await start({ env: { RANKING_PREVIEW_ENABLED: 'true', RANKING_PREVIEW_TIMEOUT_MS: '9000' }, projectRoot: ROOT, runPreview });
      const created = await propose({ 'relevance_signal.scale': 2.2 });
      const first = (await (await call('POST', `/ranking/proposals/${created.id}/preview`)).json()) as { preview: unknown; commands: { branch_and_pr: string } };
      expect(first.preview).toEqual(okOutcome.result);
      expect(first.commands.branch_and_pr).toContain('미리보기(dev 1쿼리)');
      expect(runPreview.mock.calls[0]![1]).toMatchObject({ timeoutMs: 9000, maxOldSpaceMb: 1024 });
      await call('POST', `/ranking/proposals/${created.id}/preview`);
      expect(runPreview).toHaveBeenCalledTimes(1);
      expect((await call('POST', '/ranking/proposals/nope/preview')).status).toBe(404);
    });
  });

  describe('운영 불변 (완료 기준)', () => {
    it('제안과 실제 자식 프로세스 미리보기를 거쳐도 운영 가중치, 파일, env 가 그대로다', async () => {
      process.env.EMBEDDING_PROVIDER = 'tfidf';
      await start({
        env: { RANKING_PREVIEW_ENABLED: 'true' },
        previewExtraArgs: ['--benchmark-dir', MINI, '--cache-dir', join(work, 'cache')],
      });
      const weightsBefore = structuredClone(getRankingWeights());
      const fileBefore = readFileSync(tomlPath);
      const repoFileBefore = readFileSync(REPO_TOML);
      const envBefore = process.env.MEMENTO_RANKING_WEIGHTS_PATH;

      const created = await propose({ 'relevance_signal.scale': 2.2, 'recency_signal.scale': 0.25 });
      const response = await call('POST', `/ranking/proposals/${created.id}/preview`);
      const body = (await response.json()) as { preview: { dev_query_count: number; changes: object; delta: object } };

      expect(response.status).toBe(200);
      expect(body.preview.dev_query_count).toBe(6);
      expect(body.preview.changes).toEqual({ 'relevance_signal.scale': 2.2, 'recency_signal.scale': 0.25 });
      expect(Object.keys(body.preview.delta)).toContain('ndcg_at_10');
      expect(db.prepare('SELECT preview_json FROM ranking_weight_proposal').get()).not.toEqual({ preview_json: null });

      expect(getRankingWeights()).toEqual(weightsBefore);
      expect(readFileSync(tomlPath).equals(fileBefore)).toBe(true);
      expect(readFileSync(REPO_TOML).equals(repoFileBefore)).toBe(true);
      expect(process.env.MEMENTO_RANKING_WEIGHTS_PATH).toBe(envBefore);
    }, 90_000);
  });
});
