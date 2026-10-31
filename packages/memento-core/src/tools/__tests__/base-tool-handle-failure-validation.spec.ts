/**
 * BaseTool.handleFailure — ToolInputValidationError must not enqueue Reflexion (#856)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mementoConfig } from '../../shared/config/index.js';
import { BaseTool } from '../base-tool.js';
import { ToolInputValidationError } from '../../shared/errors/tool-input-validation-error.js';
import type { ToolContext, ToolResult } from '../types.js';
import type { FailureDetector } from '../../domains/monitoring/services/failure-detector.js';
import { ErrorType } from '../../domains/monitoring/services/failure-detector.js';
import type { IReflexionWorker } from '../../shared/interfaces/reflexion-worker.interface.js';

class ProbeTool extends BaseTool {
  constructor() {
    super('probe_tool', 'test probe', {});
  }

  async handle(): Promise<ToolResult> {
    return this.createSuccessResult({ ok: true });
  }

  async fail(
    error: Error,
    params: unknown,
    context: ToolContext,
    executionTimeMs?: number
  ): Promise<void> {
    await this.handleFailure(error, params, context, executionTimeMs);
  }
}

describe('BaseTool.handleFailure validation skip (#856)', () => {
  let tool: ProbeTool;
  let detectToolError: ReturnType<typeof vi.fn>;
  let queueFailureEvent: ReturnType<typeof vi.fn>;
  let context: ToolContext;
  const savedObservationOnly = mementoConfig.reflexionObservationOnly;

  afterEach(() => {
    mementoConfig.reflexionObservationOnly = savedObservationOnly;
  });

  beforeEach(() => {
    tool = new ProbeTool();
    detectToolError = vi.fn().mockReturnValue({
      detected: true,
      event: {
        id: 'failure_probe_tool_error_1',
        tool_name: 'probe_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: 'boom',
        error_message_hash: 'hash',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      }
    });
    queueFailureEvent = vi.fn().mockResolvedValue(true);

    const failureDetector = {
      detectToolError
    } as unknown as FailureDetector;

    const reflexionWorker = {
      queueFailureEvent
    } as unknown as IReflexionWorker;

    context = {
      db: {} as ToolContext['db'],
      services: {
        failureDetector,
        reflexionWorker
      }
    };
  });

  it('does not detect or queue when error is ToolInputValidationError (instanceof)', async () => {
    const error = new ToolInputValidationError("❌ remember: 'type' 파라미터는 필수입니다.");
    const params = { content: 'Docker permission denied on unix:///var/run/docker.sock' };

    await tool.fail(error, params, context, 12);

    expect(detectToolError).not.toHaveBeenCalled();
    expect(queueFailureEvent).not.toHaveBeenCalled();
  });

  it('does not detect or queue when error.name is ToolInputValidationError', async () => {
    const error = new Error('invalid params');
    error.name = 'ToolInputValidationError';

    await tool.fail(error, { content: 'x' }, context);

    expect(detectToolError).not.toHaveBeenCalled();
    expect(queueFailureEvent).not.toHaveBeenCalled();
  });

  it('still detects and queues plain Error', async () => {
    const error = new Error('Database connection failed');

    await tool.fail(error, { query: 'SELECT 1' }, context, 50);

    expect(detectToolError).toHaveBeenCalledOnce();
    expect(queueFailureEvent).toHaveBeenCalledOnce();
  });

  it('attaches the token-bound scope instead of failed input attribution (#1547)', async () => {
    mementoConfig.reflexionObservationOnly = true;
    Object.assign(context, {
      boundAgentId: 'bound-owner', agentId: 'self-reported-owner',
      boundProjectId: 'bound-project', projectId: 'self-reported-project',
      processId: 'process-1', sessionId: 'session-1',
    });
    await tool.fail(new Error('database timeout'), { owner_id: 'other-owner', project_id: 'other-project' }, context);
    expect(queueFailureEvent).toHaveBeenCalledWith(expect.objectContaining({ scope: {
      owner_id: 'bound-owner', project_id: 'bound-project', process_id: 'process-1', session_id: 'session-1',
    } }));
  });

  it('does not attach scope when observation-only is off (#1547)', async () => {
    mementoConfig.reflexionObservationOnly = false;
    Object.assign(context, {
      boundAgentId: 'bound-owner', boundProjectId: 'bound-project',
      processId: 'process-1', sessionId: 'session-1',
    });
    await tool.fail(new Error('database timeout'), { owner_id: 'other-owner', project_id: 'other-project' }, context);
    expect(queueFailureEvent).toHaveBeenCalledOnce();
    expect(queueFailureEvent.mock.calls[0][0]).not.toHaveProperty('scope');
  });
});
