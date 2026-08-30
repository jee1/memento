# Phase 1 Data Model: Database Backup Retention and Artifact Cleanup

This feature adds no database tables. Its model consists of filesystem identities and operation
results owned by `BackupManager`.

## Backup Attempt

Represents one creation operation before publication.

| Field | Type | Rules |
| --- | --- | --- |
| `attemptId` | UUID string | Generated locally; appears only in the strict in-progress name. |
| `kind` | `automatic` \| `operator` | Automatic requires `migrationVersion`; operator omits it. |
| `migrationVersion` | string or absent | Numeric dotted version for automatic backups only. |
| `createdAt` | `Date` | Captured once in UTC and used for the completed filename. |
| `inProgressName` | basename | Strict implementation-owned `.partial-<uuid>.db` grammar, disjoint from completed names. |
| `completedName` | basename | Automatic or operator grammar; never published before validation. |
| `totalPages` | non-negative integer | Supplied by the completed online backup operation. |
| `pageSize` | positive integer | Captured at the source snapshot boundary and confirmed on destination. |
| `expectedSize` | positive integer | `totalPages * pageSize`. |
| `size` | positive integer | Existing result field; must equal `expectedSize`. |

### State transitions

```text
created -> writing -> validating -> standalone -> published
   \          \            \             \
    +----------+------------+---------------> failed -> artifact cleanup
```

- `published` requires completed online backup metadata, nonzero exact size, destination page
  agreement, full integrity `ok`, closed connection, and no attempt sidecars.
- `failed` can never transition to `published`; the full unpublished artifact set is removed.
- A crash after hard-link publication can leave both names for the same validated inode. The
  completed identity remains valid and the partial identity is cleanup-eligible.

## Backup Artifact

One direct child discovered in the backup directory.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | basename string | Safe report identifier; never an absolute path. |
| `classification` | `automatic` \| `operator` \| `in-progress` \| `sidecar` \| `ignored` | Produced by anchored filename parsing before deletion logic. |
| `createdAt` | `Date` or absent | Parsed only from valid completed names. No mtime fallback. |
| `migrationVersion` | string or absent | Present only for automatic completed names. |
| `size` | non-negative integer | From `lstat`; zero-byte recognized databases are invalid. |
| `identity` | filesystem fingerprint | `dev`, `ino`, type/mode, size, and `mtimeMs` captured during inspection. |
| `reason` | cleanup reason or absent | One of the four selected-artifact reasons; absent for protected/ignored entries, which are counted but not listed. |

### Classification and eligibility

- `automatic`: delete only if zero-byte or its valid timestamp is strictly older than the fixed
  30-day cutoff.
- `operator`: preserve every nonzero file; delete only a zero-byte recognized backup.
- `in-progress`: preserve during routine retention; select only during explicit cleanup after the
  operator has stopped backup/restore/server activity.
- `sidecar`: select completed-backup sidecars under all cleanup modes; select partial sidecars only
  during explicit stopped-server cleanup; never match the live database.
- `ignored`: unrecognized files, directories, symbolic links, invalid timestamps, boundary-equal or
  future automatic names; never delete.

## Cleanup Candidate

An immutable inspection record carried from selection to optional apply.

| Field | Type | Rules |
| --- | --- | --- |
| `artifact` | `BackupArtifact` | Must be a selected recognized artifact. |
| `inspectedIdentity` | fingerprint | Compared with a new `lstat` immediately before deletion. |
| `selectedBytes` | integer | Size at inspection; contributes to preview totals. |
| `status` | `selected` \| `deleted` \| `skipped` \| `failed` | Preview remains `selected`; apply ends in exactly one terminal status. |

Deletion is allowed only when the candidate is still the same direct-child regular file and its
fingerprint is unchanged. `ENOENT` or change becomes `skipped`; unlink errors become `failed`.

## Cleanup Report

One result for preview, apply, or routine retention.

| Field | Type | Invariant |
| --- | --- | --- |
| `ok` | boolean | False when scanning fails or any selected artifact is skipped/failed; preview is true if scanning succeeds. |
| `error` | `scan-failed` or `null` | Operation-level safe failure code; never contains a path or raw filesystem text. |
| `mode` | `preview` \| `apply` | Routine retention uses apply semantics internally. |
| `inspectedCount` | integer | Number of direct children inspected. |
| `selectedCount` | integer | Number selected under common rules. |
| `selectedBytes` | integer | Sum of selected sizes at inspection. |
| `deletedCount` | integer | Apply-only successful deletions; zero in preview. |
| `reclaimedBytes` | integer | Bytes actually deleted; zero in preview. |
| `skippedCount` | integer | Selected candidates missing or changed before deletion. |
| `failedCount` | integer | Selected candidates whose delete/revalidation operation failed. |
| `ignoredCount` | integer | Inspected children not selected. |
| `artifacts` | outcome array | Safe basename, terminal status, selection reason, and optional outcome detail; no absolute paths. |

Each artifact outcome has `detail: null` for selected/deleted or one of `inspect-failed`,
`missing-before-delete`, `changed-before-delete`, and `delete-failed`. For every successful scan,
`inspectedCount = selectedCount + ignoredCount` and `artifacts.length = selectedCount`. For apply,
`selectedCount = deletedCount + skippedCount + failedCount`. For preview,
`deletedCount = reclaimedBytes = skippedCount = failedCount = 0`, and each selected artifact remains
`selected`. A second apply after a successful unchanged apply has `selectedCount = deletedCount = 0`.

## Relationships

- One successful `BackupAttempt` produces exactly one completed automatic or operator
  `BackupArtifact`.
- One failed attempt may produce zero or more temporary artifacts, all belonging to the same strict
  in-progress artifact set.
- One cleanup operation inspects many artifacts, creates candidates for eligible artifacts, and
  returns one reconciled report.
- Routine retention follows one successfully published automatic attempt. Operator backup creation
  does not trigger automatic retention.
