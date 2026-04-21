# Issue 191 Design: CSV Formula Injection Mitigation

## Context
Issue `#191` reports that `packages/memento-client/src/utils.ts` exports user-controlled `source` and `tags` fields into CSV without quoting or formula neutralization. The current implementation already quotes `content`, but it does not neutralize spreadsheet formula execution and it does not apply the same protection to all free-form string fields.

The goal of this change is to make CSV export safe to open in spreadsheet tools such as Excel and LibreOffice Calc without broad refactoring or unrelated behavior changes.

## Goals
- Prevent spreadsheet formula execution for free-form string fields exported by `memoriesToCSV()`.
- Apply a single, explicit rule to all agreed free-form string fields: `content`, `tags`, and `source`.
- Keep the implementation local to `packages/memento-client/src/utils.ts` and `packages/memento-client/src/utils.spec.ts`.
- Add focused automated tests that lock in the security behavior.

## Non-Goals
- Rewriting the entire CSV serializer.
- Changing non-free-form fields such as `id`, `type`, `importance`, `pinned`, `privacy_scope`, `created_at`, or `last_accessed`.
- Introducing a new external CSV dependency.
- Changing unrelated client APIs or server behavior.

## Scope
### In scope
- Add a helper in `packages/memento-client/src/utils.ts` that converts a free-form string into a safe CSV cell.
- Use the helper for `content`, `tags`, and `source` in `memoriesToCSV()`.
- Add tests for normal values, embedded quotes, and formula-like payloads beginning with `=`, `+`, `-`, or `@`.

### Out of scope
- Any changes outside `packages/memento-client`.
- Bulk refactors of other utility functions.
- Export format changes for Markdown or other serializers.

## Design
### Recommended approach
Introduce a small helper in `packages/memento-client/src/utils.ts`, tentatively named `toSafeCSVCell()`, and route every free-form string CSV field through it.

This keeps the mitigation logic in one place, limits the patch size, and reduces the risk of future regressions when new free-form CSV columns are added.

### Safe cell rules
The helper will apply the following rules in order:
1. `null` and `undefined` become an empty CSV cell (`''`).
2. Convert the input to its string form used by the existing CSV export path.
3. If the value starts with one of `=`, `+`, `-`, or `@`, prefix it with a single quote (`'`).
4. Escape internal double quotes by replacing `"` with `""`.
5. Wrap the final value in double quotes so delimiters and quotes remain valid CSV.

### Field mapping
- `content`: pass the raw content string through the helper.
- `tags`: join with `;` first, then pass the joined string through the helper.
- `source`: pass the raw source string through the helper.
- All other fields remain unchanged to keep the fix narrowly scoped.

### Why single-quote neutralization
The chosen mitigation is prefixing a single quote for formula-like leading characters. This is explicit, widely understood, and suitable for a security fix where predictable spreadsheet behavior matters more than preserving exact display text.

## Testing Strategy
Add focused tests in `packages/memento-client/src/utils.spec.ts` for `memoriesToCSV()` covering:
- Empty input returns an empty string.
- Normal string values remain valid CSV and are quoted as expected.
- Embedded double quotes are escaped correctly.
- `content`, `tags`, and `source` beginning with `=`, `+`, `-`, or `@` are exported with a leading single quote inside the quoted CSV cell.
- Joined tags are neutralized after joining, not before.

The tests should assert the emitted CSV text directly so the protection is obvious and resistant to accidental regression.

## Error Handling and Compatibility
This change should not introduce new runtime errors. The helper handles missing values defensively and reuses the existing string-building approach. Existing consumers of `memoriesToCSV()` continue to receive a CSV string, but dangerous spreadsheet-interpreted payloads are neutralized.

The only intentional behavior change is that formula-like free-form values will gain a leading single quote in exported CSV cells.

## Verification
Before implementation starts, work will proceed in the isolated worktree at `.worktrees/fix-issue-191-csv-injection`.

Baseline check already completed in the worktree:
- `npx vitest run packages/memento-client/src/utils.spec.ts`

Implementation verification will use at least:
- `npx vitest run packages/memento-client/src/utils.spec.ts`

Additional broader checks can be added if the code change touches shared client behavior more than expected.

## Risks and Trade-Offs
- Some spreadsheet tools may display the prefixed single quote, but that is an accepted trade-off for explicit formula neutralization.
- Keeping the fix scoped to three free-form fields avoids unnecessary risk, but future CSV columns must also use the helper if they are user-controlled.

## Implementation Notes
- Prefer a tiny helper over inline repeated logic.
- Keep the patch easy to audit from a security perspective.
- Do not expand the change into unrelated CSV cleanup unless a test reveals a necessary issue directly tied to this fix.
