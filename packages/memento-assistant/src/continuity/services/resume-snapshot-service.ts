import type { ResumeCard, ResumeSnapshot } from '../types.js';

export interface ContinuityMemoryItem {
  id: string;
  content: string;
  tags?: string[];
}

export interface ContinuityQueryInput {
  project: string;
  processId?: string;
  sessionId?: string;
  branch?: string;
}

export interface IContinuityQuery {
  queryContinuityMemories(input: ContinuityQueryInput): Promise<ContinuityMemoryItem[]>;
}

export class ResumeSnapshotService {
  constructor(private readonly query: IContinuityQuery) {}

  async build(input: ContinuityQueryInput): Promise<ResumeSnapshot> {
    const items = await this.query.queryContinuityMemories(input);
    return {
      project: input.project,
      sessionId: input.sessionId,
      resume: this.pick(items, 'task'),
      recentDecisions: this.pick(items, 'decision'),
      openThreads: this.pick(items, 'blocker'),
      nextActions: this.pick(items, 'next-step'),
    };
  }

  private pick(items: ContinuityMemoryItem[], tag: string): ResumeCard[] {
    return items
      .filter((item) => item.tags?.includes(tag))
      .map((item) => ({
        title: `${tag}: ${item.content.slice(0, 40)}${item.content.length > 40 ? '...' : ''}`,
        summary: item.content,
        memoryIds: [item.id],
      }));
  }
}
