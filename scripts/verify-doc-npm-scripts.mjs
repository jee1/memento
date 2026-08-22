#!/usr/bin/env node
/* eslint-disable no-console, security/detect-non-literal-fs-filename -- CLI scans repository paths and reports findings. */
/** Verify npm script references in both directions.
 *
 * Forward: every `npm run <name>` in markdown must exist in the root or a workspace.
 * Reverse: every root script must be referenced by docs, workflows, or another script,
 * unless it is an explicit npm lifecycle hook or developer convenience command.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.worktrees', 'graphify-out']);

const KEEP_SCRIPT_NAMES = new Set([
  // npm lifecycle hooks
  'prepare',
  'postinstall',
  'prepack',
  'postpack',
  'prepublishOnly',
  // intentionally direct developer conveniences
  'test:watch',
  'test:log-issue-monitor',
  'docker:down',
  // packaging recovery entry points are intentionally invoked by humans
  'pack:tarball',
  'restore-workspace',
]);

function* walkFiles(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(full, relPath);
    } else {
      yield { full, relPath };
    }
  }
}

function* workspaceDirs(rootPkg) {
  const workspaces = rootPkg.workspaces;
  if (!Array.isArray(workspaces)) return;
  for (const workspace of workspaces) {
    if (workspace.endsWith('/*')) {
      const relDir = workspace.slice(0, -2);
      const abs = path.join(ROOT, relDir);
      if (!fs.existsSync(abs)) continue;
      for (const sub of fs.readdirSync(abs, { withFileTypes: true })) {
        if (sub.isDirectory()) yield path.join(relDir, sub.name);
      }
    } else {
      yield workspace;
    }
  }
}

function loadPackages() {
  const rootPath = path.join(ROOT, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  const packages = [{ path: rootPath, pkg: rootPkg }];
  for (const dir of workspaceDirs(rootPkg)) {
    const packagePath = path.join(ROOT, dir, 'package.json');
    if (fs.existsSync(packagePath)) {
      packages.push({ path: packagePath, pkg: JSON.parse(fs.readFileSync(packagePath, 'utf8')) });
    }
  }
  return packages;
}

export function collectNpmRunScriptNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/\bnpm\s+run\s+([a-z0-9][a-z0-9:-]*)\b/gi)) {
    names.add(match[1]);
  }
  return names;
}

export function collectMarkdownScriptNames(text) {
  const names = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*npm\s+run\s+([a-z0-9][a-z0-9:-]*)\b/i);
    if (match) names.add(match[1]);
  }
  for (const match of text.matchAll(/`npm\s+run\s+([^`\s]+)(?:\s+[^`]*)?`/gi)) {
    const name = match[1];
    if (/^[a-z0-9][a-z0-9:-]*$/i.test(name)) names.add(name);
  }
  for (const match of text.matchAll(/`((?:quality:benchmark|migrate:embedding):[a-z0-9][a-z0-9:-]*)`/gi)) {
    names.add(match[1]);
  }
  return names;
}

function stripSourceComments(text) {
  let result = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        result += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (char === '\n') {
        result += char;
      }
      continue;
    }
    if (quote) {
      result += char;
      if (char === '\\' && next) {
        result += next;
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += char;
    } else if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (char === '#' && (index === 0 || text[index - 1] === '\n')) {
      lineComment = true;
    } else {
      result += char;
    }
  }
  return result;
}

export function collectReferenceScriptNames(relPath, text) {
  if (
    relPath === 'scripts/verify-doc-npm-scripts.mjs' ||
    /(?:^|\/)(?:__tests__|__fixtures__|fixtures)(?:\/|$)/.test(relPath) ||
    /\.(?:spec|test)\.[^.]+$/.test(relPath)
  ) {
    return new Set();
  }
  if (relPath.endsWith('.md')) return collectMarkdownScriptNames(text);
  return collectNpmRunScriptNames(stripSourceComments(text));
}

export function findOrphanScriptNames(rootScriptNames, referencedNames) {
  return [...rootScriptNames]
    .filter((name) => !KEEP_SCRIPT_NAMES.has(name) && !referencedNames.has(name))
    .sort();
}

export function isReferenceSource(relPath) {
  return (
    relPath.startsWith('.github/workflows/') ||
    relPath.startsWith('docs/') ||
    relPath.startsWith('scripts/') ||
    (!relPath.includes('/') && relPath.endsWith('.md'))
  );
}

export function collectPackageScriptReferences(scripts) {
  const references = new Set();
  for (const [callerName, command] of Object.entries(scripts ?? {})) {
    for (const name of collectNpmRunScriptNames(String(command))) {
      if (name !== callerName) references.add(name);
    }
  }
  return references;
}

function collectReferences(packages, files) {
  const references = new Set();
  for (const { pkg } of packages) {
    for (const name of collectPackageScriptReferences(pkg.scripts)) references.add(name);
  }
  for (const file of files) {
    if (!isReferenceSource(file.relPath)) continue;
    if (!/\.(?:md|ya?ml|ts|js|mjs|sh)$/.test(file.relPath)) continue;
    const text = fs.readFileSync(file.full, 'utf8');
    for (const name of collectReferenceScriptNames(file.relPath, text)) references.add(name);
  }
  return references;
}

export function verifyNpmScriptReferences() {
  const packages = loadPackages();
  const files = [...walkFiles(ROOT)];
  const markdownFiles = files.filter((file) => file.relPath.endsWith('.md'));
  const knownNames = new Set(
    packages.flatMap(({ pkg }) => Object.keys(pkg.scripts ?? {})),
  );
  const forwardProblems = [];

  for (const file of markdownFiles) {
    const text = fs.readFileSync(file.full, 'utf8');
    for (const name of collectMarkdownScriptNames(text)) {
      if (!knownNames.has(name)) forwardProblems.push({ file: file.relPath, script: name });
    }
  }

  const rootScriptNames = new Set(Object.keys(packages[0].pkg.scripts ?? {}));
  const referencedNames = collectReferences(packages, files);
  const orphanScripts = findOrphanScriptNames(rootScriptNames, referencedNames);

  return {
    knownCount: knownNames.size,
    markdownCount: markdownFiles.length,
    forwardProblems,
    orphanScripts,
  };
}

function main() {
  const result = verifyNpmScriptReferences();
  console.log(
    `Known npm scripts (union): ${result.knownCount}; scanned ${result.markdownCount} markdown files.`,
  );

  if (result.forwardProblems.length > 0) {
    console.error(`\nUnknown npm scripts cited in markdown (${result.forwardProblems.length}):\n`);
    for (const problem of result.forwardProblems) {
      console.error(`  ${problem.file}: npm run ${problem.script}`);
    }
  }

  if (result.orphanScripts.length > 0) {
    console.error(`\nUnreferenced root npm scripts (${result.orphanScripts.length}):\n`);
    for (const script of result.orphanScripts) console.error(`  ${script}`);
  }

  if (result.forwardProblems.length === 0 && result.orphanScripts.length === 0) {
    console.log('All npm script references are valid in both directions.');
    return 0;
  }

  console.error('\nFix the reference, remove the orphan script, or document an intentional keep-list entry.');
  return 1;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
