import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { listAnchorAgentIds } from './anchor-map.handler.js';

function createAnchorSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE anchor (
      agent_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('A', 'B', 'C')),
      memory_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, slot)
    );
  `);
}

describe('listAnchorAgentIds', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createAnchorSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no anchors have memory_id set', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id)
      VALUES ('default', 'A', NULL)
    `).run();

    expect(listAnchorAgentIds(db)).toEqual([]);
  });

  it('groups anchors by agent_id and counts only rows with memory_id', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id) VALUES
        ('agent-a', 'A', 'mem-1'),
        ('agent-a', 'B', 'mem-2'),
        ('agent-b', 'A', 'mem-3'),
        ('agent-b', 'C', NULL)
    `).run();

    expect(listAnchorAgentIds(db)).toEqual([
      { agent_id: 'agent-a', anchor_count: 2 },
      { agent_id: 'agent-b', anchor_count: 1 },
    ]);
  });

  it('orders results by agent_id ascending', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id) VALUES
        ('zebra', 'A', 'mem-z'),
        ('alpha', 'A', 'mem-a'),
        ('middle', 'A', 'mem-m')
    `).run();

    expect(listAnchorAgentIds(db).map(entry => entry.agent_id)).toEqual([
      'alpha',
      'middle',
      'zebra',
    ]);
  });
});
