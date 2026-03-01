import { buildContinuityTags, buildOriginSource } from './continuity-metadata.js';

export interface CheckpointPayloadInput {
  kind: 'task' | 'decision' | 'blocker' | 'next-step';
  content: string;
  project: string;
  sessionId: string;
  processId?: string;
  branch?: string;
}

/** Payload compatible with core remember tool (process_id, session_id, origin_source). */
export interface CheckpointPayload {
  content: string;
  type: 'working' | 'episodic';
  tags: string[];
  process_id?: string;
  session_id?: string;
  origin_source?: string;
}

export class SessionCheckpointService {
  buildCheckpointPayload(input: CheckpointPayloadInput): CheckpointPayload {
    return {
      content: input.content,
      type: input.kind === 'task' ? 'working' : 'episodic',
      tags: buildContinuityTags([input.kind], ['continuity']),
      process_id: input.processId,
      session_id: input.sessionId,
      origin_source: buildOriginSource({
        project: input.project,
        branch: input.branch,
        session_id: input.sessionId,
      }),
    };
  }
}
