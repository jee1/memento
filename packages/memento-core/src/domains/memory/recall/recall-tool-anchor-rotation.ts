/**
 * Recall auto-set anchor rotation (recall-tool-envelope.ts에서 분리, #507).
 */

import type Database from 'better-sqlite3';
import type { ToolContext } from '../../../tools/types.js';
import type { RecallToolHost } from './recall-tool-host.js';
import type { AnchorSetMetadata, RecallSearchItem } from './recall-tool-types.js';

export interface AnchorSetResult {
  success: boolean;
  anchor_set: AnchorSetMetadata | null;
  error?: boolean;
  skipped?: boolean;
  skipped_reason?: string;
}

type AnchorManager = NonNullable<ToolContext['services']['anchorManager']>;
type AnchorLookup = Awaited<ReturnType<AnchorManager['getAnchor']>>;
type AnchorInfo = Exclude<AnchorLookup, unknown[] | null>;

const SELECT_PINNED_SQL = `
  SELECT pinned FROM memory_item WHERE id = ?
`;

function anchorSetSuccess(memoryId: string, agentId: string): AnchorSetResult {
  return {
    success: true,
    anchor_set: {
      memory_id: memoryId,
      slot: 'A',
      agent_id: agentId
    }
  };
}

function anchorSetError(): AnchorSetResult {
  return {
    success: false,
    anchor_set: null,
    error: true
  };
}

/** getAnchor(slot) 결과가 단일 앵커 객체일 때만 돌려준다. */
function asSingleAnchor(anchor: AnchorLookup): AnchorInfo | null {
  return anchor && typeof anchor === 'object' && 'memory_id' in anchor ? anchor : null;
}

function isPinnedMemory(db: Database.Database, memoryId: string | null): boolean {
  const row = db.prepare(SELECT_PINNED_SQL).get(memoryId) as { pinned: number | boolean } | undefined;
  return row !== undefined && (row.pinned === 1 || row.pinned === true);
}

/**
 * 검색 1위가 이미 앵커 슬롯에 있으면 중복 setAnchor 오류 없이 처리한다.
 * 슬롯 A 면 true(회전 불필요), B·C 면 그 슬롯을 비우고 false.
 */
async function releaseExistingSlot(
  host: RecallToolHost,
  anchorManager: AnchorManager,
  agentId: string,
  memoryId: string
): Promise<boolean> {
  for (const slot of ['A', 'B', 'C'] as const) {
    const anchor = asSingleAnchor(await anchorManager.getAnchor(agentId, slot));
    if (anchor?.memory_id !== memoryId) continue;
    if (slot === 'A') {
      host.logInfo('검색 1위가 이미 슬롯 A 앵커이므로 회전을 건너뜁니다', {
        agent_id: agentId,
        memory_id: memoryId
      });
      return true;
    }
    await anchorManager.clearAnchor(agentId, slot);
    return false;
  }
  return false;
}

/** 슬롯 C 를 비우고 B 를 C 로 민다. */
async function shiftSlotBToC(
  host: RecallToolHost,
  db: Database.Database,
  anchorManager: AnchorManager,
  agentId: string,
  slotAMemoryId: string | null
): Promise<void> {
  const slotBAnchor = asSingleAnchor(await anchorManager.getAnchor(agentId, 'B'));
  if (!slotBAnchor) return;

  if (isPinnedMemory(db, slotBAnchor.memory_id)) {
    host.logWarning('슬롯 B의 pinned 앵커가 덮어써집니다', {
      agent_id: agentId,
      old_memory_id: slotBAnchor.memory_id,
      new_memory_id: slotAMemoryId
    });
  }

  const slotCAnchor = asSingleAnchor(await anchorManager.getAnchor(agentId, 'C'));
  if (slotCAnchor) {
    if (isPinnedMemory(db, slotCAnchor.memory_id)) {
      host.logWarning('슬롯 C의 pinned 앵커가 제거됩니다', {
        agent_id: agentId,
        old_memory_id: slotCAnchor.memory_id
      });
    }
    await anchorManager.clearAnchor(agentId, 'C');
  }

  const slotBMemoryId = slotBAnchor.memory_id;
  if (slotBMemoryId) {
    await anchorManager.clearAnchor(agentId, 'B');
    await anchorManager.setAnchor(agentId, slotBMemoryId, 'C');
  }
}

/** A→B→C 로 한 칸씩 민다. 슬롯 A 가 pinned 면 아무것도 하지 않고 false. */
async function rotateSlotsDown(
  host: RecallToolHost,
  context: ToolContext,
  anchorManager: AnchorManager,
  agentId: string
): Promise<boolean> {
  const slotAAnchor = asSingleAnchor(await anchorManager.getAnchor(agentId, 'A'));
  if (!slotAAnchor) return true;

  const db = context.db!;
  if (isPinnedMemory(db, slotAAnchor.memory_id)) {
    host.logInfo('슬롯 A에 pinned 앵커가 있어 앵커 설정을 건너뜁니다', {
      agent_id: agentId,
      existing_memory_id: slotAAnchor.memory_id
    });
    return false;
  }

  await shiftSlotBToC(host, db, anchorManager, agentId, slotAAnchor.memory_id);

  const slotAMemoryId = slotAAnchor.memory_id;
  if (slotAMemoryId) {
    await anchorManager.clearAnchor(agentId, 'A');
    await anchorManager.setAnchor(agentId, slotAMemoryId, 'B');
  }
  return true;
}

/**
 * 자동 앵커 설정 처리
 */
export async function handleAutoSetAnchor(
  host: RecallToolHost,
  searchItems: RecallSearchItem[],
  agentId: string,
  context: ToolContext
): Promise<AnchorSetResult> {
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
    return anchorSetError();
  }

  const anchorManager = context.services.anchorManager;
  if (!anchorManager) {
    host.logWarning('AnchorManager 서비스가 없어 앵커 설정을 건너뜁니다');
    return anchorSetError();
  }

  try {
    if (await releaseExistingSlot(host, anchorManager, agentId, memoryId)) {
      return anchorSetSuccess(memoryId, agentId);
    }

    if (!(await rotateSlotsDown(host, context, anchorManager, agentId))) {
      return {
        success: false,
        anchor_set: null,
        skipped: true,
        skipped_reason: 'pinned_anchor_protected'
      };
    }

    await anchorManager.setAnchor(agentId, memoryId, 'A');

    host.logInfo('앵커가 자동으로 설정되었습니다', {
      agent_id: agentId,
      memory_id: memoryId,
      slot: 'A'
    });

    return anchorSetSuccess(memoryId, agentId);
  } catch (error) {
    host.logError(error as Error, '앵커 자동 설정 실패', {
      agent_id: agentId,
      memory_id: memoryId
    });

    return anchorSetError();
  }
}
