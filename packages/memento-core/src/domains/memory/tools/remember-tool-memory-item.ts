/**
 * Remember Tool — memory_item 핸들러 (working/episodic/semantic/procedural)
 * (remember-tool.ts에서 분리, #582).
 */

import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import { isMemoryItemType } from '../../../shared/types/index.js';
import type { MemoryTypeRequest } from '../../../shared/types/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { toDbRelationType } from '../../../shared/utils/relation-type-converter.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { getNextVersionNumber } from '../services/procedural-versioning.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';
import type { ProceduralMemoryItem } from './remember-tool-types.js';
import { findExistingProceduralMemory } from './remember-tool-db-helpers.js';
import { prepareReflectionNotes } from './remember-tool-reflection.js';
import { launchBackgroundAugmentation } from './remember-tool-augmentation.js';
import type { RememberParams } from './remember-tool-schema.js';

export interface MemoryItemContext {
  type: MemoryTypeRequest;
  ownerId: string | null;
  processId: string | null;
  sessionId: string | null;
  numTimes: number;
  sourceSessionId: string | null;
  confidenceVal: number | null;
  origin_source: string;
  startTime: number;
  project_id_param: string | undefined | null;
  last_mentioned_at_param: string | undefined | null;
}

async function buildSimilarityWarning(
  db: Database.Database,
  content: string,
  id: string,
  type: MemoryTypeRequest,
  ownerId: string | null,
  context: ToolContext
): Promise<{ count: number; similar_ids: string[] } | undefined> {
  try {
    const embSvc = context.services?.embeddingService;
    if (!embSvc?.isAvailable()) return undefined;

    const vecEng = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
    vecEng.initialize(db);
    const unified = embSvc.getUnifiedEmbeddingService();
    const qEmb = await unified.generateEmbedding(content);
    if (!qEmb?.embedding || !Array.isArray(qEmb.embedding)) return undefined;

    const prov = unified.getCurrentProviderName() ?? 'tfidf';
    const hits = await vecEng.search(qEmb.embedding, { limit: 8, threshold: 0.85, types: [type] }, prov);
    const sameOwner = hits.filter(h => {
      if (h.memory_id === id) return false;
      const row = DatabaseUtils.get(db, `SELECT owner_id FROM memory_item WHERE id = ?`, [h.memory_id]) as { owner_id: string | null } | undefined;
      return String(row?.owner_id ?? '') === String(ownerId ?? '');
    });

    return sameOwner.length > 0 ? { count: sameOwner.length, similar_ids: sameOwner.map(s => s.memory_id) } : undefined;
  } catch {
    return undefined;
  }
}

async function persistMemoryItem(
  db: Database.Database,
  id: string,
  params: RememberParams,
  ctx: MemoryItemContext,
  existingMemory: ProceduralMemoryItem | null,
  finalReflectionNotes: string | null,
  context: ToolContext,
  host: RememberToolHost
): Promise<void> {
  const { type, ownerId, processId, sessionId, numTimes, sourceSessionId, confidenceVal, origin_source, project_id_param, last_mentioned_at_param } = ctx;
  const { content, importance, privacy_scope, tags, source, task_goal, steps, workflow_name, skill_name, trigger_conditions, update_mode } = params;

  await DatabaseUtils.runTransaction(db, async () => {
    const isUpdate = !!(existingMemory && update_mode && (update_mode === 'replace' || update_mode === 'incremental'));

    const createdAt = new Date().toISOString();
    const recallCount = isUpdate && existingMemory && existingMemory.recall_count !== undefined
      ? existingMemory.recall_count + 1 : 1;
    const gValue = isUpdate && existingMemory && existingMemory.g_value !== undefined
      ? existingMemory.g_value
      : (mementoConfig.consolidationScoreEnabled ? 1.0 : null);
    const lastAccessedAt = isUpdate && existingMemory && existingMemory.last_accessed_at
      ? new Date(existingMemory.last_accessed_at).toISOString()
      : (mementoConfig.consolidationScoreEnabled ? createdAt : null);
    const lastMentionedAt = last_mentioned_at_param ?? (isUpdate ? new Date().toISOString() : createdAt);

    let finalSteps = steps || null;
    if (isUpdate && update_mode === 'incremental' && existingMemory && existingMemory.steps && steps) {
      try {
        const existingSteps = JSON.parse(existingMemory.steps);
        const newSteps = JSON.parse(steps);
        finalSteps = Array.isArray(existingSteps) && Array.isArray(newSteps)
          ? JSON.stringify([...existingSteps, ...newSteps])
          : steps;
      } catch (error) {
        host.logWarning('steps 병합 실패, 새 steps 사용', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let consolidationScore: number | null = null;
    if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService) {
      const scoreResult = context.services.consolidationScoreService.calculateScore({
        recallCount,
        lastAccessedAt: lastAccessedAt ? new Date(lastAccessedAt) : new Date(createdAt),
        createdAt: isUpdate && existingMemory?.created_at ? new Date(existingMemory.created_at) : new Date(createdAt),
        gValue: gValue ?? 1.0,
        type: type as import('../../../shared/types/index.js').MemoryType,
        pinned: isUpdate && existingMemory?.pinned ? Boolean(existingMemory.pinned) : false
      });
      consolidationScore = scoreResult.score;
    }

    const tagsJson = tags ? JSON.stringify(tags) : null;

    if (isUpdate) {
      await DatabaseUtils.run(db, `
        UPDATE memory_item SET
          content = ?, importance = ?, privacy_scope = ?, tags = ?, source = ?,
          origin_source = ?, task_goal = ?, steps = ?, reflection_notes = ?,
          workflow_name = ?, skill_name = ?, trigger_conditions = ?,
          recall_count = ?, last_accessed_at = ?, g_value = ?, consolidation_score = ?,
          owner_id = ?, process_id = ?, session_id = ?,
          num_times = ?, last_mentioned_at = ?, source_session_id = ?, confidence = ?
        WHERE id = ?
      `, [
        content, importance, privacy_scope, tagsJson, source || null,
        origin_source, task_goal || null, finalSteps, finalReflectionNotes,
        workflow_name || null, skill_name || null, trigger_conditions || null,
        recallCount, lastAccessedAt, gValue, consolidationScore,
        ownerId, processId, sessionId,
        numTimes, lastMentionedAt, sourceSessionId, confidenceVal,
        id
      ]);
    } else {
      const proceduralVersion = type === 'procedural' && existingMemory && update_mode === 'versioned'
        ? getNextVersionNumber(db, existingMemory.version_series_id ?? existingMemory.id)
        : (type === 'procedural' ? 1 : null);
      const proceduralVersionSeriesId = type === 'procedural' && existingMemory && update_mode === 'versioned'
        ? (existingMemory.version_series_id ?? existingMemory.id)
        : (type === 'procedural' ? id : null);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (
          id, type, content, importance, privacy_scope, tags, source, origin_source,
          task_goal, steps, reflection_notes,
          workflow_name, skill_name, trigger_conditions,
          created_at,
          recall_count, last_accessed_at, g_value, consolidation_score,
          version, version_series_id, owner_id, process_id, session_id, project_id,
          num_times, last_mentioned_at, source_session_id, confidence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, type, content, importance, privacy_scope, tagsJson, source || null, origin_source,
        task_goal || null, finalSteps, finalReflectionNotes,
        workflow_name || null, skill_name || null, trigger_conditions || null,
        createdAt,
        recallCount, lastAccessedAt, gValue, consolidationScore,
        proceduralVersion, proceduralVersionSeriesId, ownerId, processId, sessionId, project_id_param ?? null,
        numTimes, lastMentionedAt, sourceSessionId, confidenceVal
      ]);

      if (update_mode === 'versioned' && existingMemory) {
        try {
          const dbRelationType = toDbRelationType('VERSION_OF');
          await DatabaseUtils.run(db, `
            INSERT INTO memory_link (source_id, target_id, relation_type)
            VALUES (?, ?, ?)
          `, [id, existingMemory.id, dbRelationType]);
        } catch (error) {
          host.logWarning('버전 관계 추가 실패', {
            source_id: id,
            target_id: existingMemory.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  });
}

export async function handleMemoryItem(
  params: RememberParams,
  context: ToolContext,
  ctx: MemoryItemContext,
  host: RememberToolHost
): Promise<ToolResult> {
  const { type, ownerId, startTime } = ctx;
  const { content, update_mode, workflow_name, skill_name, task_goal, reflection_notes, enable_triple_extraction, importance } = params;

  if (!content) {
    throw new Error("type이 'core' 또는 'vault'가 아닐 때는 content가 필수입니다");
  }

  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  context.services?.telemetryService?.record({
    eventType: 'memory.write.requested',
    outcome: 'success',
    extraData: { memory_type: type, content_hash: contentHash }
  });

  if (!isMemoryItemType(type)) {
    throw new Error(`Invalid memory type: ${type}`);
  }

  const finalReflectionNotes = type === 'procedural' && reflection_notes != null
    ? await prepareReflectionNotes(context.db!, reflection_notes, task_goal, host)
    : null;

  let existingMemory: ProceduralMemoryItem | null = null;
  let existingMemoryId: string | null = null;
  if (type === 'procedural' && update_mode) {
    existingMemory = await findExistingProceduralMemory(context.db!, workflow_name, skill_name, host);
    if (existingMemory && (update_mode === 'replace' || update_mode === 'incremental')) {
      existingMemoryId = existingMemory.id;
    }
  }

  const id = existingMemoryId || `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    await persistMemoryItem(context.db!, id, params, ctx, existingMemory, finalReflectionNotes, context, host);
  } catch (error) {
    const errorWithCode = error as { code?: string };
    if (errorWithCode.code === 'SQLITE_BUSY') {
      try { await DatabaseUtils.checkpointWAL(context.db); } catch { /* ignore */ }
    }
    throw error;
  }

  launchBackgroundAugmentation(
    {
      dbRef: context.db!,
      savedMemoryId: id,
      savedMemoryType: type,
      content,
      importance: importance ?? 0.5,
      enable_triple_extraction
    },
    context,
    host
  );

  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const isDuplicate =
    context.services?.telemetryService?.hasPriorWriteWithContentHash(ownerId, contentHash, since24h) ?? false;
  context.services?.telemetryService?.record({
    eventType: 'memory.write.completed',
    outcome: 'success',
    latencyMs: Date.now() - startTime,
    extraData: { memory_type: type, memory_id: id, content_hash: contentHash, is_duplicate: isDuplicate }
  });

  const similarity_warning = await buildSimilarityWarning(context.db!, content, id, type, ownerId, context);

  return host.createSuccessResult({
    memory_id: id,
    type: type,
    message: `기억이 저장되었습니다: ${id}`,
    embedding_created: context.services.embeddingService?.isAvailable() || false,
    ...(similarity_warning ? { similarity_warning } : {})
  });
}
