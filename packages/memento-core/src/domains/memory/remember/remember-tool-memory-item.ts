/**
 * Remember Tool — memory_item 핸들러 (working/episodic/semantic/procedural)
 * (remember-tool.ts에서 분리, #582).
 */

import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import type { MemoryTypeRequest } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { toDbRelationType } from '../../../shared/utils/relation-type-converter.js';
import { isMemoryItemType } from '../../../shared/utils/type-guards.js';
import { getNextVersionNumber } from '../procedural/procedural-versioning.js';
import { ToolInputValidationError } from '../../../shared/errors/tool-input-validation-error.js';
import {
  MemoryVersionConflictError,
  memoryItemEffectiveVersion,
} from '../../../shared/errors/memory-version-conflict-error.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';
import type { ProceduralMemoryItem } from './remember-tool-types.js';
import { findExistingProceduralMemory } from './remember-tool-db-helpers.js';
import { prepareReflectionNotes } from './remember-tool-reflection.js';
import { launchBackgroundAugmentation } from './remember-tool-augmentation.js';
import type { RememberParams } from './remember-tool-schema.js';
import {
  applyNearDupMergeInputs,
  buildSimilarityWarningFromCandidates,
  findNearDuplicateCandidates,
  isAutoMergeable,
  isNearDupMergeType,
  loadMemoryItemById,
  type NearDuplicateCandidate,
  type SimilarityWarning,
} from './remember-near-duplicate.js';

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

async function assertMemoryVersionConflict(
  db: Database.Database,
  id: string,
  ownerId: string | null,
  projectId: string | null,
  expectedVersion: number,
): Promise<never> {
  const scoped = await DatabaseUtils.get(db, `
    SELECT version
    FROM memory_item
    WHERE id = ?
      AND owner_id IS ?
      AND project_id IS ?
      AND COALESCE(is_deleted, 0) = 0
  `, [id, ownerId, projectId]) as { version: number | null } | undefined;

  if (!scoped) {
    throw new ToolInputValidationError(`memory_id를 찾을 수 없습니다: ${id}`);
  }

  throw MemoryVersionConflictError.forMemory(
    id,
    expectedVersion,
    memoryItemEffectiveVersion(scoped.version),
  );
}

type ExistingMemory = ProceduralMemoryItem & { owner_id?: string | null; project_id?: string | null };

/**
 * UPDATE·INSERT 가 공유하는 21개 컬럼은 아래 SQL 세 벌에서 같은 순서다. `buildSharedColumnValues` 가 그 순서로 값을 만든다.
 */
const UPDATE_MEMORY_ITEM_SQL = `
  UPDATE memory_item SET
    content = ?, importance = ?, privacy_scope = ?, tags = ?, source = ?,
    origin_source = ?, task_goal = ?, steps = ?, reflection_notes = ?,
    workflow_name = ?, skill_name = ?, trigger_conditions = ?,
    recall_count = ?, last_accessed_at = ?,
    owner_id = ?, process_id = ?, session_id = ?,
    num_times = ?, last_mentioned_at = ?, source_session_id = ?, confidence = ?
  WHERE id = ?
`;

const UPDATE_MEMORY_ITEM_CAS_SQL = `
  UPDATE memory_item SET
    content = ?, importance = ?, privacy_scope = ?, tags = ?, source = ?,
    origin_source = ?, task_goal = ?, steps = ?, reflection_notes = ?,
    workflow_name = ?, skill_name = ?, trigger_conditions = ?,
    recall_count = ?, last_accessed_at = ?,
    owner_id = ?, process_id = ?, session_id = ?,
    num_times = ?, last_mentioned_at = ?, source_session_id = ?, confidence = ?,
    version = ?
  WHERE id = ?
    AND owner_id IS ?
    AND project_id IS ?
    AND COALESCE(is_deleted, 0) = 0
    AND COALESCE(version, 1) = ?
`;

const INSERT_MEMORY_ITEM_SQL = `
  INSERT INTO memory_item (
    content, importance, privacy_scope, tags, source,
    origin_source, task_goal, steps, reflection_notes,
    workflow_name, skill_name, trigger_conditions,
    recall_count, last_accessed_at,
    owner_id, process_id, session_id,
    num_times, last_mentioned_at, source_session_id, confidence,
    id, type, created_at, version, version_series_id, project_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** 기존 행을 그 자리에서 고치는 갱신인가 (versioned 는 새 행을 만든다) */
function isInPlaceUpdate(
  existingMemory: ProceduralMemoryItem | null,
  updateMode: RememberParams['update_mode'],
): boolean {
  return !!existingMemory && (updateMode === 'replace' || updateMode === 'incremental');
}

/** incremental 갱신이면 기존 steps 배열 뒤에 새 steps 를 잇는다. 병합 실패 시 새 steps 를 쓴다 */
function mergeSteps(
  steps: string | undefined,
  previous: ProceduralMemoryItem | null,
  updateMode: RememberParams['update_mode'],
  host: RememberToolHost,
): string | null {
  if (!steps) return null;
  if (updateMode !== 'incremental' || !previous?.steps) return steps;
  try {
    const existingSteps = JSON.parse(previous.steps);
    const newSteps = JSON.parse(steps);
    return Array.isArray(existingSteps) && Array.isArray(newSteps)
      ? JSON.stringify([...existingSteps, ...newSteps])
      : steps;
  } catch (error) {
    host.logWarning('steps 병합 실패, 새 steps 사용', {
      error: error instanceof Error ? error.message : String(error)
    });
    return steps;
  }
}

/**
 * 공유 21개 컬럼 값을 SQL 상수의 컬럼 순서대로 만든다.
 * `previous` 는 그 자리에서 고칠 기존 행이다 (새 행이면 null).
 */
function buildSharedColumnValues(
  params: RememberParams,
  ctx: MemoryItemContext,
  previous: ProceduralMemoryItem | null,
  finalReflectionNotes: string | null,
  createdAt: string,
  host: RememberToolHost,
): unknown[] {
  const recallCount = previous?.recall_count !== undefined ? previous.recall_count + 1 : 1;
  const lastAccessedAt = previous?.last_accessed_at
    ? new Date(previous.last_accessed_at).toISOString()
    : null;
  const lastMentionedAt = ctx.last_mentioned_at_param ?? (previous ? new Date().toISOString() : createdAt);

  return [
    params.content, params.importance, params.privacy_scope,
    params.tags ? JSON.stringify(params.tags) : null, params.source || null,
    ctx.origin_source, params.task_goal || null,
    mergeSteps(params.steps, previous, params.update_mode, host), finalReflectionNotes,
    params.workflow_name || null, params.skill_name || null, params.trigger_conditions || null,
    recallCount, lastAccessedAt,
    ctx.ownerId, ctx.processId, ctx.sessionId,
    ctx.numTimes, lastMentionedAt, ctx.sourceSessionId, ctx.confidenceVal,
  ];
}

async function updateMemoryItemRow(
  db: Database.Database,
  id: string,
  sharedValues: unknown[],
  ownerId: string | null,
  projectId: string | null,
  expectedVersion: number | undefined,
): Promise<void> {
  if (expectedVersion === undefined) {
    await DatabaseUtils.run(db, UPDATE_MEMORY_ITEM_SQL, [...sharedValues, id]);
    return;
  }
  const result = await DatabaseUtils.run(db, UPDATE_MEMORY_ITEM_CAS_SQL, [
    ...sharedValues, expectedVersion + 1,
    id, ownerId, projectId, expectedVersion,
  ]);
  if (result.changes === 0) {
    await assertMemoryVersionConflict(db, id, ownerId, projectId, expectedVersion);
  }
}

/** procedural 새 행의 version·version_series_id. versioned 갱신이면 대상 시리즈를 잇는다 */
function resolveProceduralVersion(
  db: Database.Database,
  id: string,
  type: MemoryTypeRequest,
  existingMemory: ProceduralMemoryItem | null,
  updateMode: RememberParams['update_mode'],
): { version: number | null; seriesId: string | null } {
  if (type !== 'procedural') return { version: null, seriesId: null };
  if (existingMemory && updateMode === 'versioned') {
    const seriesId = existingMemory.version_series_id ?? existingMemory.id;
    return { version: getNextVersionNumber(db, seriesId), seriesId };
  }
  return { version: 1, seriesId: id };
}

async function insertVersionOfLink(
  db: Database.Database,
  id: string,
  targetId: string,
  host: RememberToolHost,
): Promise<void> {
  try {
    await DatabaseUtils.run(db, `
      INSERT INTO memory_link (source_id, target_id, relation_type)
      VALUES (?, ?, ?)
    `, [id, targetId, toDbRelationType('VERSION_OF')]);
  } catch (error) {
    host.logWarning('버전 관계 추가 실패', {
      source_id: id,
      target_id: targetId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function insertMemoryItemRow(
  db: Database.Database,
  id: string,
  sharedValues: unknown[],
  ctx: MemoryItemContext,
  createdAt: string,
  existingMemory: ProceduralMemoryItem | null,
  updateMode: RememberParams['update_mode'],
  host: RememberToolHost,
): Promise<void> {
  const procedural = resolveProceduralVersion(db, id, ctx.type, existingMemory, updateMode);
  await DatabaseUtils.run(db, INSERT_MEMORY_ITEM_SQL, [
    ...sharedValues,
    id, ctx.type, createdAt, procedural.version, procedural.seriesId, ctx.project_id_param ?? null,
  ]);
  if (updateMode === 'versioned' && existingMemory) {
    await insertVersionOfLink(db, id, existingMemory.id, host);
  }
}

async function persistMemoryItem(
  db: Database.Database,
  id: string,
  params: RememberParams,
  ctx: MemoryItemContext,
  existingMemory: ProceduralMemoryItem | null,
  finalReflectionNotes: string | null,
  host: RememberToolHost
): Promise<{ casVersion?: number }> {
  const { update_mode, expected_version } = params;
  const isUpdate = isInPlaceUpdate(existingMemory, update_mode);
  const previous = isUpdate ? existingMemory : null;

  try {
    await DatabaseUtils.runTransaction(db, async () => {
      const createdAt = new Date().toISOString();
      const sharedValues = buildSharedColumnValues(params, ctx, previous, finalReflectionNotes, createdAt, host);
      if (isUpdate) {
        await updateMemoryItemRow(db, id, sharedValues, ctx.ownerId, ctx.project_id_param ?? null, expected_version);
      } else {
        await insertMemoryItemRow(db, id, sharedValues, ctx, createdAt, existingMemory, update_mode, host);
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'SQLITE_BUSY') {
      try { await DatabaseUtils.checkpointWAL(db); } catch { /* ignore */ }
    }
    throw error;
  }

  return isUpdate && expected_version !== undefined ? { casVersion: expected_version + 1 } : {};
}

function shouldSkipNearDupSearch(
  type: MemoryTypeRequest,
  update_mode: RememberParams['update_mode'],
  existingProceduralHit: boolean,
  explicitTarget: boolean,
): boolean {
  return mementoConfig.rememberDedupMode === 'off'
    || explicitTarget
    || (type === 'procedural' && !!update_mode && existingProceduralHit);
}

/** 쓰기 한 건이 단계를 거치며 채우는 상태: 갱신 대상·병합된 입력·near-duplicate 결과 */
interface WriteDraft {
  params: RememberParams;
  numTimes: number;
  projectId: string | null;
  existingMemory: ExistingMemory | null;
  /** 그 자리에서 고칠 행 id. null 이면 새 행을 만든다 */
  existingMemoryId: string | null;
  explicitTarget: boolean;
  proceduralHit: boolean;
  nearDupCandidates: NearDuplicateCandidate[];
  nearDupTruncated: boolean;
  nearDupMerged: boolean;
}

/** memory_id 로 지정한 갱신 대상을 검증해 draft 에 싣는다 (#1000) */
async function applyExplicitTarget(
  db: Database.Database,
  draft: WriteDraft,
  memoryId: string,
  ctx: MemoryItemContext,
  host: RememberToolHost,
): Promise<void> {
  const { update_mode } = draft.params;
  if (!update_mode) {
    throw new ToolInputValidationError(
      'memory_id는 update_mode(replace|incremental|versioned)와 함께 사용해야 합니다',
    );
  }

  const loaded = await loadMemoryItemById(db, memoryId, host);
  if (!loaded) {
    throw new ToolInputValidationError(`memory_id를 찾을 수 없습니다: ${memoryId}`);
  }
  if (loaded.type !== ctx.type) {
    throw new ToolInputValidationError(
      `memory_id의 type(${loaded.type})이 요청 type(${ctx.type})과 다릅니다`,
    );
  }
  if (String(loaded.owner_id ?? '') !== String(ctx.ownerId ?? '')) {
    throw new ToolInputValidationError(`memory_id에 접근할 수 없습니다: ${memoryId}`);
  }
  // project_id 를 명시하지 않은 갱신은 대상의 project_id 를 잇는다 (#1281). 접근 경계는 위 owner 검증이다.
  if (ctx.project_id_param === undefined) {
    draft.projectId = loaded.project_id ?? null;
  } else if (String(loaded.project_id ?? '') !== String(draft.projectId ?? '')) {
    throw new ToolInputValidationError(
      `memory_id의 project_id가 요청과 다릅니다: ${memoryId}`,
    );
  }

  draft.existingMemory = loaded;
  draft.explicitTarget = true;
  if (isInPlaceUpdate(loaded, update_mode)) {
    draft.existingMemoryId = loaded.id;
  }
}

/** 갱신 대상을 정한다: memory_id 명시 대상, 아니면 procedural 의 workflow_name·skill_name 조회 */
async function resolveWriteTarget(
  db: Database.Database,
  params: RememberParams,
  ctx: MemoryItemContext,
  host: RememberToolHost,
): Promise<WriteDraft> {
  const draft: WriteDraft = {
    params,
    numTimes: ctx.numTimes,
    projectId: ctx.project_id_param ?? null,
    existingMemory: null,
    existingMemoryId: null,
    explicitTarget: false,
    proceduralHit: false,
    nearDupCandidates: [],
    nearDupTruncated: false,
    nearDupMerged: false,
  };

  if (params.memory_id) {
    await applyExplicitTarget(db, draft, params.memory_id, ctx, host);
  } else if (ctx.type === 'procedural' && params.update_mode) {
    draft.existingMemory = await findExistingProceduralMemory(db, params.workflow_name, params.skill_name, host);
    if (isInPlaceUpdate(draft.existingMemory, params.update_mode)) {
      draft.existingMemoryId = draft.existingMemory!.id;
      draft.proceduralHit = true;
    }
  }
  return draft;
}

/** 대상이 없는 incremental 저장이면 가장 가까운 near-duplicate 에 자동 병합한다 */
async function applyNearDupAutoMerge(
  db: Database.Database,
  draft: WriteDraft,
  type: MemoryTypeRequest,
  host: RememberToolHost,
): Promise<void> {
  const top = draft.nearDupCandidates[0];
  if (
    draft.existingMemoryId
    || draft.params.update_mode !== 'incremental'
    || !top
    || !isNearDupMergeType(type)
    || !isAutoMergeable(top, mementoConfig.rememberDedupMergeLexicalFloor)
  ) {
    return;
  }
  const loaded = await loadMemoryItemById(db, top.id, host);
  if (!loaded) return;
  const merged = applyNearDupMergeInputs(draft.params, draft.numTimes, loaded, type);
  draft.params = { ...merged.params, update_mode: 'incremental' };
  draft.numTimes = merged.numTimes;
  draft.existingMemory = merged.existing;
  draft.existingMemoryId = top.id;
  draft.nearDupMerged = true;
}

/** near-duplicate 검색 후 병합 입력을 draft 에 반영한다 */
async function resolveNearDuplicates(
  db: Database.Database,
  draft: WriteDraft,
  ctx: MemoryItemContext,
  context: ToolContext,
  host: RememberToolHost,
): Promise<void> {
  const { type, ownerId } = ctx;
  if (!shouldSkipNearDupSearch(type, draft.params.update_mode, draft.proceduralHit, draft.explicitTarget)) {
    const nearDupResult = await findNearDuplicateCandidates(
      db,
      draft.params.content!,
      { type, ownerId, projectId: draft.projectId },
      mementoConfig.rememberDedupThreshold,
      context,
      host,
    );
    draft.nearDupCandidates = nearDupResult.candidates;
    draft.nearDupTruncated = nearDupResult.truncated;
  }

  await applyNearDupAutoMerge(db, draft, type, host);

  if (draft.explicitTarget && draft.params.update_mode === 'incremental' && draft.existingMemory && isNearDupMergeType(type)) {
    const merged = applyNearDupMergeInputs(draft.params, draft.numTimes, draft.existingMemory, type);
    draft.params = merged.params;
    draft.numTimes = merged.numTimes;
    draft.existingMemory = merged.existing;
  }
}

function buildResultSimilarityWarning(draft: WriteDraft): SimilarityWarning | undefined {
  const options = {
    mergeLexicalFloor: mementoConfig.rememberDedupMergeLexicalFloor,
    truncated: draft.nearDupTruncated,
  };
  if (draft.nearDupMerged) {
    return buildSimilarityWarningFromCandidates(draft.nearDupCandidates, 'merged', options);
  }
  if (mementoConfig.rememberDedupMode === 'warn' && draft.nearDupCandidates.length > 0) {
    return buildSimilarityWarningFromCandidates(draft.nearDupCandidates, 'warned', options);
  }
  return undefined;
}

function recordWriteCompleted(
  context: ToolContext,
  ctx: MemoryItemContext,
  id: string,
  contentHash: string,
  draft: WriteDraft,
): void {
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const isDuplicate =
    context.services?.telemetryService?.hasPriorWriteWithContentHash(ctx.ownerId, contentHash, since24h) ?? false;
  context.services?.telemetryService?.record({
    eventType: 'memory.write.completed',
    outcome: 'success',
    latencyMs: Date.now() - ctx.startTime,
    extraData: {
      memory_type: ctx.type,
      memory_id: id,
      content_hash: contentHash,
      is_duplicate: isDuplicate,
      dedup_mode: mementoConfig.rememberDedupMode,
      dedup_action: draft.nearDupMerged ? 'merged' : (draft.nearDupCandidates.length > 0 ? 'warned' : undefined),
    }
  });
}

export async function handleMemoryItem(
  params: RememberParams,
  context: ToolContext,
  ctx: MemoryItemContext,
  host: RememberToolHost
): Promise<ToolResult> {
  const { type } = ctx;
  const { content, task_goal, reflection_notes, importance } = params;

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

  const db = context.db!;
  const finalReflectionNotes = type === 'procedural' && reflection_notes != null
    ? await prepareReflectionNotes(db, reflection_notes, task_goal, host)
    : null;

  const draft = await resolveWriteTarget(db, params, ctx, host);
  await resolveNearDuplicates(db, draft, ctx, context, host);

  if (!draft.existingMemoryId && mementoConfig.rememberDedupMode === 'strict' && draft.nearDupCandidates.length > 0) {
    const similarity_warning = buildSimilarityWarningFromCandidates(draft.nearDupCandidates, 'rejected', {
      mergeLexicalFloor: mementoConfig.rememberDedupMergeLexicalFloor,
      truncated: draft.nearDupTruncated,
    });
    return host.createErrorResult(
      'NEAR_DUPLICATE',
      '유사한 기억이 이미 존재하여 저장이 거절되었습니다. update_mode=incremental로 병합하세요.',
      { similarity_warning },
    );
  }

  const id = draft.existingMemoryId || `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const { casVersion } = await persistMemoryItem(
    db,
    id,
    draft.params,
    { ...ctx, project_id_param: draft.projectId, numTimes: draft.numTimes },
    draft.existingMemory,
    finalReflectionNotes,
    host,
  );

  launchBackgroundAugmentation(
    {
      dbRef: db,
      savedMemoryId: id,
      savedMemoryType: type,
      content,
      importance: importance ?? 0.5,
    },
    context,
    host
  );

  recordWriteCompleted(context, ctx, id, contentHash, draft);
  const similarity_warning = buildResultSimilarityWarning(draft);

  return host.createSuccessResult({
    memory_id: id,
    type: type,
    ...(draft.existingMemoryId ? { updated: true } : {}),
    ...(casVersion !== undefined ? { version: casVersion } : {}),
    message: draft.existingMemoryId
      ? `기억이 갱신되었습니다: ${id}`
      : `기억이 저장되었습니다: ${id}`,
    embedding_created: context.services.embeddingService?.isAvailable() || false,
    ...(similarity_warning ? { similarity_warning } : {})
  });
}
