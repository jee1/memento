import { randomUUID } from 'node:crypto';
import { stdin as stdinStream } from 'node:process';
import {
  closeDatabase,
  createMementoCore,
  createPersonalAgentLlmPort,
  createToolContext,
  mementoConfig,
  GeminiChatLlmAdapter,
  OpenAiChatLlmAdapter,
  OllamaChatLlmAdapter,
  parsePersonalAgentLlmEnv,
  PersonalAgentLlmError,
  PersonalKnowledgeAgentService,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
} from '@memento/core';
import type {
  ILLMPort,
  PersonalKnowledgePersistItemResult,
  ServerServices,
} from '@memento/core';
import type Database from 'better-sqlite3';
import {
  promptApproveInteractive,
} from './approval.js';
import type { AgentAskRuntimeHooks } from './approval.js';
import { agentAskHelpText } from './help.js';
import {
  debugErr,
  JSON_INTERACTION_INFO,
  jsonFailure,
  writeErr,
  writeOut,
} from './io.js';
import {
  parseAgentAskInvocation,
  resolveDbPath,
} from './parse.js';
import type { PreCliOptions } from './parse.js';

const PROCESS_ID = 'cli/agent-ask';

async function teardownAgentAsk(
  services: ServerServices,
  db: Database.Database,
): Promise<void> {
  if (services.runtimeDiagnosticsSamplerCleanup) {
    try {
      await services.runtimeDiagnosticsSamplerCleanup();
    } catch {
      // Diagnostics teardown must not block CLI exit.
    }
  }
  closeDatabase(db);
}

function createAgentAskLlm(forceLlmMock: boolean): ILLMPort {
  const envForLlm = forceLlmMock
    ? { ...process.env, MEMENTO_PERSONAL_AGENT_LLM_PROVIDER: 'mock' }
    : process.env;
  const llmEnv = parsePersonalAgentLlmEnv(envForLlm, {
    openaiApiKey: mementoConfig.openaiApiKey,
    geminiApiKey: mementoConfig.geminiApiKey,
  });

  return createPersonalAgentLlmPort(llmEnv, {
    createOpenAi: (cfg) => {
      const apiKey = mementoConfig.openaiApiKey?.trim();
      if (!apiKey) {
        throw new PersonalAgentLlmError({
          code: 'provider_misconfigured',
          message:
            'OPENAI_API_KEY is required when MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=openai',
        });
      }
      return new OpenAiChatLlmAdapter({ apiKey, model: cfg.model });
    },
    createGemini: (cfg) => {
      const apiKey = mementoConfig.geminiApiKey?.trim();
      if (!apiKey) {
        throw new PersonalAgentLlmError({
          code: 'provider_misconfigured',
          message:
            'GEMINI_API_KEY is required when MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=gemini',
        });
      }
      return new GeminiChatLlmAdapter({ apiKey, model: cfg.model });
    },
    createOllama: (cfg) =>
      new OllamaChatLlmAdapter({
        baseUrl: cfg.baseUrl,
        model: cfg.model,
      }),
  });
}

export async function runAgentAskMain(
  preOptions: PreCliOptions,
  argv: string[],
  hooks?: AgentAskRuntimeHooks,
): Promise<number> {
  const invocation = parseAgentAskInvocation(argv);
  if (invocation.kind === 'help') {
    await writeErr(agentAskHelpText());
    return 0;
  }
  if (invocation.kind === 'usage') {
    if (argv.includes('--json')) {
      await writeOut(jsonFailure('INVALID_OPTION', 'usage', invocation.message));
    } else {
      await writeErr(invocation.message + '\n');
    }
    return 1;
  }

  const prevCliQuiet = process.env.MEMENTO_CLI_QUIET;
  if (invocation.json) {
    process.env.MEMENTO_CLI_QUIET = '1';
  }

  try {
    return await runAgentAskInvocation(preOptions, argv, invocation, hooks);
  } finally {
    if (invocation.json) {
      if (prevCliQuiet === undefined) {
        delete process.env.MEMENTO_CLI_QUIET;
      } else {
        process.env.MEMENTO_CLI_QUIET = prevCliQuiet;
      }
    }
  }
}

async function runAgentAskInvocation(
  preOptions: PreCliOptions,
  argv: string[],
  invocation: Extract<ReturnType<typeof parseAgentAskInvocation>, { kind: 'run' }>,
  hooks?: AgentAskRuntimeHooks,
): Promise<number> {
  const stdinTty = hooks?.stdinIsTTY ?? Boolean(stdinStream.isTTY);
  const promptFn = hooks?.promptApprove ?? promptApproveInteractive;
  const skipPersist = invocation.noSave || invocation.json;

  if (!stdinTty && !invocation.json && !invocation.noSave) {
    const msg = '비대화형 환경에서는 --json 또는 --no-save 가 필요합니다.';
    if (argv.includes('--json')) {
      await writeOut(jsonFailure('NON_INTERACTIVE', 'usage', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 1;
  }

  const interruptRef = { interrupted: false };
  const onProcessSigInt = (): void => {
    interruptRef.interrupted = true;
  };
  process.on('SIGINT', onProcessSigInt);
  try {
    return await runAgentAskWithInterrupts(
      preOptions,
      invocation,
      { stdinTty, promptFn, skipPersist },
      interruptRef,
    );
  } finally {
    process.removeListener('SIGINT', onProcessSigInt);
  }
}

type RunInteraction = {
  stdinTty: boolean;
  promptFn: NonNullable<AgentAskRuntimeHooks['promptApprove']>;
  skipPersist: boolean;
};

async function runAgentAskWithInterrupts(
  preOptions: PreCliOptions,
  invocation: Extract<ReturnType<typeof parseAgentAskInvocation>, { kind: 'run' }>,
  interaction: RunInteraction,
  interruptRef: { interrupted: boolean },
): Promise<number> {
  const sessionId = randomUUID();
  let dbPath: string;
  try {
    dbPath = resolveDbPath(preOptions);
  } catch (e) {
    return writeUsageFailure(invocation.json, e);
  }

  let core: Awaited<ReturnType<typeof createMementoCore>> | undefined;
  try {
    core = await createMementoCore({ dbPath });
  } catch (e) {
    debugErr(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (invocation.json) {
      await writeOut(jsonFailure('BOOTSTRAP_FAILED', 'bootstrap', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 2;
  }

  const { db, services } = core;
  try {
    return await runAgentAskWithCore(
      invocation,
      interaction,
      interruptRef,
      sessionId,
      db,
      services,
    );
  } finally {
    await teardownAgentAsk(services, db);
  }
}

async function writeUsageFailure(json: boolean, error: unknown): Promise<number> {
  const msg = error instanceof Error ? error.message : String(error);
  if (json) {
    await writeOut(jsonFailure('INVALID_OPTION', 'usage', msg));
  } else {
    await writeErr(msg + '\n');
  }
  return 1;
}

async function runAgentAskWithCore(
  invocation: Extract<ReturnType<typeof parseAgentAskInvocation>, { kind: 'run' }>,
  interaction: RunInteraction,
  interruptRef: { interrupted: boolean },
  sessionId: string,
  db: Database.Database,
  services: ServerServices,
): Promise<number> {
  const toolContext = createToolContext(db, services);
  let llm: ILLMPort;
  try {
    llm = createAgentAskLlm(invocation.forceLlmMock);
  } catch (e) {
    return writeLlmBootstrapFailure(invocation.json, e);
  }

  const context = new ToolContextKnowledgeContextAdapter(toolContext);
  const persistence = new ToolContextRememberPersistenceAdapter(toolContext);
  const service = new PersonalKnowledgeAgentService({ llm, context, persistence });

  let runResult: Awaited<ReturnType<PersonalKnowledgeAgentService['runOneTurn']>>;
  try {
    runResult = await service.runOneTurn({
      userMessage: invocation.userMessage,
      projectId: invocation.projectId,
      tokenBudget: invocation.tokenBudget,
      sessionId,
      ownerId: undefined,
    });
  } catch (e) {
    debugErr(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (invocation.json) {
      await writeOut(jsonFailure('AGENT_RUN_FAILED', 'run', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 3;
  }

  if (interruptRef.interrupted) {
    await writeErr('중단되어 저장하지 않습니다.\n');
    return 130;
  }

  const persistenceBlock = await collectPersistenceBlock(
    invocation,
    interaction,
    interruptRef,
    service,
    runResult,
    sessionId,
  );
  if (persistenceBlock.kind === 'exit') {
    return persistenceBlock.code;
  }

  return writeAgentAskSuccess(invocation, sessionId, runResult, persistenceBlock.value);
}

async function writeLlmBootstrapFailure(json: boolean, error: unknown): Promise<number> {
  debugErr(error);
  if (error instanceof PersonalAgentLlmError) {
    if (json) {
      await writeOut(jsonFailure('PROVIDER_MISCONFIGURED', 'usage', error.message));
    } else {
      await writeErr(error.message + '\n');
    }
    return 2;
  }

  const msg = error instanceof Error ? error.message : String(error);
  if (json) {
    await writeOut(jsonFailure('BOOTSTRAP_FAILED', 'bootstrap', msg));
  } else {
    await writeErr(msg + '\n');
  }
  return 2;
}

type PersistenceBlock = {
  attempted: boolean;
  items: PersonalKnowledgePersistItemResult[];
  persistedCount: number;
  errorCount: number;
};

async function collectPersistenceBlock(
  invocation: Extract<ReturnType<typeof parseAgentAskInvocation>, { kind: 'run' }>,
  interaction: RunInteraction,
  interruptRef: { interrupted: boolean },
  service: PersonalKnowledgeAgentService,
  runResult: Awaited<ReturnType<PersonalKnowledgeAgentService['runOneTurn']>>,
  sessionId: string,
): Promise<{ kind: 'value'; value: PersistenceBlock } | { kind: 'exit'; code: number }> {
  const emptyBlock: PersistenceBlock = {
    attempted: false,
    items: [],
    persistedCount: 0,
    errorCount: 0,
  };

  if (interaction.skipPersist || !interaction.stdinTty || runResult.candidates.length === 0) {
    return { kind: 'value', value: emptyBlock };
  }

  const approved: string[] = [];
  for (let i = 0; i < runResult.candidates.length; i++) {
    if (interruptRef.interrupted) {
      await writeErr('중단되어 저장하지 않습니다.\n');
      return { kind: 'exit', code: 130 };
    }
    const c = runResult.candidates[i];
    if (c === undefined) continue;
    const ans = await interaction.promptFn(c, i, runResult.candidates.length, interruptRef);
    if (ans === 'interrupt') {
      await writeErr('중단되어 저장하지 않습니다.\n');
      return { kind: 'exit', code: 130 };
    }
    if (ans === 'y') {
      approved.push(c.id);
    } else if (ans === 's' || ans === 'q') {
      break;
    }
  }

  if (approved.length === 0) {
    return { kind: 'value', value: emptyBlock };
  }

  try {
    const pr = await service.persistApprovedCandidates({
      candidates: runResult.candidates,
      approvedCandidateIds: approved,
      projectId: invocation.projectId,
      sessionId,
      processId: PROCESS_ID,
    });
    return {
      kind: 'value',
      value: {
        attempted: true,
        items: pr.items,
        persistedCount: pr.persistedCount,
        errorCount: pr.errorCount,
      },
    };
  } catch (e) {
    debugErr(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (invocation.json) {
      await writeOut(
        jsonFailure('PERSIST_FAILED', 'persist', msg, {
          partial: emptyBlock,
        }),
      );
    } else {
      await writeErr(msg + '\n');
    }
    return { kind: 'exit', code: 4 };
  }
}

async function writeAgentAskSuccess(
  invocation: Extract<ReturnType<typeof parseAgentAskInvocation>, { kind: 'run' }>,
  sessionId: string,
  runResult: Awaited<ReturnType<PersonalKnowledgeAgentService['runOneTurn']>>,
  persistenceBlock: PersistenceBlock,
): Promise<number> {
  const successObj = {
    ok: true as const,
    sessionId,
    input: {
      userMessage: invocation.userMessage,
      projectId: invocation.projectId,
      tokenBudget: invocation.tokenBudget,
    },
    knowledgeContext: {
      itemCount: runResult.knowledgeContext.itemCount,
      tokenEstimate: runResult.knowledgeContext.tokenEstimate,
      summary: runResult.knowledgeContext.summary,
    },
    llm: {
      response: runResult.llmResponse,
      metadata: runResult.llmMetadata ?? null,
    },
    candidates: runResult.candidates,
    persistence: persistenceBlock,
  };

  if (invocation.json) {
    await writeOut(JSON.stringify(successObj) + '\n');
    if (invocation.jsonImplicitNoSave) {
      await writeErr(JSON_INTERACTION_INFO);
    }
  } else {
    await writeErr(
      `LLM: ${runResult.llmResponse}\n` +
        `컨텍스트: ${runResult.knowledgeContext.summary}\n` +
        `후보 ${runResult.candidates.length}건\n`,
    );
    if (invocation.noSave || invocation.json) {
      await writeErr('(저장 생략: --json 또는 --no-save)\n');
    }
    await writeOut(JSON.stringify(successObj) + '\n');
  }

  if (persistenceBlock.attempted && persistenceBlock.errorCount > 0) {
    return 4;
  }
  return 0;
}
