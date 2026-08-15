/**
 * Helpers for #750: resolve root-registered ops script entry files
 * and detect stale root `src/` import paths.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, 'scripts');

/** Import-like references to the removed root `src/` tree. */
export const ROOT_SRC_IMPORT_RE =
  /(?:from|import)\s*(?:\(\s*)?['"](?:\.\.\/)+src\/[^'"]+['"]|require\s*\(\s*['"](?:\.\.\/)+src\/[^'"]+['"]\s*\)|['"](?:\.\.\/)+src\/[^'"]+['"]/g;

const ENTRY_IN_COMMAND_RE =
  /(?:^|[\s&|;])(?:npx\s+)?(?:tsx|node(?:\s+--import\s+tsx)?)\s+(scripts\/[^\s'"]+)/g;

export function listRegisteredOpsScriptEntries(
  packageJsonPath = join(ROOT, 'package.json')
): Array<{ npmScript: string; entryRel: string; entryAbs: string }> {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const out: Array<{ npmScript: string; entryRel: string; entryAbs: string }> = [];
  const seen = new Set<string>();

  for (const [npmScript, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    // Skip pure vitest aggregators — not ops CLIs.
    if (/^\s*vitest\b/.test(command) && !/\b(?:tsx|node)\s+scripts\//.test(command)) {
      continue;
    }

    ENTRY_IN_COMMAND_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENTRY_IN_COMMAND_RE.exec(command)) !== null) {
      const entryRel = match[1]!;
      if (seen.has(`${npmScript}:${entryRel}`)) continue;
      seen.add(`${npmScript}:${entryRel}`);
      out.push({
        npmScript,
        entryRel,
        entryAbs: resolve(ROOT, entryRel),
      });
    }
  }

  return out;
}

function collectRelativeScriptImports(fileAbs: string, content: string): string[] {
  const dir = dirname(fileAbs);
  const importRe =
    /(?:from|import)\s*(?:\(\s*)?['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;
    const resolved = resolve(dir, spec);
    // Only follow local scripts/ graph (not node_modules / packages).
    const relToScripts = relative(SCRIPTS_DIR, resolved);
    if (relToScripts.startsWith('..') || relToScripts.includes('..')) continue;
    found.push(resolved);
  }
  return found;
}

function tryRead(pathAbs: string): string | null {
  const candidates = [pathAbs];
  if (!pathAbs.endsWith('.js') && !pathAbs.endsWith('.ts') && !pathAbs.endsWith('.mjs')) {
    candidates.push(`${pathAbs}.ts`, `${pathAbs}.js`, `${pathAbs}.mjs`);
  } else if (pathAbs.endsWith('.js')) {
    candidates.push(pathAbs.replace(/\.js$/, '.ts'));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

export type RootSrcHit = {
  fileRel: string;
  npmScripts: string[];
  matches: string[];
};

/**
 * Walk registered ops entrypoints and relative imports under scripts/
 * for root `../src/...` (and equivalent) references.
 */
export function findRootSrcImportsInRegisteredOps(): RootSrcHit[] {
  const entries = listRegisteredOpsScriptEntries();
  const npmByFile = new Map<string, Set<string>>();
  const queue: string[] = [];

  for (const entry of entries) {
    const key = normalize(entry.entryAbs);
    if (!npmByFile.has(key)) npmByFile.set(key, new Set());
    npmByFile.get(key)!.add(entry.npmScript);
    queue.push(key);
  }

  const visited = new Set<string>();
  const hits: RootSrcHit[] = [];

  while (queue.length > 0) {
    const fileAbs = queue.pop()!;
    if (visited.has(fileAbs)) continue;
    visited.add(fileAbs);

    const content = tryRead(fileAbs);
    if (content === null) continue;

    ROOT_SRC_IMPORT_RE.lastIndex = 0;
    const matches = [...content.matchAll(ROOT_SRC_IMPORT_RE)].map((m) => m[0]!);
    if (matches.length > 0) {
      hits.push({
        fileRel: relative(ROOT, fileAbs),
        npmScripts: [...(npmByFile.get(fileAbs) ?? [])].sort(),
        matches: [...new Set(matches)],
      });
    }

    for (const imported of collectRelativeScriptImports(fileAbs, content)) {
      const normalized = normalize(imported);
      if (!visited.has(normalized)) {
        // Inherit npm script labels from parent when possible.
        if (!npmByFile.has(normalized)) {
          npmByFile.set(normalized, new Set(npmByFile.get(fileAbs) ?? []));
        } else {
          for (const s of npmByFile.get(fileAbs) ?? []) {
            npmByFile.get(normalized)!.add(s);
          }
        }
        queue.push(normalized);
      }
    }
  }

  return hits.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
}

/** Convenience: list unique registered entry relative paths (for smoke params). */
export function listUniqueRegisteredOpsEntries(): string[] {
  const entries = listRegisteredOpsScriptEntries();
  return [...new Set(entries.map((e) => e.entryRel))].sort();
}

export function listScriptsDirFilesWithRootSrc(dir = SCRIPTS_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(abs);
        continue;
      }
      if (!/\.(js|ts|mjs|cjs)$/.test(name)) continue;
      const content = readFileSync(abs, 'utf8');
      ROOT_SRC_IMPORT_RE.lastIndex = 0;
      if (ROOT_SRC_IMPORT_RE.test(content)) {
        out.push(relative(ROOT, abs));
      }
    }
  };
  walk(dir);
  return out.sort();
}
