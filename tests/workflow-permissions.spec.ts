import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = join(process.cwd(), '.github/workflows');
const WORKFLOW_FILES = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'));

describe('workflow permissions', () => {
  it.each(WORKFLOW_FILES)('%s declares top-level permissions', (name) => {
    const source = readFileSync(join(WORKFLOW_DIR, name), 'utf-8');
    expect(source).toMatch(/^permissions:/m);
  });
});
