import type Database from 'better-sqlite3';
import { isMemoryItemType, type MemoryType } from '../../../shared/types/index.js';
import type { ToolContext } from '../../../tools/types.js';
import {
  buildKnowledgeContextBundle,
  type KnowledgeContextBundle,
} from '../../memory/services/knowledge-context-bundle-builder.js';
import type { IContextPort, KnowledgeContextRequest } from '../ports/context-port.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';

function normalizeMemoryTypesForSearch(types?: MemoryType[]): MemoryType[] | undefined {
  if (!types || types.length === 0) {
    return undefined;
  }
  const valid = types.filter(isMemoryItemType);
  if (valid.length === 0) {
    throw new Error("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다.");
  }
  return valid;
}

/**
 * MCP `ToolContext`와 동일한 서비스 묶음으로 개인 지식용 컨텍스트 번들을 구성합니다.
 */
export class ToolContextKnowledgeContextAdapter implements IContextPort {
  constructor(private readonly toolContext: ToolContext) {}

  async buildContext(request: KnowledgeContextRequest): Promise<KnowledgeContextBundle> {
    if (!this.toolContext.db) {
      throw new Error('데이터베이스가 연결되지 않았습니다');
    }
    if (!this.toolContext.services?.hybridSearchEngine) {
      throw new Error('하이브리드 검색 엔진이 사용할 수 없습니다');
    }

    return buildKnowledgeContextBundle(
      {
        db: this.toolContext.db as Database.Database,
        hybridSearchEngine: this.toolContext.services.hybridSearchEngine,
        consolidationScoreService: this.toolContext.services.consolidationScoreService,
        writeCoalescingManager: this.toolContext.services.writeCoalescingManager,
      },
      {
        query: request.userMessage,
        tokenBudget: request.tokenBudget,
        maxMemories: request.maxMemories,
        memoryTypes: normalizeMemoryTypesForSearch(request.memoryTypes),
        projectId: request.projectId,
        ownerId: request.ownerId,
      },
    );
  }

  async proposeCandidates(_candidates: KnowledgeCandidate[]): Promise<void> {
    // Issue #234에서 후보 제안 구현
  }
}
