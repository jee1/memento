# Research: #854 PIIMasker phone boundary

## R1 — Why epoch always matches

Current pattern (approx): `(\+82[-.\s]?)?0?1[0-9][-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}`

- Optional `0` → any digit run starting with `1` of sufficient length matches.
- No `(?<![0-9])` / `(?![0-9])` → matches **inside** longer digit runs.
- Epoch-ms ≈ 13 digits starting `17` → always consumes 10 digits → `[PHONE]` + remainder.

Decision: adopt issue-proposed Korean pattern with mandatory `01x` or `+82…1x` and digit lookarounds.

## R2 — International pattern

`/\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g` requires `+` but lacks trailing digit boundary → can truncate long digit tails after a `+…` prefix if ever present. Add `(?![0-9])` (and leading `(?<![0-9])` if safe).

## R3 — agent-integration vs core

agent-integration uses separator-required US-style lookaround. Core must keep Korean compact forms (`01012345678`) and `[PHONE]` placeholder API. Align **boundary philosophy** only; do not replace with agent rule.

## R4 — Blast radius

Call sites (`logger`, `db-integrity-preflight`, `migration-history-service` `maskError`, `triple-extraction-logger`) all benefit from single util fix. No per-call-site patches.

## Alternatives rejected

| Alt | Why rejected |
|-----|----------------|
| Disable phone masking in logger | Weakens PII; Non-Goal |
| Exclude known ID prefixes via allowlist | Fragile; new ID shapes keep breaking |
| Copy agent-integration regex verbatim | Drops Korean compact / `+82` forms |
| Repair persisted migration history | Non-Goal Q4 |
