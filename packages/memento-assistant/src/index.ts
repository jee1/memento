/**
 * Memento Assistant - developer continuity, session lifecycle, resume snapshot.
 * Phase 1: consumes memento-core public API only.
 * Package root public API: client types and CLI entry.
 */
export { AssistantClient, runCli } from './client/index.js';
export type {
  AssistantClientOptions,
  StartSessionParams,
  SaveContextParams,
  EndSessionParams,
  ResumeSessionParams,
  ResumeSessionResult,
} from './client/index.js';
export type { ResumeSnapshot } from './continuity/types.js';
