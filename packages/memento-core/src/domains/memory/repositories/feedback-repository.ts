/**
 * @deprecated Use IFeedbackRepository (interface) and FeedbackRepositorySQLite (implementation) instead.
 * This file will be removed in a future version.
 */

import { FeedbackRepositorySQLite } from '../../../infrastructure/database/repositories/feedback-repository-sqlite.impl.js';

/** net_score(정수)를 [0,1]로 시그모이드 정규화 */
export function sigmoidNormalizedNet(net: number): number {
  return 1 / (1 + Math.exp(-net));
}

/** @deprecated Use FeedbackRepositorySQLite instead. */
export class FeedbackRepository extends FeedbackRepositorySQLite {}

export * from './feedback-repository.interface.js';
