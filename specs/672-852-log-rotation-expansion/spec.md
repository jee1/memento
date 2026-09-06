# Feature Specification: Expand log_rotation Beyond Triple-Extraction

**Feature Branch**: `feature/chore-ops-log_rotation-triple-extraction-migrati`  
**Created**: 2026-09-06  
**Status**: Brainstormed  
**Issue**: [#852](https://github.com/jee1/memento/issues/852)  
**Related**: #849 / PR #850 (count-cap lesson), #851 (migration churn source)  
**Input**: `log_rotation` currently deletes only `triple-extraction` age>30d files while
`migration_*.log`, `docker-diagnostics/`, and `log-issue-monitor/` grow unbounded.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bound migration log file count (Priority: P1)

An operator running migrations repeatedly sees `migration_*.log` stop accumulating without
limit. Age-only retention is insufficient because generation rate keeps almost all files inside
any practical day window. A count cap keeps the newest logs and removes surplus.

**Why this priority**: 2026-09-06 remeasure showed ~10,334 migration logs under
`~/.memento/logs` — the dominant file-count problem and the same failure mode as #849.

**Independent Test**: Seed hundreds of in-window `migration_*.log` files plus a few recent
keepers; run `log_rotation`; assert count ≤ configured keepCount and newest names survive.

**Acceptance Scenarios**:

1. **Given** more than keepCount migration logs all newer than any age cutoff, **When**
   `log_rotation` runs, **Then** only the newest keepCount files remain and older surplus files
   are deleted.
2. **Given** keepCount override `0` (count cap off), **When** rotation runs with age retention
   only, **Then** in-window files are not deleted solely for surplus (documents age-only failure).
3. **Given** non-migration files in the same directory, **When** rotation runs, **Then** those
   files are not selected by the migration selector.
4. **Given** a file delete fails mid-run, **When** the job finishes, **Then** the job still
   reports overall success if other deletions succeeded, records soft-fail warnings, and never
   exposes absolute paths in operator-facing reports.

---

### User Story 2 - Cap docker-diagnostics total bytes (Priority: P1)

An operator running docker-diagnostics continuously sees the diagnostics directory stay under a
configured total byte budget. Per-file 64MB rotation alone is not enough when retain-file count
× file size grows without a total ceiling.

**Why this priority**: Issue reported 648MB across 7 files with per-file 64MB rotation and no
directory total cap.

**Independent Test**: Seed rotated `*.jsonl` / `*.jsonl.N` segments totaling above the budget;
run rotation; assert total size ≤ budget and newest/active segments preferred.

**Acceptance Scenarios**:

1. **Given** docker-diagnostics segments totaling above the byte budget, **When**
   `log_rotation` runs, **Then** oldest rotated segments are removed until total size ≤ budget
   (or no eligible files remain).
2. **Given** only the active (unrotated) current file exists under budget, **When** rotation
   runs, **Then** it is retained.
3. **Given** collector env defaults, **When** documentation/config is reviewed, **Then**
   retain-file / max-bytes guidance reflects the total-budget policy (writer-side tightening
   allowed as supporting change).

---

### User Story 3 - Retain triple-extraction and add log-issue-monitor policy (Priority: P2)

Existing triple-extraction age retention continues to work. `log-issue-monitor/` output
(`occurrences.jsonl`, `monitor-errors.jsonl`, large append-only artifacts) gains an explicit
retention policy while `state.json` (fingerprint state) is preserved.

**Why this priority**: Monitor directory was 70MB in the original report and has no cleaner;
triple-extraction must not regress.

**Independent Test**: Seed old triple-extraction logs and oversized monitor jsonl plus
`state.json`; run rotation; assert old TE logs gone, monitor trim applied, `state.json` kept.

**Acceptance Scenarios**:

1. **Given** triple-extraction `.log` files older than retentionDays, **When** rotation runs,
   **Then** they are deleted as today.
2. **Given** `log-issue-monitor/state.json` and oversized `occurrences.jsonl`, **When**
   rotation runs, **Then** `state.json` remains and append-only history is trimmed/rotated per
   policy without breaking monitor restart identity.
3. **Given** monitor directory absent, **When** rotation runs, **Then** that family is skipped
   without failing the job.

---

### User Story 4 - High-churn regression proof (Priority: P1)

A maintainer can run an automated test that reproduces high-churn in-window generation and
proves total selected families stay under configured caps (count and/or bytes).

**Why this priority**: #849 showed age-only tests can go green while ops still explode; the
regression must encode the failure mode.

**Independent Test**: Synthetic temp roots only — never touch live `DB_PATH` / home logs.

**Acceptance Scenarios**:

1. **Given** a temp logs root with surplus migration logs all inside the age window, **When**
   the rotation module runs with default count cap, **Then** surviving migration count equals
   keepCount.
2. **Given** the same fixture with count cap disabled, **When** age-only mode runs, **Then**
   zero surplus deletions occur (documents the #849-class failure).
3. **Given** job result / logs, **When** inspected, **Then** no absolute filesystem paths to
   the operator data root are present.

### Edge Cases

- Missing directories for some families → skip family, continue others.
- Symlinks / path-traversal outside allowed logs roots → reject/skip (reuse path validation).
- Concurrent append during delete → soft-fail that file; continue.
- Zero-byte or unreadable files → eligible for cleanup when matched by family rules.
- Migration logs under `dirname(dbPath)/logs` vs `cwd/logs` / `~/.memento/logs` layout drift →
  resolve configured roots explicitly; do not recursive-wipe unknown trees.
- `docker-disk.log` and non-jsonl diagnostics siblings → included in byte-budget eligibility
  unless marked protected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `log_rotation` MUST clean more than `triple-extraction/`; it MUST cover at least
  migration logs, `docker-diagnostics/`, and `log-issue-monitor/` under resolved logs roots.
- **FR-002**: Migration log cleanup MUST apply a **count cap** (newest-N keep) in addition to
  any age rule; age-alone MUST NOT be the sole surplus control.
- **FR-003**: `docker-diagnostics/` cleanup MUST enforce a **total byte budget** for the
  directory (not only per-file max bytes).
- **FR-004**: Triple-extraction age retention MUST remain available and MUST NOT regress.
- **FR-005**: `log-issue-monitor/state.json` MUST be preserved; append-only monitor artifacts
  MUST have a documented retention/trim policy.
- **FR-006**: Cleanup failures for individual files MUST soft-fail; primary job success MUST
  not flip solely because one unlink failed when partial progress is possible.
- **FR-007**: Operator-facing reports and error strings from this job MUST NOT expose absolute
  data-root paths (basename / relative family labels only).
- **FR-008**: Caps MUST be overridable via clear constants or env (defaults documented);
  `keepCount <= 0` turns off count capping for tests that prove age-only failure.
- **FR-009**: Automated tests MUST reproduce high-churn in-window surplus and assert post-run
  bounds under default caps.
- **FR-010**: Cleanup MUST NOT delete the live database, backup trees, or unrelated non-log
  artifacts outside the selected families.

### Key Entities

- **Log family**: Named selector (triple-extraction | migration | docker-diagnostics |
  log-issue-monitor) with root path resolver and retention rules.
- **Retention policy**: Age days and/or keepCount and/or maxTotalBytes.
- **Rotation report**: Per-family deleted counts, bytes reclaimed, soft-fail warnings (no abs paths).

## Success Criteria *(mandatory)*

- **SC-001**: With default caps, a fixture of ≥1,000 in-window migration logs ends with
  ≤ keepCount survivors after one rotation.
- **SC-002**: A docker-diagnostics fixture above budget ends ≤ budget after one rotation.
- **SC-003**: Triple-extraction age behavior remains covered by passing unit tests.
- **SC-004**: Age-only / count-cap-off mode on an in-window surplus fixture deletes 0 surplus
  migration files (documents why count cap is required).
- **SC-005**: Job result / test assertions never require or print absolute `DB_PATH` / home
  log roots.

## Assumptions

- Defaults may be tuned without schema migrations (filesystem ops only).
- #851 (reducing migration log creation rate) remains out of scope; this issue bounds the
  backlog and ongoing growth via rotation.
- Live `~/.memento` cleanup of existing backlog happens by running the expanded job (or a
  one-shot invoke), not a separate destructive CLI — unless implementation discovers a safe
  preview mode is trivial to share with the job.

## Out of Scope

- Changing migration-runner to emit fewer logs per boot (#851).
- Remote log shipping / ELK.
- Recursive deletion of arbitrary unknown files under every `logs/` tree.
- Backup/quarantine retention (covered by #849/#850).

## Open Questions

| ID | Question | Status |
|----|----------|--------|
| Q1 | Wipe all of `logs/` recursively vs known families only? | Resolved — known families only |
| Q2 | Migration keepCount default? | Resolved — 500 newest |
| Q3 | docker-diagnostics byte budget? | Resolved — 256 MiB total |
| Q4 | log-issue-monitor policy? | Resolved — preserve `state.json`; trim jsonl by size/count |
| Q5 | Which filesystem roots? | Resolved — configured TE dir + `dirname(dbPath)/logs` + `~/.memento/logs/docker-diagnostics` & `log-issue-monitor` (or env overrides) |
| Q6 | Separate preview CLI? | Resolved — batch job primary; no new CLI required for MVP |

## Brainstorm Log

### 2026-09-06 — Session 1 (canonical auto-select)

User authorized Speckit pipeline for #852 with recommended auto-select.

- **Q1 Recommended**: Limit to known families — avoids deleting unrelated operator files.
- **Q2 Recommended**: `MIGRATION_LOG_KEEP_COUNT=500` — high churn like #849; age-alone fails.
- **Q3 Recommended**: `DOCKER_DIAGNOSTICS_MAX_TOTAL_BYTES=256MiB`; delete oldest rotated
  segments first; optionally tighten collector retain defaults as supporting change.
- **Q4 Recommended**: Keep `state.json`; cap/trim `occurrences.jsonl` & `monitor-errors.jsonl`
  (size and/or line/file retain). Missing dir = skip.
- **Q5 Recommended**: Resolve TE via existing logger; migration via `dirname(dbPath)/logs`
  matching `MigrationLogger`; diagnostics/monitor under `${MEMENTO_HOME:-~/.memento}/logs/...`
  with test overrides via injected roots.
- **Q6 Recommended**: Extend `runLogRotation` only for MVP; skip new npm cleanup CLI.

Status: **Brainstormed** — Open Questions = 0.
