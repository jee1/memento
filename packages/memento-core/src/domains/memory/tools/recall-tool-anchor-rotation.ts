/**
 * Recall auto-set anchor rotation (recall-tool-envelope.ts에서 분리, #507).
 */

import type { ToolContext } from '../../../tools/types.js';
import type { RecallToolHost } from './recall-tool-host.js';
import type { AnchorSetMetadata, RecallSearchItem } from './recall-tool-types.js';

/**
 * 자동 앵커 설정 처리
 */
export async function handleAutoSetAnchor(
  host: RecallToolHost,
  searchItems: RecallSearchItem[],
  agentId: string,
  context: ToolContext
): Promise<{
  success: boolean;
  anchor_set: AnchorSetMetadata | null;
  error?: boolean;
  skipped?: boolean;
  skipped_reason?: string;
}> {
  if (!searchItems || searchItems.length === 0) {
    return {
      success: false,
      anchor_set: null
    };
  }

  const topMemory = searchItems[0]!;
  const memoryId = topMemory.id ?? topMemory.memory_id;

  if (!memoryId) {
    host.logWarning('검색 결과에 memory_id가 없어 앵커 설정을 건너뜁니다', { topMemory });
    return {
      success: false,
      anchor_set: null,
      error: true
    };
  }

  if (!context.services.anchorManager) {
    host.logWarning('AnchorManager 서비스가 없어 앵커 설정을 건너뜁니다');
    return {
      success: false,
      anchor_set: null,
      error: true
    };
  }

  try {
    const slotAAnchor = await context.services.anchorManager.getAnchor(agentId, 'A');

    if (slotAAnchor && typeof slotAAnchor === 'object' && 'memory_id' in slotAAnchor) {
      const anchorMemory = context.db!.prepare(`
          SELECT pinned FROM memory_item WHERE id = ?
        `).get(slotAAnchor.memory_id) as { pinned: number | boolean } | undefined;

      const isPinned = anchorMemory && (anchorMemory.pinned === 1 || anchorMemory.pinned === true);

      if (isPinned) {
        host.logInfo('슬롯 A에 pinned 앵커가 있어 앵커 설정을 건너뜁니다', {
          agent_id: agentId,
          existing_memory_id: slotAAnchor.memory_id
        });
        return {
          success: false,
          anchor_set: null,
          skipped: true,
          skipped_reason: 'pinned_anchor_protected'
        };
      }

      const slotBAnchor = await context.services.anchorManager.getAnchor(agentId, 'B');

      if (slotBAnchor && typeof slotBAnchor === 'object' && 'memory_id' in slotBAnchor) {
        const slotBMemory = context.db!.prepare(`
            SELECT pinned FROM memory_item WHERE id = ?
          `).get(slotBAnchor.memory_id) as { pinned: number | boolean } | undefined;

        const slotBIsPinned = slotBMemory && (slotBMemory.pinned === 1 || slotBMemory.pinned === true);

        if (slotBIsPinned) {
          host.logWarning('슬롯 B의 pinned 앵커가 덮어써집니다', {
            agent_id: agentId,
            old_memory_id: slotBAnchor.memory_id,
            new_memory_id: slotAAnchor.memory_id
          });
        }

        const slotCAnchor = await context.services.anchorManager.getAnchor(agentId, 'C');

        if (slotCAnchor && typeof slotCAnchor === 'object' && 'memory_id' in slotCAnchor) {
          const slotCMemory = context.db!.prepare(`
              SELECT pinned FROM memory_item WHERE id = ?
            `).get(slotCAnchor.memory_id) as { pinned: number | boolean } | undefined;

          const slotCIsPinned = slotCMemory && (slotCMemory.pinned === 1 || slotCMemory.pinned === true);

          if (slotCIsPinned) {
            host.logWarning('슬롯 C의 pinned 앵커가 제거됩니다', {
              agent_id: agentId,
              old_memory_id: slotCAnchor.memory_id
            });
          }

          await context.services.anchorManager.clearAnchor(agentId, 'C');
        }

        const slotBMemoryId = slotBAnchor.memory_id;
        if (slotBMemoryId) {
          await context.services.anchorManager.clearAnchor(agentId, 'B');
          await context.services.anchorManager.setAnchor(agentId, slotBMemoryId, 'C');
        }
      }

      const slotAMemoryId = slotAAnchor.memory_id;
      if (slotAMemoryId) {
        await context.services.anchorManager.clearAnchor(agentId, 'A');
        await context.services.anchorManager.setAnchor(agentId, slotAMemoryId, 'B');
      }
    }

    await context.services.anchorManager.setAnchor(agentId, memoryId, 'A');

    host.logInfo('앵커가 자동으로 설정되었습니다', {
      agent_id: agentId,
      memory_id: memoryId,
      slot: 'A'
    });

    return {
      success: true,
      anchor_set: {
        memory_id: memoryId,
        slot: 'A',
        agent_id: agentId
      }
    };
  } catch (error) {
    host.logError(error as Error, '앵커 자동 설정 실패', {
      agent_id: agentId,
      memory_id: memoryId
    });

    return {
      success: false,
      anchor_set: null,
      error: true
    };
  }
}
