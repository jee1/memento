/**
 * Remember Tool — Core Memory 핸들러 (remember-tool.ts에서 분리, #582).
 */

import { createHash } from 'crypto';
import { CoreMemoryService } from '../services/core-memory-service.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';

export interface CoreMemoryParams {
  key: string;
  value: string;
  always_load: boolean | undefined;
  origin_source: string;
  ownerId: string | null;
  startTime: number;
}

export async function handleCoreMemory(
  params: CoreMemoryParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<ToolResult> {
  const { key, value, always_load, origin_source, ownerId, startTime } = params;

  const { createCoreMemoryRepository } = await import('../../../infrastructure/database/factories/core-memory-repository.factory.js');
  const coreMemoryRepository = createCoreMemoryRepository(context.db!);
  const { getCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
  const coreMemoryCache = getCoreMemoryCache();
  const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);

  const agent_id = 'default';
  const ch = createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0, 16);
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const isDuplicate =
    context.services?.telemetryService?.hasPriorWriteWithContentHash(ownerId, ch, since24h) ?? false;

  context.services?.telemetryService?.record({
    eventType: 'memory.write.requested',
    outcome: 'success',
    extraData: { memory_type: 'core', content_hash: ch }
  });

  const record = await coreMemoryService.create({
    agent_id,
    key,
    value,
    always_load: always_load || false,
    origin_source
  });

  context.services?.telemetryService?.record({
    eventType: 'memory.write.completed',
    outcome: 'success',
    latencyMs: Date.now() - startTime,
    extraData: {
      memory_type: 'core',
      memory_id: record.core_id,
      content_hash: ch,
      is_duplicate: isDuplicate
    }
  });

  return host.createSuccessResult({
    memory_id: record.core_id,
    type: 'core',
    key: record.key,
    value: record.value,
    always_load: record.always_load,
    message: `Core Memory가 저장되었습니다: ${record.core_id}`
  });
}
