import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ExportMemoriesTool } from '../export-memories-tool.js';
import type { ToolContext } from '../../../tools/types.js';

function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      tags TEXT,
      source TEXT,
      task_goal TEXT,
      steps TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      owner_id TEXT,
      project_id TEXT,
      is_deleted BOOLEAN DEFAULT 0 NOT NULL
    );
  `);
}

describe('ExportMemoriesTool', () => {
  let db: Database.Database;
  let tool: ExportMemoriesTool;
  let context: ToolContext;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
    tool = new ExportMemoriesTool();
    context = { db, services: {} };
  });

  afterEach(() => {
    db.close();
  });

  it('markdown 형식으로 YAML frontmatter와 Steps 섹션을 포함한다', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, tags, source, steps)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'mem_export_1',
      'procedural',
      '배포 절차',
      JSON.stringify(['deploy', 'ops']),
      'https://docs.example.com/deploy',
      JSON.stringify([{ title: '빌드', detail: 'npm run build' }]),
    );

    const result = await tool.handle({ format: 'markdown', types: ['procedural'] }, context);
    const data = JSON.parse(result.content[0].text);

    expect(data.format).toBe('markdown');
    expect(data.count).toBe(1);
    expect(data.content).toContain('---');
    expect(data.content).toContain('type: procedural');
    expect(data.content).toContain('uri: memento://default/procedure/mem_export_1');
    expect(data.content).toContain('source: "https://docs.example.com/deploy"');
    expect(data.content).toContain('## Steps');
    expect(data.content).toContain('빌드');
  });

  it('jsonl 형식으로 한 줄당 JSON 객체를 반환한다', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, source)
      VALUES (?, ?, ?, ?)
    `).run('mem_export_2', 'semantic', '사실', 'doc:facts-v1');

    const result = await tool.handle({ format: 'jsonl' }, context);
    const data = JSON.parse(result.content[0].text);
    const line = JSON.parse(data.content.split('\n')[0]);

    expect(data.format).toBe('jsonl');
    expect(line.id).toBe('mem_export_2');
    expect(line.uri).toBe('memento://default/memory/mem_export_2');
    expect(line.source).toBe('doc:facts-v1');
  });
});
