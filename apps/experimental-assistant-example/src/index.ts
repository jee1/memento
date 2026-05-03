/* eslint-disable no-console, no-constant-condition */
import { MementoAssistant } from '@memento/assistant';
import * as readline from 'node:readline/promises';

async function main() {
  const memory = MementoAssistant.fromEnv(
    { ownerId: process.env.USER ?? 'demo', channel: 'cli' },
    process.env,
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const conversationId = `cli-${Date.now()}`;
  console.log('echo bot — type "exit" to quit');
  while (true) {
    const userMessage = await rl.question('you> ');
    if (userMessage === 'exit') break;
    const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
    if (ctx.systemContext) console.log(`[memento]\n${ctx.systemContext}\n[/memento]`);
    const assistantReply = `echo: ${userMessage}`;
    console.log(`bot> ${assistantReply}`);
    await memory.afterAssistantTurn({ userMessage, assistantReply, conversationId });
  }
  await memory.close();
  rl.close();
}
main().catch(e => { console.error(e); process.exit(1); });
