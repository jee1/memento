#!/usr/bin/env node
/**
 * Validates workspace structure: workspaces in root package.json and
 * packages/memento-core, packages/memento-assistant with src/index.ts.
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
if (!Array.isArray(workspaces) || !workspaces.includes('packages/memento-core') || !workspaces.includes('packages/memento-assistant')) {
  console.error('validate-workspace: root package.json must have workspaces including packages/memento-core and packages/memento-assistant');
  process.exit(1);
}

const coreIndex = join(root, 'packages', 'memento-core', 'src', 'index.ts');
const assistantIndex = join(root, 'packages', 'memento-assistant', 'src', 'index.ts');
if (!existsSync(coreIndex)) {
  console.error('validate-workspace: packages/memento-core/src/index.ts is missing');
  process.exit(1);
}
if (!existsSync(assistantIndex)) {
  console.error('validate-workspace: packages/memento-assistant/src/index.ts is missing');
  process.exit(1);
}
