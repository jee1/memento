# Contract: FTS query combinator (#807)

**Feature**: `specs/660-807-fts-or-prefix`  
**Audience**: Implementers of `buildFTSQuery` / reviewers  
**Stability**: Internal search contract (not a public MCP schema). Behavior change is intentional for quality; **request/response shapes stay unchanged** — see [mcp-search-schema-unchanged.md](./mcp-search-schema-unchanged.md).

## Input

| Input | Precondition |
|-------|----------------|
| `query: string` | Raw user/agent search string |

## Processing pipeline

1. `preprocessQuery(query)`  
   - Trim / collapse whitespace  
   - Replace non `[a-zA-Z0-9가-힣\s]` with space  
   - Drop stopwords  
2. Split on spaces → `words[]`  
3. If `words.length === 0` → return `""`  
4. Map each word → FTS term:  
   - if `word.length >= FTS_MIN_PREFIX_STEM_LENGTH` (2) → `word + '*'`  
   - else → `word`  
5. Combinator:  
   - **Short** (`words.length <= FTS_OR_ABOVE_TOKEN_COUNT`): `terms.join(' OR ')`  
   - **Long** (`words.length > FTS_OR_ABOVE_TOKEN_COUNT`): `terms.slice(0, FTS_MAX_TOKENS_FOR_OR).join(' OR ')`  
6. `makeFTSSafe(combined)` — must **preserve** trailing `*` and the substring ` OR `

## Output examples

| Raw query (illustrative) | After preprocess (illustrative) | MATCH string (illustrative) |
|--------------------------|---------------------------------|-------------------------------|
| `검색 랭킹 가중치 튜닝` | 4 content words | `검색* OR 랭킹* OR 가중치* OR 튜닝*` |
| `a` (1-char) | `a` | `a` (no `*`) |
| `가중치` | `가중치` | `가중치*` |
| (empty / stopwords only) | ∅ | `""` |

## Invariants

- Filters and SQL `LIMIT` / candidate caps unchanged.  
- Same function used for all transports that share the builder (FR-020).  
- No user-controlled `AND`/`OR`/`NEAR`/quotes as operators.

## Observability

Compare pre/post using existing funnel field `text_candidate_count` (and related). Do not add a new MCP telemetry key in this feature.
