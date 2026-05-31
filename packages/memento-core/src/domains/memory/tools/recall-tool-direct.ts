/**
 * Core/Vault 직접 조회 (recall-tool.ts에서 분리, #445).
 */

import { mementoConfig } from '../../../shared/config/index.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import type { RecallToolHost } from './recall-tool-host.js';
import type { RecallParams } from './recall-tool-schema.js';

export async function recallCoreMemoryDirect(
  host: RecallToolHost,
  agentId: string,
  key: string | undefined,
  query: string | undefined,
  memory_types: RecallParams['memory_types'],
  searchStartTime: number,
  startTime: number,
  context: ToolContext
): Promise<ToolResult> {
  if (query) {
    host.logWarning('type="core"일 때 query 파라미터는 무시됩니다', { query });
  }
  if (memory_types && memory_types.length > 0) {
    host.logWarning('type="core"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
  }

  const { createCoreMemoryRepository } = await import('../../../infrastructure/database/factories/core-memory-repository.factory.js');
  const coreMemoryRepository = createCoreMemoryRepository(context.db!);
  const { getCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
  const coreMemoryCache = getCoreMemoryCache();
  const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);

  let records;
  if (key) {
    const record = await coreMemoryService.findByKey(agentId, key);
    records = record ? [record] : [];
  } else {
    records = await coreMemoryService.findByAgentId(agentId);
  }

  const executionTime = Date.now() - searchStartTime;
  const processedResults = records.map(record => ({
    memory_id: record.core_id,
    type: 'core',
    key: record.key,
    value: record.value,
    always_load: record.always_load,
    origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
    created_at: record.created_at,
    updated_at: record.updated_at
  }));

  if (mementoConfig.recallProfileEnabled) {
    host.logInfo('recall_profile', { total_ms: Date.now() - startTime });
  }
  return host.createSuccessResult({
    items: processedResults,
    total_count: processedResults.length,
    query_time: executionTime,
    search_type: 'direct'
  });
}

export async function recallVaultMemoryDirect(
  host: RecallToolHost,
  agentId: string,
  key: string | undefined,
  query: string | undefined,
  memory_types: RecallParams['memory_types'],
  searchStartTime: number,
  startTime: number,
  context: ToolContext
): Promise<ToolResult> {
  if (query) {
    host.logWarning('type="vault"일 때 query 파라미터는 무시됩니다', { query });
  }
  if (memory_types && memory_types.length > 0) {
    host.logWarning('type="vault"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
  }

  const knowledgeVaultRepository = new KnowledgeVaultRepository(context.db!);
  const knowledgeVaultService = new KnowledgeVaultService(knowledgeVaultRepository);

  let records;
  if (key) {
    const record = await knowledgeVaultService.findActiveByKey(agentId, key);
    records = record ? [record] : [];
  } else {
    records = await knowledgeVaultService.findActiveByAgentId(agentId);
  }

  const executionTime = Date.now() - searchStartTime;
  const processedResults = records.map(record => ({
    memory_id: record.vault_id,
    type: 'vault',
    key: record.key,
    value: record.value,
    immutable: record.immutable,
    version: record.version,
    origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
    created_at: record.created_at,
    updated_at: record.updated_at
  }));

  if (mementoConfig.recallProfileEnabled) {
    host.logInfo('recall_profile', { total_ms: Date.now() - startTime });
  }
  return host.createSuccessResult({
    items: processedResults,
    total_count: processedResults.length,
    query_time: executionTime,
    search_type: 'direct'
  });
}
