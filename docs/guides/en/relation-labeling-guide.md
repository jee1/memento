# Relation Labeling Guide

## The Role of Relation Extraction

When a new memory is saved, Memento automatically extracts semantic connections between it and existing memories. These connections are stored as typed, directed edges in a relation graph. They improve search ranking and make it possible to surface related memories together. Relation extraction uses both a rule-based engine and an LLM-based engine working in combination, and each extracted relation carries a confidence score alongside its type.

This guide explains when each relation type applies and how to reason about confidence scores.

## Relation Types

Memento's core type system defines six relation types. Each type belongs to a semantic category and carries a different weight in search ranking.

| Type | Category | Meaning | Ranking Weight |
|-----|---------|---------|---------------|
| `CAUSES` | Causal | Cause-and-effect | 1.2 |
| `DEPENDS_ON` | Structural | Dependency / prerequisite | 1.1 |
| `FOLLOWS` | Temporal | Sequential order | 1.0 |
| `BELONGS_TO` | Structural | Containment / membership | 1.0 |
| `CONTRASTS_WITH` | Semantic | Contrast or opposition | 0.9 |
| `REFERENCES` | Semantic | Citation or mention | 0.8 |

Procedural memories additionally use a `VERSION_OF` relation to link the previous version of a procedure to the current one.

Beyond these defined types, the LLM-based extraction engine can also produce free-form relations based on textual context when none of the named types are a good fit.

## Criteria for Each Type

### CAUSES (causal)

Use `CAUSES` when one memory directly explains the origin of another. Textual signals include phrases like "because of", "as a result of", "therefore", and "led to". There must also be a clear temporal direction — the cause precedes the effect.

For example, "Project timeline delayed" causing "Decision to bring in additional developers" is a clean `CAUSES` relationship.

### DEPENDS_ON (structural dependency)

Use `DEPENDS_ON` when one memory cannot exist or be executed without another. This covers both technical dependencies (a library requirement, a schema prerequisite) and logical dependencies (a prerequisite decision, foundational knowledge). Signals include "requires", "depends on", "is based on", and "is a prerequisite for".

"Database schema design" and "Backend API development" form a `DEPENDS_ON` relationship because the API cannot be built without the schema.

### FOLLOWS (temporal order)

Use `FOLLOWS` when two memories exist in a time sequence, but the relationship is not necessarily causal. FOLLOWS expresses "what came before" and "what came after" without implying that the first caused the second. Signals include "after", "next", "subsequently", and "following".

### BELONGS_TO (containment)

Use `BELONGS_TO` when one memory is part of or belongs to another. This represents hierarchical structure or set membership. A canonical example is "Login feature" belonging to "Authentication module".

### CONTRASTS_WITH (semantic contrast)

Use `CONTRASTS_WITH` when two memories represent opposing concepts or alternative approaches. Signals include "but", "whereas", "in contrast", and "unlike". This type works well when memories compare options or present different viewpoints.

### REFERENCES (citation)

Use `REFERENCES` when one memory explicitly mentions or cites another. Signals include "see", "refer to", "as mentioned in", and "based on". This is also a reasonable fallback for loose associations that don't clearly fit any other type.

## Confidence Scores

Confidence ranges from 0.0 to 1.0 and represents how certain the extracted relation is.

| Range | Interpretation |
|-------|---------------|
| 0.9 - 1.0 | Certain. No room for doubt. |
| 0.8 - 0.89 | High confidence. Explicit signals present. |
| 0.7 - 0.79 | Above average. Likely correct, slight uncertainty. |
| 0.6 - 0.69 | Reasonable. Some inference required. |
| 0.5 - 0.59 | Weak. Considerable uncertainty. |
| 0.0 - 0.49 | Doubtful. Consider excluding. |

Factors that increase confidence include explicit keywords or phrases, temporal or spatial proximity, repeated mentions, and expert validation.

Factors that decrease confidence include the need for inference, ambiguous language, alternative interpretations, and large time gaps between events.

The guiding principle is conservative assignment: when in doubt, use a lower score. Reserve high scores for cases with clear, explicit evidence.

## Labeling Examples

### Project management scenario

"Project plan finalized" followed by "Development environment setup begins" represents a clear temporal sequence, making `FOLLOWS` appropriate at confidence 0.85.

"Project timeline delayed" leading to "Decision to bring in additional developers" is a direct cause-and-effect: `CAUSES` at confidence 0.8.

"Database schema design" and "Backend API development" show a hard dependency: `DEPENDS_ON` at confidence 0.9.

### Technical documentation scenario

"Adopting microservice architecture" and "Evaluating monolithic architecture" are directly contrasting approaches: `CONTRASTS_WITH` at confidence 0.85.

"React component design document" and "Component implementation guide" form a reference relationship where the guide cites the design document: `REFERENCES` at confidence 0.75.

"Login feature" and "Authentication module" show clear containment: `BELONGS_TO` at confidence 0.9.

## Labeling Checklist

Reviewing these points before assigning a relation improves quality:

- Is the direction correct? Relations flow from source to target.
- Could a different type represent the relationship more precisely?
- Does the confidence score reflect the actual level of certainty?
- Is this a self-referential relation (same memory pointing to itself)?
- Does the confidence exceed what the available evidence justifies?

## Related Documentation

- [Relation Type Definitions](../../../packages/memento-core/src/shared/types/relation.ts)
- [LLM Provider Configuration Guide](./llm-provider-configuration.md)
