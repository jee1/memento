import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runProjectConnect, setCodexProjectHeader } from './project-connect.js';

const SERVER = { type: 'http', url: 'http://localhost:9001/mcp', headers: { 'X-API-Key': 'k' } };

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'memento-connect-project-home-'));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'my-repo-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { memento: SERVER } }));
  await mkdir(join(home, '.cursor'));
  await writeFile(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { memento: SERVER } }));
  await mkdir(join(home, '.codex'));
  await writeFile(join(home, '.codex', 'config.toml'), [
    'model = "x"',
    '',
    '[mcp_servers.memento]',
    'url = "http://localhost:9001/mcp"',
    '',
    '[mcp_servers.memento.http_headers]',
    'X-API-Key = "k"',
    '',
    '[mcp_servers.memento.tools.recall]',
    'approval_mode = "approve"',
    '',
    '[mcp_servers.other]',
    'command = "o"',
    '',
  ].join('\n'));
  const claude = vi.fn((_args: readonly string[], _cwd: string) => 0);
  const output: string[] = [];
  const deps = { cwd: root, env: { HOME: home }, claude, write: (m: string) => { output.push(m); } };
  return { home, root, claude, output, deps };
}

describe('memento connect project', () => {
  it('writes the repo folder name as project header to all three clients and keeps files out of git', async () => {
    const { root, claude, output, deps } = await fixture();

    expect(await runProjectConnect([], deps)).toBe(0);

    const result = JSON.parse(output.at(-1)!);
    const project = root.split('/').at(-1);
    expect(result.projectId).toBe(project);
    expect(result.clients.map((c: { status: string }) => c.status)).toEqual(['updated', 'updated', 'updated']);
    expect(claude).toHaveBeenCalledWith(
      ['mcp', 'add-json', 'memento', JSON.stringify({ ...SERVER, headers: { 'X-API-Key': 'k', 'X-Memento-Project-Id': project } }), '-s', 'local'],
      root,
    );
    const cursor = JSON.parse(await readFile(join(root, '.cursor', 'mcp.json'), 'utf8'));
    expect(cursor.mcpServers.memento.headers).toEqual({ 'X-API-Key': 'k', 'X-Memento-Project-Id': project });
    const codex = await readFile(join(root, '.codex', 'config.toml'), 'utf8');
    expect(codex).toContain(`[mcp_servers.memento.http_headers]\n"X-Memento-Project-Id" = "${project}"\nX-API-Key = "k"`);
    expect(codex).toContain('[mcp_servers.memento.tools.recall]');
    expect(codex).not.toContain('model = "x"');
    expect(codex).not.toContain('mcp_servers.other');
    const ignored = execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: root, encoding: 'utf8' });
    expect(ignored).toContain('!! .codex/');
    expect(ignored).toContain('!! .cursor/');
  });

  it('reports unchanged on reconnect and --project-id overrides the folder name', async () => {
    const { home, root, output, deps } = await fixture();
    expect(await runProjectConnect(['--project-id', 'memento'], deps)).toBe(0);
    const claudeJson = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8'));
    claudeJson.projects = { [root]: { mcpServers: { memento: { ...SERVER, headers: { 'X-Memento-Project-Id': 'memento' } } } } };
    await writeFile(join(home, '.claude.json'), JSON.stringify(claudeJson));

    expect(await runProjectConnect(['--project-id', 'memento'], deps)).toBe(0);
    expect(JSON.parse(output.at(-1)!).clients.map((c: { status: string }) => c.status))
      .toEqual(['unchanged', 'unchanged', 'unchanged']);
  });

  it('dry-run writes nothing and missing global config is skipped', async () => {
    const { home, root, claude, output, deps } = await fixture();
    await writeFile(join(home, '.claude.json'), '{}');

    expect(await runProjectConnect(['--dry-run'], deps)).toBe(0);
    expect(JSON.parse(output.at(-1)!).clients.map((c: { status: string }) => c.status))
      .toEqual(['skipped', 'updated', 'updated']);
    expect(claude).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.cursor', 'mcp.json'), 'utf8')).rejects.toThrow();
  });

  it('replaces an existing codex project header in place', () => {
    const text = '[mcp_servers.memento.http_headers]\n"X-Memento-Project-Id" = "old"\nX-API-Key = "k"\n';
    expect(setCodexProjectHeader(text, 'new'))
      .toBe('[mcp_servers.memento.http_headers]\n"X-Memento-Project-Id" = "new"\nX-API-Key = "k"\n');
  });
});
