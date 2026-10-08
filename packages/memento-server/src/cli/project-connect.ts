import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

const HEADER = 'X-Memento-Project-Id';

interface McpServer {
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface McpJson {
  mcpServers?: Record<string, McpServer>;
  [key: string]: unknown;
}

interface ClaudeJson extends McpJson {
  projects?: Record<string, McpJson>;
}

interface ClientResult {
  client: 'claude-code' | 'codex' | 'cursor';
  path: string;
  status: 'updated' | 'unchanged' | 'skipped';
  reason?: string;
}

interface Dependencies {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  git?: (args: readonly string[], cwd: string) => string | undefined;
  claude?: (args: readonly string[], cwd: string) => number;
  write?: (message: string) => void | Promise<void>;
}

interface Context {
  root: string;
  home: string;
  projectId: string;
  dryRun: boolean;
  git: NonNullable<Dependencies['git']>;
  claude: NonNullable<Dependencies['claude']>;
}

function defaultGit(args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultClaude(args: readonly string[], cwd: string): number {
  return spawnSync('claude', args, { cwd, stdio: 'ignore', timeout: 15_000 }).status ?? 1;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  return text === undefined ? undefined : JSON.parse(text) as T;
}

async function writeText(path: string, text: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(path), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(path, text, 'utf8');
}

function withHeader(server: McpServer, projectId: string): McpServer {
  return { ...server, headers: { ...server.headers, [HEADER]: projectId } };
}

/** 저장소 파일에는 API key 가 들어가므로 커밋되지 않게 .git/info/exclude 에 올린다. */
async function keepLocal(ctx: Context, path: string): Promise<void> {
  const rel = relative(ctx.root, path);
  if (!ctx.git(['rev-parse', '--git-dir'], ctx.root)) return;
  if (ctx.git(['check-ignore', rel], ctx.root)) return;
  const exclude = ctx.git(['rev-parse', '--git-path', 'info/exclude'], ctx.root);
  if (!exclude) return;
  const target = resolve(ctx.root, exclude);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(target), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await appendFile(target, `\n# memento connect project\n/${rel}\n`, 'utf8');
}

async function connectClaude(ctx: Context): Promise<ClientResult> {
  const path = join(ctx.home, '.claude.json');
  const config = await readJson<ClaudeJson>(path);
  const local = config?.projects?.[ctx.root]?.mcpServers?.memento;
  const base = local ?? config?.mcpServers?.memento;
  if (!base) return { client: 'claude-code', path, status: 'skipped', reason: 'memento MCP server not configured' };
  if (local?.headers?.[HEADER] === ctx.projectId) return { client: 'claude-code', path, status: 'unchanged' };
  if (!ctx.dryRun) {
    // ~/.claude.json 은 실행 중인 Claude Code 가 다시 쓰므로 직접 고치지 않고 CLI 로 local scope 를 바꾼다
    if (local) ctx.claude(['mcp', 'remove', 'memento', '-s', 'local'], ctx.root);
    const status = ctx.claude(
      ['mcp', 'add-json', 'memento', JSON.stringify(withHeader(base, ctx.projectId)), '-s', 'local'],
      ctx.root,
    );
    if (status !== 0) throw new Error(`claude mcp add-json failed (exit ${status})`);
  }
  return { client: 'claude-code', path, status: 'updated' };
}

async function connectCursor(ctx: Context): Promise<ClientResult> {
  const path = join(ctx.root, '.cursor', 'mcp.json');
  const current = await readJson<McpJson>(path) ?? {};
  const base = current.mcpServers?.memento
    ?? (await readJson<McpJson>(join(ctx.home, '.cursor', 'mcp.json')))?.mcpServers?.memento;
  if (!base) return { client: 'cursor', path, status: 'skipped', reason: 'memento MCP server not configured' };
  if (base.headers?.[HEADER] === ctx.projectId) return { client: 'cursor', path, status: 'unchanged' };
  if (!ctx.dryRun) {
    const next = { ...current, mcpServers: { ...current.mcpServers, memento: withHeader(base, ctx.projectId) } };
    await writeText(path, `${JSON.stringify(next, null, 2)}\n`);
    await keepLocal(ctx, path);
  }
  return { client: 'cursor', path, status: 'updated' };
}

const TABLE = /^\s*\[([^\]]+)\]\s*$/;

function isMementoTable(name: string): boolean {
  return name === 'mcp_servers.memento' || name.startsWith('mcp_servers.memento.');
}

/** `[mcp_servers.memento]` 와 하위 테이블만 잘라 낸다. */
// ponytail: 줄 단위 TOML 처리 — 인라인 테이블(`http_headers = {...}`)·따옴표 키 테이블명은 못 읽는다. 필요해지면 TOML 파서 의존성 추가
export function codexMementoTables(text: string): string | undefined {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    const table = line.match(TABLE);
    if (table) inside = isMementoTable(table[1]!.trim());
    if (inside) out.push(line);
  }
  return out.length ? `${out.join('\n').trimEnd()}\n` : undefined;
}

export function setCodexProjectHeader(text: string, projectId: string): string {
  const entry = `"${HEADER}" = ${JSON.stringify(projectId)}`;
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.match(TABLE)?.[1]?.trim() === 'mcp_servers.memento.http_headers');
  if (start === -1) {
    return `${text.trimEnd()}\n\n[mcp_servers.memento.http_headers]\n${entry}\n`;
  }
  let end = lines.findIndex((line, index) => index > start && TABLE.test(line));
  if (end === -1) end = lines.length;
  const existing = lines.findIndex(
    (line, index) => index > start && index < end && /^\s*"?X-Memento-Project-Id"?\s*=/.test(line),
  );
  if (existing === -1) lines.splice(start + 1, 0, entry);
  else lines[existing] = entry;
  return lines.join('\n');
}

async function connectCodex(ctx: Context): Promise<ClientResult> {
  const path = join(ctx.root, '.codex', 'config.toml');
  const current = await readText(path) ?? '';
  let next = current;
  if (!codexMementoTables(current)) {
    const global = codexMementoTables(await readText(join(ctx.home, '.codex', 'config.toml')) ?? '');
    if (!global) return { client: 'codex', path, status: 'skipped', reason: 'memento MCP server not configured' };
    next = current.trim() ? `${current.trimEnd()}\n\n${global}` : global;
  }
  next = setCodexProjectHeader(next, ctx.projectId);
  if (next === current) return { client: 'codex', path, status: 'unchanged' };
  if (!ctx.dryRun) {
    await writeText(path, next);
    await keepLocal(ctx, path);
  }
  return { client: 'codex', path, status: 'updated' };
}

function parseArgs(argv: readonly string[]): { dryRun: boolean; projectId?: string } {
  let dryRun = false;
  let projectId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--project-id' && argv[index + 1]) {
      projectId = argv[index + 1]!;
      index += 1;
    } else {
      throw new Error(`Unknown connect project option: ${arg}`);
    }
  }
  return { dryRun, projectId };
}

/**
 * `memento connect project` — 현재 저장소의 Claude Code(local scope)·Codex·Cursor MCP 설정에
 * `X-Memento-Project-Id` 헤더를 넣는다 (#1270). 프로젝트는 --project-id → MEMENTO_PROJECT_ID → 저장소 폴더명.
 */
export async function runProjectConnect(
  argv: readonly string[],
  dependencies: Dependencies = {},
): Promise<number> {
  const write = dependencies.write ?? (message => process.stdout.write(message));
  try {
    const args = parseArgs(argv);
    const env = dependencies.env ?? process.env;
    const git = dependencies.git ?? defaultGit;
    const cwd = resolve(dependencies.cwd ?? process.cwd());
    const root = git(['rev-parse', '--show-toplevel'], cwd) ?? cwd;
    const projectId = (args.projectId ?? env.MEMENTO_PROJECT_ID ?? basename(root)).trim();
    if (!projectId || projectId.length > 200) throw new Error('project id must be 1-200 characters');
    const ctx: Context = {
      root,
      home: env.HOME ?? homedir(),
      projectId,
      dryRun: args.dryRun,
      git,
      claude: dependencies.claude ?? defaultClaude,
    };
    const clients = [await connectClaude(ctx), await connectCodex(ctx), await connectCursor(ctx)];
    await write(`${JSON.stringify({ agent: 'project', projectId, root, dryRun: args.dryRun, clients })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'project connection failed';
    await write(`${JSON.stringify({ agent: 'project', error: message })}\n`);
    return 1;
  }
}
