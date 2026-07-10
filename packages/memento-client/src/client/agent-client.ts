import type {
  AgentEventEnvelopeLike,
  AgentObservationQuery,
  AgentOperationsStatusQuery,
  AgentProvenanceQuery,
  AgentProvenanceLinkInput,
} from '../types.js';
import type { MementoClientCore } from './client-context.js';

export async function getAgentCapabilities<T = Record<string, unknown>>(
  client: MementoClientCore,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get('/api/v1/agent/capabilities');
  return response.data as T;
}

export async function getAgentOperationsStatus<T = Record<string, unknown>>(
  client: MementoClientCore,
  query: AgentOperationsStatusQuery = {},
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get('/api/v1/agent/operations/status', {
    params: query,
  });
  return response.data as T;
}

export async function startAgentSession<T = Record<string, unknown>>(
  client: MementoClientCore,
  event: AgentEventEnvelopeLike,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.post('/api/v1/agent/sessions', event);
  return response.data as T;
}

export async function ingestAgentObservations<T = Record<string, unknown>>(
  client: MementoClientCore,
  events: AgentEventEnvelopeLike[],
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.post('/api/v1/agent/observations:ingest', { events });
  return response.data as T;
}

export async function preCompactAgentSession<T = Record<string, unknown>>(
  client: MementoClientCore,
  sessionId: string,
  event: AgentEventEnvelopeLike,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.post(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}:pre-compact`,
    event,
  );
  return response.data as T;
}

export async function stopAgentSession<T = Record<string, unknown>>(
  client: MementoClientCore,
  sessionId: string,
  event: AgentEventEnvelopeLike,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.post(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}:stop`,
    event,
  );
  return response.data as T;
}

export async function getAgentSession<T = Record<string, unknown>>(
  client: MementoClientCore,
  sessionId: string,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
  );
  return response.data as T;
}

export async function listAgentObservations<T = Record<string, unknown>>(
  client: MementoClientCore,
  sessionId: string,
  query: AgentObservationQuery = {},
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/observations`,
    { params: query },
  );
  return response.data as T;
}

export async function getAgentProvenance<T = Record<string, unknown>>(
  client: MementoClientCore,
  query: AgentProvenanceQuery,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get('/api/v1/agent/provenance', {
    params: query,
  });
  return response.data as T;
}

export async function linkAgentProvenance<T = Record<string, unknown>>(
  client: MementoClientCore,
  input: AgentProvenanceLinkInput,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.post('/api/v1/agent/provenance', input);
  return response.data as T;
}

export async function exportAgentSession<T = Record<string, unknown>>(
  client: MementoClientCore,
  sessionId: string,
): Promise<T> {
  client.ensureConnected();
  const response = await client.httpClient.get(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/export`,
  );
  return response.data as T;
}

export async function deleteAgentSession(
  client: MementoClientCore,
  sessionId: string,
): Promise<void> {
  client.ensureConnected();
  await client.httpClient.delete(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`);
}
