# Data Model: 666-860

이번 기능은 신규 엔티티/스키마 없음. 기존 SQLite bootstrap(`initializeDatabase`) 재사용.

| Concept | Notes |
|---------|--------|
| DB file | Path from `DB_PATH` or product default; created/migrated by existing init |
| Install root | npm package directory where postinstall runs |
| Smoke override | Ephemeral `DB_PATH` for pack verification only |
