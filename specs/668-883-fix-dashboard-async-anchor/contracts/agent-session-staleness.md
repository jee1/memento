# Contract: Agent session staleness

## Invariants

1. `selectSession(id)` increments `detailGeneration` and sets `selectedSessionId=id`.
2. Detail, injections, and timeline (including append) responses MUST be ignored when:
   - `responseGeneration !== state.detailGeneration`, or
   - `state.selectedSessionId !== requestSessionId`.
3. List `loadGeneration` behavior remains unchanged and independent.

## Non-contracts

- REST paths and JSON shapes unchanged.
- Provenance fetch may share the same generation or selectedSessionId check when
  launched from the selected session context.
