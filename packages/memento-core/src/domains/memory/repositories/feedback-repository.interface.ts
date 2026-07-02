import type { CreateFeedbackEventInput, FeedbackNetScore } from '../../../shared/types/feedback.types.js';

export interface IFeedbackRepository {
  insertFeedback(input: CreateFeedbackEventInput): { id: number; created_at: string };
  getNetScores(memoryIds: string[], windowDays?: number): Map<string, number>;
  getNetScoreRows(memoryIds: string[], windowDays?: number): FeedbackNetScore[];
}

export function sigmoidNormalizedNet(net: number): number {
  return 1 / (1 + Math.exp(-net));
}
