import type {
  CoreRememberParams,
  CoreRecallParams,
  CoreRecallResult,
} from 'memento-core';
import type { AssistantServerOptions } from './assistant-http-server.js';

interface CoreFacadeClient {
  remember(params: CoreRememberParams): Promise<{ memory_id: string }>;
  recall(params: CoreRecallParams): Promise<CoreRecallResult>;
}

export function createRuntimeCoreBridge(
  coreClient: CoreFacadeClient
): AssistantServerOptions {
  return {
    remember: (payload) => coreClient.remember(payload),
    queryContinuityMemories: async (input) => {
      const result = await coreClient.recall({
        query: input.project,
        filters: { tags: ['continuity'] },
        limit: 50,
        process_id: input.processId,
        session_id: input.sessionId,
      });

      return result.items
        .filter((item) => item.tags?.includes('continuity'))
        .map((item) => ({
          id: item.id,
          content: item.content,
          tags: item.tags,
        }));
    },
  };
}
