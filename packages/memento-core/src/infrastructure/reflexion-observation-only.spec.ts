import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDatabase } from '../../test/helpers/test-database.js';
import { mementoConfig } from '../shared/config/index.js';
import type { FailureEvent } from '../shared/types/failure-event.js';
import type { MemoryEmbeddingService } from '../domains/embedding/services/memory-embedding-service.js';
import { LlmProceduralExtractor } from '../domains/memory/procedural/procedural-llm-extractor.js';
import { ConsolidationRepository } from '../domains/consolidation/repositories/consolidation-repository.js';
import { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { createHybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { RecallTool } from '../domains/memory/recall/recall-tool.js';
import { sqliteRepositoryProvider } from './database/factories/sqlite-repository-provider.js';
import { ReflexionReflectionRecorder } from './reflexion-reflection-recorder.js';
import { ReflexionProceduralMemoryService } from './reflexion-procedural-memory-service.js';

function failure(id = 'failure-1'): FailureEvent {
  return {
    id, tool_name: 'remember', error_type: 'tool_error', error_message: 'database timeout',
    error_message_hash: 'same-error', timestamp: new Date().toISOString(), priority: 5,
    original_task: 'database migration', context: { environment: 'test', tool_version: '1' },
    scope: { owner_id: 'owner-a', project_id: 'project-a' },
  };
}

describe('Reflexion observation-only (#1547)', () => {
  let db: Database.Database;
  let service: ReflexionProceduralMemoryService;
  let recorder: ReflexionReflectionRecorder;
  const savedConfig = { ...mementoConfig };
  const embedding = { createAndStoreEmbedding: vi.fn().mockResolvedValue({ provider: 'tfidf' }) };

  beforeEach(async () => {
    db = await setupTestDatabase();
    Object.assign(mementoConfig, { reflexionObservationOnly: true });
    service = new ReflexionProceduralMemoryService(db, embedding as unknown as MemoryEmbeddingService);
    recorder = new ReflexionReflectionRecorder(db, service, 60000);
  });

  afterEach(() => {
    Object.assign(mementoConfig, savedConfig);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    db.close();
  });

  function seedLegacy() {
    db.prepare(`INSERT INTO memory_item
      (id, type, content, task_goal, workflow_name, steps, reflection_notes, importance, owner_id, project_id)
      VALUES ('legacy', 'procedural', 'database migration', 'database migration', 'database migration',
      '["keep original"]', '{"lessons_learned":"old reflection"}', 0.9, 'owner-b', 'project-b')`).run();
    return db.prepare("SELECT * FROM memory_item WHERE id = 'legacy'").get();
  }

  it.each([true, false])('keeps both recorder paths outside procedural and preserves legacy (goal=%s)', async (withGoal) => {
    const original = seedLegacy();
    const event = failure();
    if (!withGoal) delete event.original_task;
    await recorder.record(event);

    expect(db.prepare("SELECT * FROM memory_item WHERE id = 'legacy'").get()).toEqual(original);
    const rows = db.prepare("SELECT * FROM memory_item WHERE id != 'legacy'").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.type === 'episodic' && row.pinned === 1)).toBe(true);
    expect(rows.every(row => row.owner_id === 'owner-a' && row.project_id === 'project-a')).toBe(true);
    expect(rows.map(row => JSON.parse(String(row.origin_source)).reflexion.state).sort())
      .toEqual(['failure_observation', 'unverified_candidate']);
    for (const row of rows) {
      expect(row.content).toMatch(/실패 관찰|미검증/);
      expect(JSON.parse(String(row.origin_source)).reflexion).toMatchObject({
        event_id: event.id, environment: 'test', tool_version: '1',
      });
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM memory_item WHERE type = 'procedural'").get()).toEqual({ n: 1 });
  });

  it('does not lose another owner/project/environment/task or event to error-message deduplication', async () => {
    const events = [failure(), failure(), failure(), failure(), failure(), failure('failure-2')];
    events[1].scope = { owner_id: 'owner-b', project_id: 'project-a' };
    events[2].scope = { owner_id: 'owner-a', project_id: 'project-b' };
    events[3].context.environment = 'production';
    events[4].original_task = 'another migration';
    for (const event of events) expect(await recorder.record(event)).toBe(true);
    expect(await recorder.record(events[0])).toBe(false);
    const rows = db.prepare('SELECT origin_source FROM memory_item').all() as Array<{ origin_source: string }>;
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map(row => JSON.parse(row.origin_source).reflexion.event_id)).size).toBe(2);
  });

  it.each(['replace', 'incremental', 'versioned'] as const)('direct %s requests only append an unverified candidate', async (mode) => {
    const original = seedLegacy();
    await service.updateProceduralMemory('legacy', {
      workflow_name: 'database migration', task_goal: 'new goal', steps: '["unverified retry"]',
    }, mode, { lessons_learned: 'unverified retry' }, failure());
    expect(db.prepare("SELECT * FROM memory_item WHERE id = 'legacy'").get()).toEqual(original);
    expect(db.prepare("SELECT type FROM memory_item WHERE id != 'legacy'").all()).toEqual([{ type: 'episodic' }]);
    expect(embedding.createAndStoreEmbedding.mock.calls.every(call => call[3] === 'episodic')).toBe(true);
  });

  it('captures rule proposals without calling an LLM even when legacy extraction is llm_first', async () => {
    mementoConfig.proceduralExtractionStrategy = 'llm_first';
    const llm = vi.spyOn(LlmProceduralExtractor.prototype, 'extract').mockResolvedValue(null);
    await recorder.record(failure());
    expect(llm).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS n FROM memory_item WHERE type = 'procedural'").get()).toEqual({ n: 0 });
  });

  it('keeps raw observations pinned against automatic consolidation and forgetting', async () => {
    await recorder.record(failure());
    expect(new ConsolidationRepository(db).findEpisodicCandidates(null)).toEqual([]);
    db.prepare("UPDATE memory_item SET created_at = '2000-01-01T00:00:00.000Z'").run();
    const original = db.prepare('SELECT * FROM memory_item ORDER BY id').all();
    await new ForgettingPolicyService().executeMemoryCleanup(db);
    expect(db.prepare('SELECT * FROM memory_item ORDER BY id').all()).toEqual(original);
  });

  it('returns old procedural reflections and new scoped episodic history through actual recall', async () => {
    seedLegacy();
    await recorder.record(failure());
    const tool = new RecallTool();
    const context = { db, services: {
      repositories: sqliteRepositoryProvider, searchEngine: new SearchEngine(sqliteRepositoryProvider),
      hybridSearchEngine: createHybridSearchEngine(sqliteRepositoryProvider),
    } };
    const recall = async (type: 'procedural' | 'episodic', owner?: string, stepsOnly = false) => {
      const result = await tool.handle({
        query: 'database migration', type, enable_hybrid: false, auto_set_anchor: false,
        has_reflection_notes: true, ...(owner && { owner_id: owner }),
        return_format: stepsOnly ? 'steps_only' : 'full',
      }, context);
      return JSON.parse(result.content[0].text).items as Array<Record<string, unknown>>;
    };
    expect((await recall('procedural')).map(row => row.memory_id)).toEqual(['legacy']);
    const history = await recall('episodic', 'owner-a');
    expect(history).toHaveLength(2);
    expect(history.map(row => (row.origin_source as { reflexion: { state: string } }).reflexion.state).sort())
      .toEqual(['failure_observation', 'unverified_candidate']);
    expect(history.every(row => (row.reflection_notes as { failure_description: string }).failure_description === 'database timeout')).toBe(true);
    const steps = await recall('episodic', 'owner-a', true);
    const candidate = steps.find(row => (row.origin_source as { reflexion: { state: string } }).reflexion.state === 'unverified_candidate');
    expect(candidate?.content).toContain('미검증');
    expect(candidate?.steps).toBeTruthy();
    expect(await recall('episodic', 'owner-b')).toEqual([]);
    db.prepare(`INSERT INTO memory_item (id, type, content, source, owner_id, reflection_notes, steps)
      VALUES ('old-episode', 'episodic', 'database migration', 'reflexion', 'owner-b',
      '{"lessons_learned":"legacy episode"}', '["old step"]')`).run();
    const [oldEpisode] = await recall('episodic', 'owner-b');
    expect(oldEpisode.memory_id).toBe('old-episode');
    expect(oldEpisode.reflection_notes).toBeUndefined();
    expect(oldEpisode.steps).toBeUndefined();
  });

  it('leaves legacy behavior enabled when the flag is off', async () => {
    Object.assign(mementoConfig, { reflexionObservationOnly: false });
    await recorder.record(failure());
    const rows = db.prepare('SELECT type FROM memory_item').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => (row as { type: string }).type === 'procedural')).toBe(true);
  });
});
