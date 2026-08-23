# Backup and Cleanup CLI Contract

## Commands

```bash
# Existing operator backup behavior; remains backward compatible
npm run db:backup

# Existing-backlog cleanup preview; default and non-destructive
npm run db:backup:cleanup

# Destructive apply; requires exact explicit intent
npm run db:backup:cleanup -- --apply
```

`db:backup:cleanup` is an npm alias for the existing `backup-memory-db.mjs --cleanup` entry point.
Unknown flags, `--apply` without cleanup mode when invoking the underlying script directly, or more
than the supported flags are usage errors and must not delete files.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `DB_PATH` | No | Live database path. Defaults to `~/.memento/data/memory.db`; `~` inside the variable is not expanded. The backup directory is the sibling `backups/` directory. |

Cleanup apply assumes the backup directory is trusted and that the MCP server, restore command, and
other cleanup operations are stopped. The command never recurses and never follows symbolic links.

## Backup success output

The no-argument command retains its existing successful JSON fields. Additive validation metadata
may be included.

```json
{
  "ok": true,
  "dbPath": "/trusted/operator/path/memory.db",
  "backupPath": "/trusted/operator/path/backups/memory-backup-2026-08-23T01-02-03-456Z.db",
  "quick_check": "ok",
  "integrity_check": "ok",
  "memory_item": 123
}
```

Successful local operator output may contain the paths required for restore. Errors and cleanup
reports use safe messages and basenames only; they must not echo the database path.

## Cleanup output

Preview and apply emit exactly one JSON document to stdout.

```json
{
  "ok": true,
  "error": null,
  "mode": "preview",
  "inspectedCount": 6900,
  "selectedCount": 6860,
  "selectedBytes": 5905580032,
  "deletedCount": 0,
  "reclaimedBytes": 0,
  "skippedCount": 0,
  "failedCount": 0,
  "ignoredCount": 40,
  "artifacts": [
    {
      "id": "memory-backup-2.0-2026-06-01T00-00-00-000Z.db",
      "status": "selected",
      "reason": "expired-automatic",
      "detail": null
    }
  ]
}
```

Apply uses the same schema with `mode: "apply"`; each selected artifact ends as `deleted`,
`skipped`, or `failed`.

### Artifact fields

| Field | Values |
| --- | --- |
| `id` | Direct-child basename only. |
| `status` | `selected`, `deleted`, `skipped`, or `failed`. |
| `reason` | Stable selection reason: `expired-automatic`, `zero-byte-backup`, `orphaned-sidecar`, or `interrupted-attempt`. |
| `detail` | `null` for selected/deleted, otherwise `inspect-failed`, `missing-before-delete`, `changed-before-delete`, or `delete-failed`. |

Ignored artifacts contribute to `ignoredCount` but need not be listed individually; this keeps the
6,900-file report bounded to actionable entries. Any listed failure must use a safe identifier and
stable reason, not an absolute path or raw filesystem error.

## Invariants

- Preview performs no unlink/link/rename operation.
- A scan failure returns `ok: false`, `error: "scan-failed"`, zero totals, no raw path, and exit 1.
- Preview and apply use one selector. Against an unchanged directory, their `selectedCount`,
  `selectedBytes`, artifact IDs, and selection reasons match.
- Every successful scan satisfies `inspectedCount = selectedCount + ignoredCount` and
  `artifacts.length = selectedCount`.
- Apply satisfies `selectedCount = deletedCount + skippedCount + failedCount`.
- `reclaimedBytes` sums only successfully deleted bytes.
- A successful second apply against an unchanged directory reports zero selected/deleted artifacts
  and zero reclaimed bytes.
- Automatic cutoff comparison is strict: a timestamp equal to the cutoff is retained.
- Valid nonzero operator backups, the live database, symbolic links, directories, and unrecognized
  files are never selected.
- Explicit cleanup may select strict in-progress artifacts because its prerequisite stops other
  backup activity; routine migration retention must ignore them.

## Exit status

| Code | Meaning |
| --- | --- |
| `0` | Backup completed and validated, preview completed, or apply deleted every selected candidate. |
| `1` | Usage error, scan failure, backup/validation/publication failure, or apply had any failed/skipped selected artifact. |

Routine migration retention consumes the same report but does not turn a successful backup or
migration into a failure. It logs the non-successful maintenance result with safe artifact IDs.
