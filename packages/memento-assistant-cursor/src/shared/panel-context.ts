export interface PanelContext {
  project: string;
  branch?: string;
  session_id?: string;
  process_id?: string;
}

export interface BuildPanelContextInput {
  workspaceName: string;
  branch?: string;
  sessionId?: string;
  processId?: string;
}

export function buildPanelContext(input: BuildPanelContextInput): PanelContext {
  return {
    project: input.workspaceName,
    branch: input.branch,
    session_id: input.sessionId,
    process_id: input.processId ?? 'cursor',
  };
}
