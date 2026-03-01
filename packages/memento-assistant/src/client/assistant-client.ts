import type { ResumeSnapshot } from '../continuity/types.js';

export interface AssistantClientOptions {
  assistantServerUrl: string;
  coreServerUrl?: string;
}

export interface StartSessionParams {
  project: string;
  process_id?: string;
  session_id: string;
  branch?: string;
}

export interface SaveContextParams {
  kind: 'task' | 'decision' | 'blocker' | 'next-step';
  content: string;
  project: string;
  session_id: string;
  process_id?: string;
  branch?: string;
}

export interface EndSessionParams {
  project: string;
  session_id: string;
  process_id?: string;
  branch?: string;
  summary?: string;
}

export interface ResumeSessionParams {
  project: string;
  process_id?: string;
  session_id?: string;
  branch?: string;
}

export interface ResumeSessionResult {
  snapshot: ResumeSnapshot;
}

export class AssistantClient {
  private readonly baseUrl: string;

  constructor(options: AssistantClientOptions) {
    this.baseUrl = options.assistantServerUrl.replace(/\/$/, '');
  }

  private ensureConnected(): void {
    if (!this.baseUrl) throw new Error('assistantServerUrl is required');
  }

  private async post<T>(path: string, params: unknown): Promise<T> {
    this.ensureConnected();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? res.statusText);
    }
    const data = (await res.json()) as { result: T };
    return data.result;
  }

  async startSession(params: StartSessionParams): Promise<{ session_id: string; memory_id: string }> {
    return this.post('/assistant/tools/start_session', params);
  }

  async saveContext(params: SaveContextParams): Promise<{ memory_id: string }> {
    return this.post('/assistant/tools/save_context', params);
  }

  async endSession(params: EndSessionParams): Promise<{ session_id: string; memory_id: string }> {
    return this.post('/assistant/tools/end_session', params);
  }

  async resumeSession(params: ResumeSessionParams): Promise<ResumeSessionResult> {
    return this.post<ResumeSessionResult>('/assistant/tools/resume_session', params);
  }
}
