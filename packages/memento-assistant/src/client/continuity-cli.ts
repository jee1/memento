#!/usr/bin/env node
import { AssistantClient } from './assistant-client.js';
import type { ResumeSnapshot } from '../continuity/types.js';

const DEFAULT_URL = 'http://localhost:8090';

function parseArgs(argv: string[]): { command: string; options: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? 'resume';
  const options: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i]!.startsWith('--') && args[i + 1] !== undefined) {
      options[args[i]!.slice(2)] = args[i + 1]!;
      i++;
    }
  }
  return { command, options };
}

function printSnapshot(snapshot: ResumeSnapshot): void {
  console.log('\n=== Resume ===');
  for (const c of snapshot.resume) console.log(`- ${c.title}: ${c.summary}`);
  console.log('\n=== Recent Decisions ===');
  for (const c of snapshot.recentDecisions) console.log(`- ${c.title}: ${c.summary}`);
  console.log('\n=== Open Threads ===');
  for (const c of snapshot.openThreads) console.log(`- ${c.title}: ${c.summary}`);
  console.log('\n=== Next Actions ===');
  for (const c of snapshot.nextActions) console.log(`- ${c.title}: ${c.summary}`);
  console.log('');
}

/**
 * Run the continuity CLI with the given argv. Returns the combined stdout (for testing).
 */
export async function runCli(argv: string[]): Promise<string> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
    origLog(...args);
  };

  try {
    const { command, options } = parseArgs(argv);
    const processId = options.process_id ?? options.process;
    const url = process.env.MEMENTO_ASSISTANT_URL ?? DEFAULT_URL;
    const client = new AssistantClient({ assistantServerUrl: url });

    switch (command) {
      case 'start':
        await client.startSession({
          project: options.project ?? 'default',
          session_id: options.session_id ?? `sess-${Date.now()}`,
          process_id: processId,
          branch: options.branch,
        });
        break;
      case 'resume': {
        const result = await client.resumeSession({
          project: options.project ?? 'default',
          process_id: processId,
          session_id: options.session_id,
          branch: options.branch,
        });
        printSnapshot(result.snapshot);
        break;
      }
      case 'save':
        await client.saveContext({
          kind: (options.kind as 'task' | 'decision' | 'blocker' | 'next-step') ?? 'decision',
          content: options.content ?? '',
          project: options.project ?? 'default',
          session_id: options.session_id ?? '',
          process_id: processId,
          branch: options.branch,
        });
        break;
      case 'end':
        await client.endSession({
          project: options.project ?? 'default',
          session_id: options.session_id ?? '',
          process_id: processId,
          branch: options.branch,
          summary: options.summary,
        });
        break;
      default:
        console.log(`Unknown command: ${command}. Use start|resume|save|end`);
    }
    return logs.join('\n');
  } finally {
    console.log = origLog;
  }
}

async function main(): Promise<void> {
  await runCli(process.argv);
}

if (process.argv[1]?.includes('continuity-cli') || process.env.CLI_ENTRY === '1') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
