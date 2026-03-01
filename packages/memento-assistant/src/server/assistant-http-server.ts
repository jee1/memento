import express from 'express';
import type { Express } from 'express';
import { AssistantToolRegistry } from '../continuity/tool-registry.js';
import type { AssistantToolContext } from '../continuity/tools/types.js';
import type { CheckpointPayload } from '../continuity/services/session-checkpoint-service.js';
import { SessionCheckpointService } from '../continuity/services/session-checkpoint-service.js';
import { ResumeSnapshotService } from '../continuity/services/resume-snapshot-service.js';
import type { ContinuityQueryInput, ContinuityMemoryItem } from '../continuity/services/resume-snapshot-service.js';
import { StartSessionTool } from '../continuity/tools/start-session-tool.js';
import { SaveContextTool } from '../continuity/tools/save-context-tool.js';
import { EndSessionTool } from '../continuity/tools/end-session-tool.js';
import { ResumeSessionTool } from '../continuity/tools/resume-session-tool.js';

export interface AssistantServerOptions {
  /** Called to persist checkpoint (e.g. call core remember API). Required for start/save/end tools. */
  remember?: (payload: CheckpointPayload) => Promise<{ memory_id: string }>;
  /** Query continuity memories for resume. Required for resume_session. */
  queryContinuityMemories?: (input: ContinuityQueryInput) => Promise<ContinuityMemoryItem[]>;
}

const checkpoint = new SessionCheckpointService();

function createRegistry(options: AssistantServerOptions): AssistantToolRegistry {
  const registry = new AssistantToolRegistry();
  const resumeService = new ResumeSnapshotService({
    queryContinuityMemories: options.queryContinuityMemories ?? (async () => []),
  });

  registry.registerAll([
    new StartSessionTool(checkpoint).getDefinition(),
    new SaveContextTool(checkpoint).getDefinition(),
    new EndSessionTool(checkpoint).getDefinition(),
    new ResumeSessionTool(resumeService).getDefinition(),
  ]);
  return registry;
}

export function createAssistantApp(options: AssistantServerOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const registry = createRegistry(options);
  const context: AssistantToolContext = { remember: options.remember };

  app.post('/assistant/tools/:name', async (req: express.Request, res: express.Response) => {
    const name = req.params.name;
    const params = req.body ?? {};
    try {
      const result = await registry.execute(name, params, context);
      res.json({ result: JSON.parse(result.content[0].text) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  return app;
}
