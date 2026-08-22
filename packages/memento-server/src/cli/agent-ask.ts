/**
 * `memento agent ask` — in-process 개인 지식 Agent 한 턴 (#236).
 * 설계 기록은 archive/pre-issue-801-cleanup 브랜치에 보존됩니다.
 * 테스트 훅: `AgentAskRuntimeHooks` (#237, Vitest에서 stdin/승인 주입).
 */

export {
  parseAgentAskInvocation,
  resolveDbPath,
  stripGlobalCliArgs,
  validateAgentAskFlagArgv,
  validateAgentAskRawTypes,
} from './agent-ask/parse.js';
export type { ParsedAgentAsk, PreCliOptions } from './agent-ask/parse.js';

export {
  promptApproveInteractive,
} from './agent-ask/approval.js';
export type {
  AgentAskApproveAnswer,
  AgentAskPromptApprove,
  AgentAskRuntimeHooks,
} from './agent-ask/approval.js';

export { agentAskHelpText } from './agent-ask/help.js';
export { runAgentAskMain } from './agent-ask/runtime.js';
