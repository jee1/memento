# Contract: phone mask digit boundaries

**Owner**: `@memento/core` `PIIMasker`
**Stable placeholder**: `[PHONE]` (unchanged)

## Must preserve (no `[PHONE]`)

- `mem_<13digitEpoch>_<alnum>`
- `search_<13digitEpoch>_<alnum>`
- `failure_*_<13digitEpoch>`
- strings like `포트 18000 및 1234567890`
- filesystem paths embedding epoch-ms digit runs

## Must mask

- `010-1234-5678`, `01012345678`
- `+82-10-1234-5678` (and spaced/dotted variants matching Korean mobile)
- international `+1-234-567-8900`-style when phone types enabled

## Non-contract

- Exact regex source text (implementation detail)
- agent-integration redaction rule identity
