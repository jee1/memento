import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import { mementoConfig } from '../shared/config/index.js';
import { validateConfiguration } from '../shared/utils/configuration-validator.js';
import { WipeMemoryTool } from '../domains/memory/tools/wipe-memory-tool.js';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../test/helpers/test-database.js';

describe('governance feature toggles (unit)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
    mementoConfig.offlineStrict = false;
    mementoConfig.projectScopeEnabled = true;
    mementoConfig.granularToolScopesEnabled = true;
    mementoConfig.wipeMemoryEnabled = true;
    mementoConfig.embeddingProvider = 'minilm';
    mementoConfig.llmProvider = 'auto';
  });

  describe('offlineStrict toggle (MEMENTO_OFFLINE_STRICT)', () => {
    it('when false (OFF), remote providers do not trigger offline validation error', () => {
      mementoConfig.offlineStrict = false;
      mementoConfig.embeddingProvider = 'openai';
      mementoConfig.openaiApiKey = 'test-key';
      mementoConfig.llmProvider = 'openai';

      const result = validateConfiguration(mementoConfig, { throwOnError: false });
      expect(result.errors.some((e) => e.code.includes('OFFLINE_STRICT'))).toBe(false);
    });

    it('when true (ON), remote providers trigger fatal offline validation error', () => {
      mementoConfig.offlineStrict = true;
      mementoConfig.embeddingProvider = 'openai';
      mementoConfig.openaiApiKey = 'test-key';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /remote provider openai is forbidden in offline strict mode/,
      );
    });
  });

  describe('wipeMemoryEnabled toggle (MEMENTO_WIPE_MEMORY_ENABLED)', () => {
    it('when true (ON), wipe_memory tool executes successfully', async () => {
      mementoConfig.wipeMemoryEnabled = true;
      const memId = createTestMemory(db, { content: 'Wipeable item', type: 'episodic' });

      const tool = new WipeMemoryTool();
      const res = await tool.handle(
        { id: memId, zero_fill: false },
        { db, services: {} as any, agentId: 'test-admin' },
      );

      const payload = JSON.parse(res.content[0].text);
      expect(payload.success).toBe(true);
      expect(payload.purged_count).toBe(1);
    });

    it('when false (OFF), wipe_memory tool throws disabled error', async () => {
      mementoConfig.wipeMemoryEnabled = false;
      const memId = createTestMemory(db, { content: 'Wipeable item', type: 'episodic' });

      const tool = new WipeMemoryTool();
      await expect(
        tool.handle(
          { id: memId, zero_fill: false },
          { db, services: {} as any, agentId: 'test-admin' },
        ),
      ).rejects.toThrow(/wipe_memory tool is disabled by configuration/);
    });
  });
});
