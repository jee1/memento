# Data Model: 668-883 (client state only)

No DB entities. Client panel state extensions:

## Review candidates (`__MEMENTO_REVIEW_CANDIDATES_PANEL__.state`)

| Field | Type | Purpose |
|-------|------|---------|
| `previewGeneration` | number | Incremented on each preview fetch start |
| `lastListFingerprint` | string | Last applied list fingerprint |
| `selectedCandidateIds` | Set (existing) | Bulk selection; prune on list diff |
| `selectedRow` | HTMLElement\|null (existing) | Current preview row |

Fingerprint format (stable): sorted `candidateId:priority:status:due_at` joined by `\n`.

## Agent sessions (`__MEMENTO_AGENT_SESSIONS_PANEL__.state`)

| Field | Type | Purpose |
|-------|------|---------|
| `loadGeneration` | number (existing) | List loads |
| `detailGeneration` | number (new) | selectSession / detail / injections / timeline |
| `selectedSessionId` | string\|null (existing) | Active session |

## Relationships

- Preview apply allowed iff `generation === previewGeneration` ∧ selected candidate id matches.
- Session render allowed iff `generation === detailGeneration` ∧ `selectedSessionId` matches request id.
