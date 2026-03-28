import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { FeedbackRepository, sigmoidNormalizedNet } from '../feedback-repository.js';

describe('FeedbackRepository', () => {
  let db: Database.Database;
  let repo: FeedbackRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    await DatabaseUtils.initializeDatabase(db);
    db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES ('mem_fb_test_1', 'semantic', 'test')`
    ).run();
    repo = new FeedbackRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('insertFeedback는 id·created_at를 반환한다', () => {
    const row = repo.insertFeedback({
      memory_id: 'mem_fb_test_1',
      event: 'helpful',
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.created_at).toBeDefined();
  });

  it('comment·score를 저장한다', () => {
    repo.insertFeedback({
      memory_id: 'mem_fb_test_1',
      event: 'helpful',
      score: 0.9,
      comment: 'ok',
    });
    const r = db
      .prepare('SELECT score, comment FROM feedback_event WHERE memory_id = ? ORDER BY id DESC LIMIT 1')
      .get('mem_fb_test_1') as { score: number; comment: string | null };
    expect(r.score).toBeCloseTo(0.9, 5);
    expect(r.comment).toBe('ok');
  });

  it('getNetScores는 helpful/not_helpful 순합을 반환한다', () => {
    repo.insertFeedback({ memory_id: 'mem_fb_test_1', event: 'helpful' });
    repo.insertFeedback({ memory_id: 'mem_fb_test_1', event: 'helpful' });
    repo.insertFeedback({ memory_id: 'mem_fb_test_1', event: 'not_helpful' });
    const m = repo.getNetScores(['mem_fb_test_1'], 90);
    expect(m.get('mem_fb_test_1')).toBe(1);
  });

  it('getNetScores는 ID가 SQLITE_MAX_VARIABLE_NUMBER를 넘어도 청크로 조회해 실패하지 않는다', () => {
    const ins = db.prepare(
      `INSERT INTO memory_item (id, type, content) VALUES (?, 'semantic', 'chunk-test')`
    );
    ins.run('mem_chunk_0');
    ins.run('mem_chunk_1500');
    repo.insertFeedback({ memory_id: 'mem_chunk_0', event: 'helpful' });
    repo.insertFeedback({ memory_id: 'mem_chunk_1500', event: 'helpful' });
    const ids = Array.from({ length: 2500 }, (_, i) => `mem_chunk_${i}`);
    const m = repo.getNetScores(ids, 90);
    expect(m.get('mem_chunk_0')).toBe(1);
    expect(m.get('mem_chunk_1500')).toBe(1);
  });

  it('sigmoid: net=0 → 0.5, net=1 → 약 0.731, net=−1 → 약 0.269', () => {
    expect(sigmoidNormalizedNet(0)).toBeCloseTo(0.5, 5);
    expect(sigmoidNormalizedNet(1)).toBeCloseTo(1 / (1 + Math.exp(-1)), 5);
    expect(sigmoidNormalizedNet(-1)).toBeCloseTo(1 / (1 + Math.exp(1)), 5);
  });

  it('T036: feedback_event 스키마에 session_id·agent_id·comment·score_breakdown_json 컬럼이 있다', () => {
    const cols = db.prepare(`PRAGMA table_info(feedback_event)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('session_id')).toBe(true);
    expect(names.has('agent_id')).toBe(true);
    expect(names.has('comment')).toBe(true);
    expect(names.has('score_breakdown_json')).toBe(true);
  });

  it('feedback_event에 memory_id·created_at 복합 인덱스가 있다', () => {
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='feedback_event'`)
      .all() as Array<{ name: string }>;
    expect(rows.some((r) => r.name === 'idx_feedback_memory_created_at')).toBe(true);
  });
});
