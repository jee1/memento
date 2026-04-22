import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { expandHomeDirPath } from '../environment.js';

describe('environment path helpers', () => {
  it('expands a leading tilde to the user home directory', () => {
    expect(expandHomeDirPath('~/.memento/data/memory.db')).toBe(
      path.join(os.homedir(), '.memento/data/memory.db')
    );
  });

  it('leaves non-tilde paths unchanged', () => {
    expect(expandHomeDirPath('/tmp/memento.db')).toBe('/tmp/memento.db');
    expect(expandHomeDirPath('relative/memento.db')).toBe('relative/memento.db');
  });
});
