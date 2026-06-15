# Safe review queue cleanup

`memento review-queue cleanup` bulk-dismisses or expires accumulated `pending` review candidates without starting the server or applying migrations.

## Preview the target set

Dry-run is the default. This command counts candidates older than 30 days without changing the database:

```bash
memento review-queue cleanup \
  --older-than-days 30 \
  --expire
```

Use `--all-pending` to target every pending candidate. The JSON result includes the resolved database path, selector, action, target count, and updated count.

## Execute explicitly

After reviewing the dry-run output, repeat the same command with both confirmation flags:

```bash
memento review-queue cleanup \
  --older-than-days 30 \
  --expire \
  --execute \
  --yes
```

`--execute` without `--yes` is rejected. `--yes` without `--execute` is also rejected. The mutation runs in one transaction.

Exactly one selector is required: `--older-than-days <1..3650>` or `--all-pending`. Exactly one action is required: `--dismiss` or `--expire`.

The database path is resolved from `--db-path`, `DB_PATH`, then `~/.memento/memory.db`. The command requires the database file and migration 033 review queue schema to exist; it does not create or migrate them.
