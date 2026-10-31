import type { SystemOneFailureReason, SystemOneResult } from '../typesafe/system-one-client.js';
import { recordLlmUsageAttempt } from './llm-usage-recorder.js';
import type { LlmAttemptOutcome } from './llm-usage-types.js';

function outcomeFromSystemOneFailure(reason: SystemOneFailureReason): LlmAttemptOutcome {
  if (reason === 'timeout') {
    return 'timeout';
  }
  return 'failure';
}

/** TypeSafe System One 호출 1회분 attempt (#1546). */
export function recordSystemOneUsageAttempt(model: string, result: SystemOneResult): void {
  const attemptCoverage = result.wafRetried ? 'partial' : 'full';
  if (result.ok === true) {
    recordLlmUsageAttempt({
      provider: 'typesafe',
      model,
      outcome: 'success',
      attemptCoverage,
      inputTokens: 'unknown',
      outputTokens: 'unknown',
    });
    return;
  }
  recordLlmUsageAttempt({
    provider: 'typesafe',
    model,
    outcome: outcomeFromSystemOneFailure(result.reason),
    failureReason: result.reason,
    attemptCoverage,
    inputTokens: 'unknown',
    outputTokens: 'unknown',
  });
}
