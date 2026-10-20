import { describe, it, expect } from 'vitest';
import { RememberTool } from '../remember-tool.js';
import { ForgetTool } from '../../tools/forget-tool.js';
import { SearchEngine } from '../../../search/algorithms/search-engine.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { sqliteRepositoryProvider } from '../../../../infrastructure/database/factories/sqlite-repository-provider.js';
import type { ToolContext } from '../../../../tools/types.js';

describe('soft-deleted procedural re-save (#1398)', () => {
  it.each(['replace', 'incremental'] as const)(
    'soft forget 뒤 %s 로 같은 workflow 와 skill 을 다시 저장하면 recall 에 새 행이 나온다',
    async (updateMode) => {
      const db = await setupTestDatabase();
      try {
        const remember = new RememberTool();
        const forget = new ForgetTool();
        const context: ToolContext = { db, services: {} };
        const marker = `p1398${updateMode}${Date.now()}`;
        const workflowName = `wf-${updateMode}`;
        const skillName = `skill-${updateMode}`;
        const originalContent = `Original procedure ${updateMode}`;

        const first = await remember.handle({
          type: 'procedural',
          content: originalContent,
          workflow_name: workflowName,
          skill_name: skillName,
          steps: JSON.stringify(['step-a']),
        }, context);
        const originalId = JSON.parse(first.content[0].text).memory_id as string;

        await forget.handle({ id: originalId, hard: false }, context);

        const revivedContent = `Revived procedure ${marker}`;
        const second = await remember.handle({
          type: 'procedural',
          content: revivedContent,
          workflow_name: workflowName,
          skill_name: skillName,
          steps: JSON.stringify(['step-b']),
          update_mode: updateMode,
        }, context);
        const revivedId = JSON.parse(second.content[0].text).memory_id as string;

        expect(revivedId).not.toBe(originalId);

        const tombstone = DatabaseUtils.get(
          db,
          'SELECT content, is_deleted FROM memory_item WHERE id = ?',
          [originalId],
        ) as { content: string; is_deleted: number };
        expect(tombstone.is_deleted).toBe(1);
        expect(tombstone.content).toBe(originalContent);

        const search = await new SearchEngine(sqliteRepositoryProvider).search(db, {
          query: marker,
          limit: 10,
          filters: { type: ['procedural'] },
        });
        const ids = search.items.map((item) => item.id);
        expect(ids).toContain(revivedId);
        expect(ids).not.toContain(originalId);
      } finally {
        cleanupTestDatabase(db);
      }
    },
  );
});
