import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(currentDir, '..', '..', 'schema.sql');

describe('agent integration bundled schema', () => {
  it('defines additive session, observation, and provenance storage', () => {
    const schema = readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('CREATE TABLE IF NOT EXISTS agent_session');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS agent_observation');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_provenance');
    expect(schema).toContain('UNIQUE(adapter_name, event_id)');
    expect(schema).toContain('idx_agent_observation_timeline');
    expect(schema).toContain('idx_agent_observation_expires_at');
    expect(schema).toContain('idx_memory_provenance_observation');
  });
});
