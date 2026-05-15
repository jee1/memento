/**
 * Admin evolution demo routes (Issue #341, #396)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('no port'));
      }
    });
  });
}

function getAdmin(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Connection: 'close' },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('admin evolution-demo routes', () => {
  let db: Database.Database;
  let server: http.Server | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = undefined;
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it('GET /admin/evolution-demo/scenarios returns catalog', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const listened = await listen(app);
    server = listened.server;

    const res = await getAdmin(listened.port, '/admin/evolution-demo/scenarios');
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      scenarios: Array<{ scenario_id: string; title: string; points: Array<{ point_id: string }> }>;
    };
    expect(body.scenarios).toHaveLength(2);

    const answerOverTime = body.scenarios.find(s => s.scenario_id === 'answer-over-time');
    expect(answerOverTime?.points.map(p => p.point_id)).toEqual(['early', 'mid', 'late']);

    const consolidation = body.scenarios.find(s => s.scenario_id === 'episodic-to-semantic');
    expect(consolidation?.points.map(p => p.point_id)).toEqual(['before', 'after']);
  });

  it('GET /admin/evolution-demo/snapshots/:scenario_id/:point_id returns snapshot body', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const listened = await listen(app);
    server = listened.server;

    const res = await getAdmin(
      listened.port,
      '/admin/evolution-demo/snapshots/answer-over-time/mid'
    );
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      scenario_id: string;
      point_id: string;
      point_label: string;
      question: string;
      answer: string;
      memory_summary: {
        episodic_count: number;
        semantic_count: number;
        forgotten_count: number;
        preserved_count: number;
        summary_text: string;
      };
      explanation: string;
      timestamp: string;
    };

    expect(body.scenario_id).toBe('answer-over-time');
    expect(body.point_id).toBe('mid');
    expect(body.point_label).toBe('Mid (day 30)');
    expect(body.question).toContain('authentication');
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.memory_summary.episodic_count).toBeGreaterThanOrEqual(0);
    expect(body.explanation.length).toBeGreaterThan(0);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('GET episodic-to-semantic after snapshot returns consolidation read-model fields', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const listened = await listen(app);
    server = listened.server;

    const res = await getAdmin(
      listened.port,
      '/admin/evolution-demo/snapshots/episodic-to-semantic/after'
    );
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      scenario_id: string;
      point_id: string;
      episodic_sources?: Array<{ id: string; summary: string }>;
      semantic_result?: {
        id: string;
        summary: string;
        source_count: number;
        explanation: string;
      };
      search_comparison?: { before_summary: string; after_summary: string };
    };

    expect(body.scenario_id).toBe('episodic-to-semantic');
    expect(body.point_id).toBe('after');
    expect(body.episodic_sources).toBeDefined();
    expect(body.episodic_sources!.length).toBeGreaterThanOrEqual(3);
    expect(body.semantic_result).toMatchObject({
      id: expect.any(String),
      summary: expect.any(String),
      source_count: 4,
      explanation: expect.any(String),
    });
    expect(body.search_comparison?.before_summary).toBeTruthy();
    expect(body.search_comparison?.after_summary).toContain('semantic');
  });

  it('GET snapshot returns 404 for unknown scenario or point', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const listened = await listen(app);
    server = listened.server;

    const missingScenario = await getAdmin(
      listened.port,
      '/admin/evolution-demo/snapshots/unknown/early'
    );
    expect(missingScenario.statusCode).toBe(404);

    const missingPoint = await getAdmin(
      listened.port,
      '/admin/evolution-demo/snapshots/answer-over-time/unknown'
    );
    expect(missingPoint.statusCode).toBe(404);
  });
});
