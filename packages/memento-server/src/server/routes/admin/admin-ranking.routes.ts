/**
 * Admin: 랭킹 가중치 제안, 미리보기, patch (#1584)
 *
 * 화면에서 고른 값은 운영에 반영하지 않는다. 제안은 config/ranking-weights.toml 의 patch 로만 남고,
 * 운영 값은 그 patch 를 PR 로 머지하고 배포할 때 바뀐다. 인증과 actor 는 설정 라우트와 같다.
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import {
  createRankingProposal,
  getRankingProposal,
  getRankingWeightsSource,
  listRankingProposals,
  logger,
  saveRankingProposalPreview,
  viewRankingWeights,
  type RankingProposal,
} from '@memento/core';
import { dashboardSessionIdentity } from '../../middleware/session-auth.middleware.js';
import { buildProposalCommands } from './ranking-proposal-commands.js';
import { findPreviewProjectRoot, runRankingPreviewChild } from './ranking-preview-runner.js';

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OLD_SPACE_MB = 1024;
const DEFAULT_LIST_LIMIT = 20;
const STATUS_BY_CODE = { REASON_REQUIRED: 400, UNKNOWN_KNOB: 404, INVALID_VALUE: 400, NO_CHANGE: 400 } as const;

export interface AdminRankingRouteOptions {
  env?: NodeJS.ProcessEnv;
  /** 런너 스크립트가 있는 저장소 루트. null 이면 미리보기 불가. 기본은 이 파일에서 위로 찾는다. */
  projectRoot?: string | null;
  runPreview?: typeof runRankingPreviewChild;
  previewExtraArgs?: readonly string[];
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function proposalView(proposal: RankingProposal) {
  const { patch: _patch, ...rest } = proposal;
  return { ...rest, commands: buildProposalCommands(proposal) };
}

export function registerAdminRankingRoutes(
  router: Router,
  db: Database.Database | null,
  options: AdminRankingRouteOptions = {},
): void {
  const env = (): NodeJS.ProcessEnv => options.env ?? process.env;
  const previewEnabled = (): boolean => env().RANKING_PREVIEW_ENABLED === 'true';
  const projectRoot = (): string | null =>
    options.projectRoot === undefined ? findPreviewProjectRoot() : options.projectRoot;
  const runPreview = options.runPreview ?? runRankingPreviewChild;
  let previewRunning = false;

  /** 세션과 DB 를 확인하고 통과하면 actor 와 db 를 넘긴다. */
  const guarded =
    (handler: (req: Request, res: Response, database: Database.Database, actor: string) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const actor = dashboardSessionIdentity(res);
      if (!actor) {
        return res.status(401).json({ error: 'Dashboard session required', code: 'SESSION_REQUIRED' });
      }
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      try {
        return await handler(req, res, db, actor);
      } catch (error) {
        logger.error('Ranking proposal request failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(500).json({ error: 'Ranking proposal request failed' });
      }
    };

  router.get(
    '/ranking/weights',
    guarded((_req, res) => res.json({ ...viewRankingWeights(), preview_enabled: previewEnabled() })),
  );

  router.post(
    '/ranking/proposals',
    guarded((req, res, database, actor) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = createRankingProposal(database, { changes: body.changes, reason: body.reason, actor });
      if (!result.ok) {
        return res.status(STATUS_BY_CODE[result.code]).json({ error: result.message, code: result.code });
      }
      const { proposal } = result;
      return res.status(201).json({
        id: proposal.id,
        current: proposal.current,
        proposed: proposal.proposed,
        patch: proposal.patch,
        commands: buildProposalCommands(proposal),
      });
    }),
  );

  router.get(
    '/ranking/proposals',
    guarded((req, res, database) => {
      const limit = positiveInt(typeof req.query.limit === 'string' ? req.query.limit : undefined, DEFAULT_LIST_LIMIT);
      return res.json({ proposals: listRankingProposals(database, limit).map(proposalView) });
    }),
  );

  router.get(
    '/ranking/proposals/:id/patch',
    guarded((req, res, database) => {
      const proposal = getRankingProposal(database, req.params.id ?? '');
      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      }
      res.setHeader('Content-Type', 'text/x-diff; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ranking-${proposal.id}.patch"`);
      return res.send(proposal.patch);
    }),
  );

  router.post(
    '/ranking/proposals/:id/preview',
    guarded(async (req, res, database) => {
      const proposal = getRankingProposal(database, req.params.id ?? '');
      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      }
      const commands = buildProposalCommands(proposal);
      if (proposal.preview !== null) {
        return res.json({ id: proposal.id, preview: proposal.preview, previewed_at: proposal.previewed_at, commands });
      }
      if (!previewEnabled()) {
        return res.status(409).json({
          error: '운영 컨테이너는 메모리 상한 때문에 미리보기를 서버에서 돌리지 않습니다. CLI 로 실행하세요',
          code: 'PREVIEW_DISABLED',
          command: commands.preview,
        });
      }
      const root = projectRoot();
      if (!root) {
        return res.status(409).json({
          error: '미리보기 런너나 benchmark fixture 가 이 배포에 없습니다',
          code: 'PREVIEW_UNAVAILABLE',
          command: commands.preview,
        });
      }
      if (previewRunning) {
        return res.status(409).json({ error: '다른 미리보기가 실행 중입니다', code: 'PREVIEW_BUSY' });
      }

      previewRunning = true;
      let outcome;
      try {
        outcome = await runPreview(
          { changes: proposal.proposed, profilePath: getRankingWeightsSource().path },
          {
            projectRoot: root,
            timeoutMs: positiveInt(env().RANKING_PREVIEW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
            maxOldSpaceMb: positiveInt(env().RANKING_PREVIEW_MAX_OLD_SPACE_MB, DEFAULT_MAX_OLD_SPACE_MB),
            extraArgs: options.previewExtraArgs,
          },
        );
      } finally {
        previewRunning = false;
      }

      if (outcome.status === 'timeout') {
        return res.status(504).json({ error: '미리보기가 시간 상한을 넘었습니다', code: 'PREVIEW_TIMEOUT', command: commands.preview });
      }
      if (outcome.status === 'failed') {
        logger.error('Ranking preview failed', { message: outcome.message });
        return res.status(502).json({ error: '미리보기 실행에 실패했습니다', code: 'PREVIEW_FAILED', command: commands.preview });
      }
      saveRankingProposalPreview(database, proposal.id, outcome.result);
      const saved = getRankingProposal(database, proposal.id);
      return res.json({
        id: proposal.id,
        preview: saved?.preview ?? outcome.result,
        previewed_at: saved?.previewed_at ?? null,
        commands: saved ? buildProposalCommands(saved) : commands,
      });
    }),
  );
}
