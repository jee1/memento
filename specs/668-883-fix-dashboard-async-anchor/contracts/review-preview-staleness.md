# Contract: Review preview staleness

## Invariants

1. Completing a memory preview fetch MUST NOT mutate preview DOM unless:
   - `request.previewGeneration === state.previewGeneration`, and
   - `request.candidateId === state.selectedRow.dataset.candidateId`.
2. Review/Dismiss enabled state and POST `candidate_id` MUST equal the current
   selected row’s `data-candidate-id`.
3. List re-render MUST restore selection/bulk for IDs still present; MUST clear
   selection/preview for removed IDs.
4. Poll/SSE apply MUST run when list fingerprint changes, not only when
   `candidates.length` increases.

## Non-contracts

- Server response schema unchanged.
- Toast/OS notify still keyed off pending-count growth.
