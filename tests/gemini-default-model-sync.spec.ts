import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_LLM_MODEL } from '../packages/memento-core/src/shared/config/constants.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf-8');

describe('Gemini LLM default model (#1407)', () => {
  it('compose falls back to the code default', () => {
    expect(read('docker-compose.base.yml')).toContain(
      `GEMINI_LLM_MODEL: \${GEMINI_LLM_MODEL:-${DEFAULT_GEMINI_LLM_MODEL}}`,
    );
  });

  it('env templates show the code default', () => {
    const values = [
      ...read('env.example').matchAll(/^#?\s*(?:GEMINI_LLM_MODEL|MEMENTO_AGENT_GEMINI_MODEL|MEMENTO_PERSONAL_AGENT_GEMINI_MODEL)=(\S+)/gm),
      ...read('services/agent/env.example').matchAll(/^AGENT_GEMINI_MODEL=(\S+)/gm),
    ].map((match) => match[1]);
    expect(values.length).toBeGreaterThanOrEqual(4);
    expect(new Set(values)).toEqual(new Set([DEFAULT_GEMINI_LLM_MODEL]));
  });
});
