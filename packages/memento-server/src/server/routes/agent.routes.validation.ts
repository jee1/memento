import { AgentIntegrationError, type KnowledgeCandidate } from '@memento/core';

export type PersonalAgentMemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

export function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentIntegrationError(`${name} must be a non-empty string`, 'INVALID_PAYLOAD', 400);
  }
  return value.trim();
}

export function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new AgentIntegrationError(`${name} must be an array of non-empty strings`, 'INVALID_PAYLOAD', 400);
  }
  return value.map(item => item.trim());
}

export function optionalOwnerId(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) return optionalStringArray(value, 'owner_id');
  return optionalString(value, 'owner_id');
}

export function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new AgentIntegrationError(`${name} must be a positive integer`, 'INVALID_PAYLOAD', 400);
  }
  return value;
}

export function optionalMemoryTypes(value: unknown): PersonalAgentMemoryType[] | undefined {
  if (value === undefined || value === null) return undefined;
  const allowed = new Set<PersonalAgentMemoryType>(['working', 'episodic', 'semantic', 'procedural']);
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !allowed.has(item as PersonalAgentMemoryType))) {
    throw new AgentIntegrationError('memory_types must be an array of memory type strings', 'INVALID_PAYLOAD', 400);
  }
  return value as PersonalAgentMemoryType[];
}

export function requireCandidates(value: unknown): KnowledgeCandidate[] {
  if (!Array.isArray(value)) {
    throw new AgentIntegrationError('candidates must be an array', 'INVALID_PAYLOAD', 400);
  }
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new AgentIntegrationError('candidates must contain objects', 'INVALID_PAYLOAD', 400);
    }
  }
  return value as KnowledgeCandidate[];
}
