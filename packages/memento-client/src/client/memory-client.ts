import type {
  MemoryItem,
  CreateMemoryParams,
  UpdateMemoryParams,
  RememberResult,
  PinResult,
  ForgetResult,
} from '../types.js';
import type { MementoClientCore } from './client-context.js';
import { recall } from './search-client.js';

/**
 * 기억 저장
 */
export async function remember(
  client: MementoClientCore,
  params: CreateMemoryParams,
): Promise<RememberResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/remember', params);
  const result = response.data.result;

  client.emit('memory:created', result);
  return result;
}

/**
 * 기억 조회
 */
export async function getMemory(client: MementoClientCore, id: string): Promise<MemoryItem> {
  client.ensureConnected();

  const searchResult = await recall(client, 'memory', { id: [id] }, 1);

  let items: MemoryItem[];
  if (searchResult.items && Array.isArray(searchResult.items)) {
    items = searchResult.items;
  } else if (searchResult.items && typeof searchResult.items === 'object' && 'items' in searchResult.items) {
    const nestedItems = searchResult.items as { items: MemoryItem[] };
    items = Array.isArray(nestedItems.items) ? nestedItems.items : [];
  } else {
    throw new Error(`Memory with ID ${id} not found`);
  }

  if (items.length === 0) {
    throw new Error(`Memory with ID ${id} not found`);
  }
  const memory = items[0];
  if (!memory || memory.id !== id) {
    throw new Error(`Memory with ID ${id} not found`);
  }
  return memory;
}

/**
 * 기억 업데이트
 */
export async function updateMemory(
  client: MementoClientCore,
  id: string,
  params: UpdateMemoryParams,
): Promise<MemoryItem> {
  client.ensureConnected();

  const existingMemory = await getMemory(client, id);
  const memoryType = params.type || existingMemory.type;

  await forget(client, id);

  const createParams: CreateMemoryParams = {
    type: memoryType,
    tags: params.tags !== undefined ? params.tags : existingMemory.tags,
    importance: params.importance !== undefined ? params.importance : existingMemory.importance,
    source: params.source !== undefined ? params.source : existingMemory.source,
    privacy_scope: params.privacy_scope !== undefined ? params.privacy_scope : existingMemory.privacy_scope,
    project_id: params.project_id !== undefined ? params.project_id : existingMemory.project_id,
    metadata: params.metadata !== undefined ? params.metadata : existingMemory.metadata,
  };

  const existingMemoryExtended = existingMemory as MemoryItem & {
    key?: string;
    value?: string;
    always_load?: boolean;
    immutable?: boolean;
    task_goal?: string;
    steps?: string;
    reflection_notes?: string;
  };

  if (memoryType === 'core') {
    createParams.key = params.key !== undefined ? params.key : existingMemoryExtended.key;
    createParams.value = params.value !== undefined ? params.value : existingMemoryExtended.value;
    createParams.always_load = params.always_load !== undefined ? params.always_load : existingMemoryExtended.always_load;
  } else if (memoryType === 'vault') {
    createParams.key = params.key !== undefined ? params.key : existingMemoryExtended.key;
    createParams.value = params.value !== undefined ? params.value : existingMemoryExtended.value;
    createParams.immutable = params.immutable !== undefined ? params.immutable : existingMemoryExtended.immutable;
  } else {
    createParams.content = params.content !== undefined ? params.content : existingMemory.content;
    if (memoryType === 'procedural') {
      createParams.task_goal = params.task_goal !== undefined ? params.task_goal : existingMemoryExtended.task_goal;
      createParams.steps = params.steps !== undefined ? params.steps : existingMemoryExtended.steps;
      createParams.reflection_notes = params.reflection_notes !== undefined ? params.reflection_notes : existingMemoryExtended.reflection_notes;
    }
  }

  const rememberResult = await remember(client, createParams);

  const memoryItem: MemoryItem = {
    id: rememberResult.memory_id,
    content: createParams.content || '',
    type: createParams.type || 'episodic',
    importance: createParams.importance || 0.5,
    created_at: rememberResult.created_at,
    pinned: false,
    privacy_scope: createParams.privacy_scope || 'private',
    tags: createParams.tags,
    source: createParams.source,
    project_id: createParams.project_id,
    metadata: createParams.metadata,
  };

  client.emit('memory:updated', memoryItem);
  return memoryItem;
}

/**
 * 기억 삭제
 */
export async function forget(
  client: MementoClientCore,
  memoryId: string,
  hard: boolean = false,
): Promise<ForgetResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/forget', {
    id: memoryId,
    hard,
  });

  const result = response.data.result;
  client.emit('memory:deleted', memoryId);
  return result;
}

/**
 * 기억 고정
 */
export async function pin(client: MementoClientCore, memoryId: string): Promise<PinResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/pin', {
    id: memoryId,
  });

  const result = response.data.result;
  client.emit('memory:pinned', memoryId);
  return result;
}

/**
 * 기억 고정 해제
 */
export async function unpin(client: MementoClientCore, memoryId: string): Promise<PinResult> {
  client.ensureConnected();

  const response = await client.httpClient.post('/tools/unpin', {
    id: memoryId,
  });

  const result = response.data.result;
  client.emit('memory:unpinned', memoryId);
  return result;
}
