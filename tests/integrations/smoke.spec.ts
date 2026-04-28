// tests/integrations/smoke.spec.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const guides = ['openclaw', 'nanoclaw', 'zeroclaw'];

function extractFencedBlocks(md: string, lang: 'json' | 'toml'): string[] {
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
}

describe('docs/integrations smoke', () => {
  for (const name of guides) {
    it(`${name}.md: stdio config block parses and references memento-mcp-server`, async () => {
      const path = join(ROOT, 'docs/integrations', `${name}.md`);
      const md = await readFile(path, 'utf8');
      const blocks = [...extractFencedBlocks(md, 'json'), ...extractFencedBlocks(md, 'toml')];
      const stdio = blocks.find(b => b.includes('--stdio'));
      expect(stdio, `no stdio config block found in ${name}.md`).toBeTruthy();
      expect(stdio).toMatch(/memento-mcp-server/);
    });

    it(`${name}.md: HTTP config block contains url and Authorization`, async () => {
      const path = join(ROOT, 'docs/integrations', `${name}.md`);
      const md = await readFile(path, 'utf8');
      const blocks = [...extractFencedBlocks(md, 'json'), ...extractFencedBlocks(md, 'toml')];
      const http = blocks.find(b => /["']?url["']?\s*[:=]/.test(b) && /Authorization|authorization/.test(b));
      expect(http, `no HTTP config block found in ${name}.md`).toBeTruthy();
      expect(http).toMatch(/(Bearer|MEMENTO_TOKEN)/);
    });
  }
});
