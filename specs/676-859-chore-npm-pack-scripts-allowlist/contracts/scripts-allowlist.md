# Contract: npm pack scripts allowlist

## Function

`findDisallowedScriptPaths(paths: Iterable<string>): string[]`

### Input

- Tarball entry paths as produced by `listUstarGzipEntries` (e.g. `package/scripts/auto-setup.js`).

### Output

- Sorted unique list of violating **file** paths under `package/scripts/`.
- Empty array ⇒ pass.

### Rules

1. Ignore paths not starting with `package/scripts/`.
2. Ignore directory-like entries (`endsWith('/')`).
3. A file path is a violation if it ends with `.ts` **or** is not in `ALLOWED_PACKAGE_SCRIPT_PATHS`.
4. Allowlist is exact string match (no glob).

## package.json `files` (scripts portion)

MUST list exactly the repo-relative counterparts of the allowlist:

- `scripts/auto-setup.js`
- `scripts/lib/cli-runtime.js`
- `scripts/lib/postinstall-db-init.js`
