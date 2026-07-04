import { createInterface } from 'node:readline/promises';
import { stdin as stdinStream, stderr as stderrStream } from 'node:process';
import type { KnowledgeCandidate } from '@memento/core';

export type AgentAskApproveAnswer = 'y' | 'n' | 's' | 'q' | 'interrupt';

export async function promptApproveInteractive(
  candidate: KnowledgeCandidate,
  index: number,
  total: number,
  interruptRef: { interrupted: boolean },
): Promise<AgentAskApproveAnswer> {
  const rl = createInterface({ input: stdinStream, output: stderrStream });
  const onRlSigInt = (): void => {
    interruptRef.interrupted = true;
    rl.close();
  };
  rl.on('SIGINT', onRlSigInt);
  try {
    const header =
      `\n[${index + 1}/${total}] (${candidate.category}, importance=${candidate.importance})\n` +
      `  ${candidate.content}\n` +
      `  reason: ${candidate.reason}\n` +
      `  suggested type: ${candidate.suggestedMemoryType}, tags: ${JSON.stringify(candidate.tags)}\n` +
      `  Save? (y)es / (n)o / (s)kip rest / (q)uit & save approved > `;
    let line: string;
    try {
      line = await rl.question(header);
    } catch {
      if (interruptRef.interrupted) return 'interrupt';
      return 'n';
    }
    const t = String(line).trim().toLowerCase();
    if (t === '' || t === 'n') return 'n';
    if (t === 'y' || t === 'yes') return 'y';
    if (t === 's' || t === 'skip') return 's';
    if (t === 'q' || t === 'quit') return 'q';
    return 'n';
  } finally {
    rl.removeListener('SIGINT', onRlSigInt);
    rl.close();
  }
}

export type AgentAskPromptApprove = (
  candidate: KnowledgeCandidate,
  index: number,
  total: number,
  interruptRef: { interrupted: boolean },
) => Promise<AgentAskApproveAnswer>;

export interface AgentAskRuntimeHooks {
  stdinIsTTY?: boolean;
  promptApprove?: AgentAskPromptApprove;
}

