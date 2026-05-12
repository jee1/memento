import type Database from 'better-sqlite3';
import type { ToolContext } from '../../../tools/types.js';
import {
  buildKnowledgeContextBundle,
  type KnowledgeContextBundle,
} from '../../memory/services/knowledge-context-bundle-builder.js';
import { normalizeMemoryTypesForHybridItemSearch } from '../../memory/utils/normalize-memory-types-for-item-search.js';
import type { IContextPort, KnowledgeContextRequest } from '../ports/context-port.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';

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
        memoryTypes: normalizeMemoryTypesForHybridItemSearch(request.memoryTypes ?? undefined),
        projectId: request.projectId,
        ownerId: request.ownerId,
      },
    );
  }

  async proposeCandidates(_candidates: KnowledgeCandidate[]): Promise<void> {
    // Issue #234에서 후보 제안 구현
  }
}
