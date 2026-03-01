import type {
  EndSessionParams,
  ResumeSessionResult,
  SaveContextParams,
  StartSessionParams,
} from 'memento-assistant';

import type { AssistantPanelClient } from '../services/assistant-panel-client.js';
import type { PanelContext } from '../shared/panel-context.js';
import { toResumeSnapshotViewModel } from '../shared/resume-snapshot-view-model.js';
import {
  renderResumePanelHtml,
  type ResumePanelRenderState,
} from './webview-template.js';

export interface ResumePanelProviderOptions {
  client: Pick<AssistantPanelClient, 'resume' | 'start' | 'save' | 'end'>;
  context: PanelContext;
}

export type ResumePanelAction =
  | { type: 'refresh' }
  | {
      type: 'start';
      payload: Pick<StartSessionParams, 'session_id'>;
    }
  | {
      type: 'save';
      payload: Pick<SaveContextParams, 'kind' | 'content'>;
    }
  | {
      type: 'end';
      payload: Pick<EndSessionParams, 'summary'>;
    };

function isEmptySnapshot(result: ResumeSessionResult): boolean {
  return (
    result.snapshot.resume.length === 0 &&
    result.snapshot.recentDecisions.length === 0 &&
    result.snapshot.openThreads.length === 0 &&
    result.snapshot.nextActions.length === 0
  );
}

export class ResumePanelProvider {
  private state: ResumePanelRenderState;
  private context: PanelContext;

  constructor(private readonly options: ResumePanelProviderOptions) {
    this.context = { ...options.context };
    this.state = {
      status: 'loading',
      context: this.context,
    };
  }

  getState(): ResumePanelRenderState {
    return this.state;
  }

  async handleAction(action: ResumePanelAction): Promise<string> {
    if (action.type === 'refresh') {
      return this.refresh();
    }

    if (action.type === 'start') {
      const result = await this.options.client.start({
        project: this.context.project,
        process_id: this.context.process_id,
        branch: this.context.branch,
        session_id: action.payload.session_id,
      });

      this.context = {
        ...this.context,
        session_id: result.session_id,
      };

      return this.refresh();
    }

    if (action.type === 'save') {
      await this.options.client.save({
        ...action.payload,
        project: this.context.project,
        session_id: this.requireSessionId(action.type),
        process_id: this.context.process_id,
        branch: this.context.branch,
      });

      return this.refresh();
    }

    const result = await this.options.client.end({
      project: this.context.project,
      session_id: this.requireSessionId(action.type),
      process_id: this.context.process_id,
      branch: this.context.branch,
      summary: action.payload.summary,
    });

    this.context = {
      ...this.context,
      session_id: result.session_id,
    };

    return this.refresh();
  }

  async refresh(): Promise<string> {
    this.state = {
      status: 'loading',
      context: this.context,
    };

    try {
      const result = await this.options.client.resume({
        project: this.context.project,
        branch: this.context.branch,
        session_id: this.context.session_id,
        process_id: this.context.process_id,
      });

      if (isEmptySnapshot(result)) {
        this.state = {
          status: 'empty',
          context: this.context,
        };
      } else {
        this.state = {
          status: 'ready',
          context: this.context,
          viewModel: toResumeSnapshotViewModel(result.snapshot),
        };
      }
    } catch (error) {
      this.state = {
        status: 'error',
        context: this.context,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return renderResumePanelHtml(this.state);
  }

  private requireSessionId(action: 'save' | 'end'): string {
    if (!this.context.session_id) {
      throw new Error(`session_id is required for ${action}`);
    }

    return this.context.session_id;
  }
}
