import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentMemoryPromotionSchemaMigration } from './036-agent-memory-promotion-schema.js';

describe('AgentMemoryPromotionSchemaMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY);
      CREATE TABLE agent_session (id TEXT PRIMARY KEY);
      CREATE TABLE agent_observation (id TEXT PRIMARY KEY);
    `);
  });

  afterEach(() => db.close());

  it('creates the promotion review queue and idempotency indexes', async () => {
    await new AgentMemoryPromotionSchemaMigration().up(db);

    const objects = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN (
        'agent_memory_promotion_candidate',
        'idx_agent_memory_promotion_queue',
        'idx_agent_memory_promotion_session'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(objects.map(row => row.name)).toEqual([
      'agent_memory_promotion_candidate',
      'idx_agent_memory_promotion_queue',
      'idx_agent_memory_promotion_session',
    ]);
  });
});
