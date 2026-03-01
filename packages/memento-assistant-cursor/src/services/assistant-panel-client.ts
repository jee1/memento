import type {
  EndSessionParams,
  ResumeSessionParams,
  ResumeSessionResult,
  SaveContextParams,
  StartSessionParams,
} from 'memento-assistant';

export interface AssistantPanelClientOptions {
  assistantServerUrl: string;
  fetchImpl?: typeof fetch;
}

export interface AssistantPanelClient {
  start(params: StartSessionParams): Promise<{ session_id: string; memory_id: string }>;
  save(params: SaveContextParams): Promise<{ memory_id: string }>;
  end(params: EndSessionParams): Promise<{ session_id: string; memory_id: string }>;
  resume(params: ResumeSessionParams): Promise<ResumeSessionResult>;
}

export function createAssistantPanelClient(
  options: AssistantPanelClientOptions
): AssistantPanelClient {
  const baseUrl = options.assistantServerUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorPayload.error ?? response.statusText);
    }

    const data = (await response.json()) as { result: T };
    return data.result;
  }

  return {
    start: (params) => post('/assistant/tools/start_session', params),
    save: (params) => post('/assistant/tools/save_context', params),
    end: (params) => post('/assistant/tools/end_session', params),
    resume: (params) => post('/assistant/tools/resume_session', params),
  };
}
