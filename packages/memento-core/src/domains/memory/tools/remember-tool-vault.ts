/**
 * Remember Tool — Knowledge Vault 핸들러 (remember-tool.ts에서 분리, #582).
 */

import { createHash } from 'crypto';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';

export interface VaultMemoryParams {
  key: string;
  value: string;
  immutable: boolean | undefined;
  origin_source: string;
  ownerId: string | null;
  startTime: number;
}

export async function handleVaultMemory(
  params: VaultMemoryParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<ToolResult> {
  const { key, value, immutable, origin_source, ownerId, startTime } = params;

  const knowledgeVaultRepository = new KnowledgeVaultRepository(context.db!);
  const knowledgeVaultService = new KnowledgeVaultService(knowledgeVaultRepository);

  const agent_id = 'default';
  const ch = createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0, 16);
  const since24h = new Date(Date.now() - 86_400_000).toISOString();
  const isDuplicate =
    context.services?.telemetryService?.hasPriorWriteWithContentHash(ownerId, ch, since24h) ?? false;

  context.services?.telemetryService?.record({
    eventType: 'memory.write.requested',
    outcome: 'success',
    extraData: { memory_type: 'vault', content_hash: ch }
  });

  const record = await knowledgeVaultService.create({
    agent_id,
    key,
    value,
    immutable: immutable !== false,
    origin_source
  });

  context.services?.telemetryService?.record({
    eventType: 'memory.write.completed',
    outcome: 'success',
    latencyMs: Date.now() - startTime,
    extraData: {
      memory_type: 'vault',
      memory_id: record.vault_id,
      content_hash: ch,
      is_duplicate: isDuplicate
    }
  });

  return host.createSuccessResult({
    memory_id: record.vault_id,
    type: 'vault',
    key: record.key,
    value: record.value,
    immutable: record.immutable,
    message: `Knowledge Vault가 저장되었습니다: ${record.vault_id}`
  });
}
