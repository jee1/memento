#!/usr/bin/env node
/**
 * Validates workspace structure: workspaces in root package.json and
 * packages/memento-core, packages/memento-assistant, packages/memento-assistant-cursor with src/index.ts.
 * Exit 1 if invalid (for use in type-check gate).
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const workspaces = pkg.workspaces;
if (
  !Array.isArray(workspaces) ||
  !workspaces.includes('packages/memento-core') ||
  !workspaces.includes('packages/memento-assistant') ||
  !workspaces.includes('packages/memento-assistant-cursor')
) {
  console.error(
    'validate-workspace: root package.json must have workspaces including packages/memento-core, packages/memento-assistant, and packages/memento-assistant-cursor'
  );
  process.exit(1);
}

const coreIndex = join(root, 'packages', 'memento-core', 'src', 'index.ts');
const assistantIndex = join(root, 'packages', 'memento-assistant', 'src', 'index.ts');
const cursorIndex = join(root, 'packages', 'memento-assistant-cursor', 'src', 'index.ts');
if (!existsSync(coreIndex)) {
  console.error('validate-workspace: packages/memento-core/src/index.ts is missing');
  process.exit(1);
}
if (!existsSync(assistantIndex)) {
  console.error('validate-workspace: packages/memento-assistant/src/index.ts is missing');
  process.exit(1);
}
if (!existsSync(cursorIndex)) {
  console.error('validate-workspace: packages/memento-assistant-cursor/src/index.ts is missing');
  process.exit(1);
}
