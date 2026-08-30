# Feature Specification: LLM Provider Use-Case Override

**Feature Branch**: `jee1/feat-config-llm-provider-use-case-override-cross`
**Spec Directory**: `specs/658-llm-provider-use-case-override`
**Created**: 2026-08-27
**Status**: Implemented
**Input**: User description: "https://github.com/jee1/memento/issues/820"
**Issue**: [#820](https://github.com/jee1/memento/issues/820)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose a different LLM provider per memory job (Priority: P1)

An operator wants triple extraction, relation extraction, and procedural extraction to use different LLM providers when their deployment needs it (for example, one job on a cloud provider and another on a local provider), without changing global default behavior for other jobs.

**Why this priority**: This is the core capability requested in #820. Today only model names can be overridden per job; provider choice is inconsistent or hard-coded, so operators cannot steer cost, residency, or availability per job.

**Independent Test**: Configure a per-job provider for one of the three in-scope jobs, leave others unset, run that job, and verify it uses the configured provider while unset jobs still follow the global default.

**Acceptance Scenarios**:

1. **Given** a global default provider is set and no per-job provider overrides are set, **When** triple extraction, relation extraction, or procedural extraction runs, **Then** each job uses the global default provider selection path (same effective behavior as before this feature).
2. **Given** a per-job provider override is set for triple extraction only, **When** triple extraction runs, **Then** that job prefers the overridden provider (FR-017); if that provider is available, it is the runtime provider.
3. **Given** a per-job provider override is set for relation extraction or procedural extraction, **When** that job runs, **Then** it prefers the overridden provider (FR-017); if that provider is available, it is the runtime provider.
4. **Given** per-job overrides are unset, **When** an operator upgrades to a version that includes this feature, **Then** existing deployments require no configuration change to keep prior behavior.

---

### User Story 2 - Stop wrong-provider model names after fallback (Priority: P1)

An operator has set a per-job model override that belongs to one provider. If the system falls back to a different provider, the job must not send the original model name to the fallback provider (which currently causes failed calls).

**Why this priority**: This is a correctness defect paired with the feature. Without the guard, per-job model overrides remain unsafe whenever provider fallback occurs.

**Independent Test**: Configure a job-specific model name for provider A, force or simulate fallback to provider B, and verify the job does not use provider A's model name against provider B.

**Acceptance Scenarios**:

1. **Given** a job-specific model override bound to provider A (via job provider override, or via global default when no job provider override is set), **When** the runtime provider for that job becomes provider B (fallback or override mismatch), **Then** the system does not apply that model override to provider B and uses provider B's default model selection instead.
2. **Given** the runtime provider still matches the bound provider for the model override, **When** the job runs, **Then** the job-specific model override still applies.

---

### User Story 3 - Local provider readiness when only a job asks for it (Priority: P2)

An operator configures only one job to use a local LLM provider while the global default remains a cloud provider. That local provider must be prepared for use when the job needs it.

**Why this priority**: Without readiness for job-scoped local provider selection, overrides that point at the local provider fail at runtime even though configuration looks valid.

**Independent Test**: Set global default to a cloud provider, set one in-scope job to the local provider, start the system, and verify that job can obtain a usable local-provider client path (connection readiness is performed when any in-scope job override selects the local provider).

**Acceptance Scenarios**:

1. **Given** at least one in-scope job override selects the local provider, **When** the system initializes LLM clients, **Then** local-provider readiness checks run even if the global default is not the local provider.
2. **Given** no job override and no global selection requires the local provider, **When** the system initializes, **Then** local-provider readiness behavior remains as today (no new mandatory local connection when unused).

---

### User Story 4 - Discover and document the new settings (Priority: P3)

An operator needs documented, discoverable settings for the three in-scope job provider overrides alongside existing model override documentation.

**Why this priority**: Configuration without docs causes misconfiguration and support load; docs can ship with the same change set but are secondary to runtime behavior.

**Independent Test**: Review operator-facing example configuration and Korean/English provider configuration guides for the three new provider override settings and the fallback/model-binding rule.

**Acceptance Scenarios**:

1. **Given** an operator opens the example environment configuration and the Korean/English LLM provider guides, **When** they look for per-job provider controls, **Then** the three in-scope override settings, the “unset / empty means global default” rule, invalid-value→global-with-warning (warn at load/init), and prefer-then-fallback (not hard-pin) behavior are described.
2. **Given** the same docs, **When** they look for the model-override fallback rule, **Then** docs state that a model override is bound to the preferred provider (job override if set, else global default), must not be applied after the runtime provider changes away from that bound provider, and that such a discard is observable (log/telemetry) without alone failing the job.

---

### Edge Cases

- Invalid or unrecognized per-job provider values: system MUST NOT crash the primary memory path; MUST treat the value as unset for that job (fall through to the global default selection path) and emit an observable warning (config/stderr or structured log).
- Empty string or whitespace-only per-job provider override: MUST be treated as unset (same as omitting the setting).
- Job override set to a provider that has no credentials or is unavailable: system MUST follow the existing provider-failure / fallback policy for that job only; unrelated jobs MUST continue. If fallback changes the runtime provider, FR-004 (model-binding) MUST still apply.
- Model override present but provider override absent: the model preference is bound to the **global default provider as resolved for that invocation**; if runtime provider later diverges (fallback), User Story 2 / FR-004 applies and the mismatched model name MUST NOT be sent.
- Explicit provider override present: the model preference is bound to that overridden provider (not the global default).
- Multiple jobs override to different providers in one process: each job MUST resolve its own provider independently; no shared mutable “last provider wins” state across jobs.
- Concurrent / overlapping job runs in one process: provider and model resolution MUST be per-invocation (no cross-job contamination of resolved provider or model).
- Provider token casing / surrounding whitespace: per-job provider values MUST be normalized the same way as the existing global LLM provider setting (trim + lowercase canonical ids such as `openai` / `gemini` / `ollama`) before validity checks; after normalization, unknown tokens follow FR-010.
- Job provider override equal to the global default: MUST be accepted as a valid no-op preference (still that provider for binding and readiness); MUST NOT be treated as invalid.
- Invalid-value warning timing: the observable warning for an invalid per-job provider preference MUST be emitted at configuration load / process initialization (once per invalid setting), not repeatedly on every job invocation.
- Configuration change after process start: new or changed per-job provider preferences take effect on the same basis as other LLM env settings today (typically process restart); this feature MUST NOT require a new hot-reload mechanism.
- Empty or whitespace-only per-job **model** preference: MUST be treated as unset for that job’s model override (parity with FR-012 for provider preferences), without inventing a new model-name validation scheme beyond existing behavior.
- FR-004 model discard: when a per-job model preference is not applied because runtime provider ≠ bound provider, the system MUST make that decision observable via structured log or equivalent (at most once per job invocation); it MUST NOT fail the job solely because the model preference was discarded if a default model path for the runtime provider succeeds.
- Job provider override vs fallback chain: a valid per-job provider preference MUST act as that job’s **preferred** provider (same role as a global `LLM_PROVIDER` preference for that job), then the existing provider-failure / fallback policy applies (FR-011) — not a hard pin that invents a new “never fallback” mode.
- Local-provider readiness failure when only a job override selected local: MUST follow the existing local-provider unavailable / fallback behavior for that job; MUST NOT crash the primary MCP/memory response path solely because job-scoped readiness failed.
- Model name that is invalid for its **bound** provider (e.g. a cloud model id with a local bound provider, when runtime still equals bound): this feature MUST NOT invent a new model↔provider compatibility validator; existing provider-client / model-selection failure behavior applies. FR-004 only guards cross-provider reuse after runtime provider diverges from bound.
- Consolidation summarization and personal-agent LLM settings: out of scope; behavior MUST remain unchanged by this feature.
- Security surface: this feature adds env/config keys only; it MUST NOT introduce new auth endpoints, request-body provider selection, or secrets beyond existing provider credential env vars.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Operators MUST be able to set a provider preference independently for each of these jobs: triple extraction, relation extraction, and procedural extraction.
- **FR-002**: When a job’s provider preference is unset, that job MUST use the same global provider selection behavior as before this feature (backward compatible default).
- **FR-003**: When a job’s provider preference is set and valid, that job MUST treat it as the preferred provider for its LLM path (FR-017). Availability failures MUST follow FR-011; model application after any provider change MUST follow FR-004.
- **FR-004**: Per-job model preferences MUST only apply when the runtime provider for that job equals the **bound provider** for that preference; if the runtime provider differs, the system MUST use that provider’s default model selection instead of the mismatched model name. Binding rule: if a per-job provider preference is set and valid, the bound provider is that preference; otherwise the bound provider is the global default provider resolved for that invocation.
- **FR-005**: If any in-scope job provider preference selects the local LLM provider, system initialization MUST perform local-provider readiness checks even when the global default provider is not local.
- **FR-006**: Operator-facing example configuration and Korean/English LLM provider configuration guides MUST document the three new provider preferences, the unset→global rule (including empty/whitespace as unset), invalid-value→global-with-warning behavior (including that warnings are at load/init), canonical token casing expectations, prefer-then-fallback (FR-017, not hard-pin), the model-binding rule in FR-004, and that FR-004 model discard is observable (FR-016) without alone failing the job.
- **FR-007**: This feature MUST NOT change consolidation summarization’s provider selection path or personal-agent’s separate provider namespace.
- **FR-008**: This feature MUST NOT change embedding-provider selection; embedding remains a separate configuration axis.
- **FR-009**: Existing public MCP tool contracts and stable API request/response shapes MUST remain unchanged (configuration-only change).
- **FR-010**: Unrecognized or otherwise invalid per-job provider preference values MUST be treated as unset for that job (global default path) with an observable warning; they MUST NOT abort process startup or the primary MCP/memory response path.
- **FR-011**: When a valid per-job provider preference selects a provider that is unavailable or lacks credentials, the system MUST apply the existing provider-failure / fallback policy scoped to that job; if fallback yields a different runtime provider, FR-004 MUST apply.
- **FR-012**: Empty or whitespace-only per-job provider preference values MUST be treated as unset (equivalent to omitting the preference).
- **FR-013**: Per-job provider preference tokens MUST be normalized consistently with the existing global LLM provider setting (trim and lowercase canonical identifiers) before validity checks; after normalization, values outside the supported provider set are invalid per FR-010.
- **FR-014**: The observable warning required by FR-010 MUST be emitted at configuration load / process initialization at most once per invalid per-job provider preference setting (not on every subsequent job invocation).
- **FR-015**: Empty or whitespace-only per-job model preference values MUST be treated as unset for that job (no model override applied), consistent with FR-012’s empty-as-unset rule for provider preferences.
- **FR-016**: When FR-004 discards a per-job model preference because the runtime provider differs from the bound provider, the system MUST record an observable structured log (or equivalent) at most once per job invocation; discarding the model preference alone MUST NOT fail the job if the runtime provider’s default model path can proceed.
- **FR-017**: A valid per-job provider preference MUST select the preferred provider for that job’s LLM path (analogous to the global provider preference for that job only); subsequent unavailability MUST follow FR-011 — this feature MUST NOT introduce a separate hard-pin / never-fallback mode.
- **FR-018**: If local-provider readiness required by FR-005 fails, the system MUST apply the existing local-provider unavailable / fallback behavior for affected jobs and MUST NOT abort the primary MCP/memory response path solely due to that readiness failure.
- **FR-019**: This feature MUST NOT introduce a new model-name ↔ bound-provider compatibility validator. When runtime provider equals the bound provider, an unsuitable model name for that provider follows existing provider-client / model-selection failure behavior. FR-004 applies only when runtime provider diverges from bound.

### Key Entities

- **LLM job (use case)**: A distinct memory-pipeline job that may call an LLM — in scope: triple extraction, relation extraction, procedural extraction.
- **Global provider preference**: The deployment-wide default provider selection used when a job has no override.
- **Per-job provider preference**: Optional override of the global provider for one job; empty/whitespace and invalid values (after normalization) are treated as unset.
- **Per-job model preference**: Existing optional model name override for a job; bound to the effective preferred provider per FR-004 and unsafe to reuse after provider change; empty/whitespace treated as unset.
- **Bound provider**: The provider a job’s model preference is considered valid for — either the valid per-job provider preference or, if absent, the global default at resolution time.
- **Runtime provider**: The provider actually used for a given job invocation after override resolution and any fallback.
- **Canonical provider token**: A normalized provider identifier after trim/lowercase (e.g. `openai`, `gemini`, `ollama`) matching the product’s existing supported LLM provider set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the three in-scope jobs, an operator can select a distinct provider via configuration and observe that job using the selected provider in a single verification run per job.
- **SC-002**: With all per-job provider preferences unset, a regression suite (or equivalent checklist of the three jobs) shows no change in effective provider selection versus the pre-feature baseline.
- **SC-003**: In 100% of tested fallback / provider-mismatch cases with a job-specific model preference present, the mismatched model name is not sent to the fallback provider (automated verification required).
- **SC-004**: When exactly one in-scope job prefers the local provider and the global default does not, that job completes an LLM call path against the local provider after startup without requiring the operator to set the global default to local.
- **SC-005**: A new operator can locate the three provider preferences and the model-binding rule in example config plus Korean and English guides within 5 minutes without reading source code.
- **SC-006**: Consolidation and personal-agent provider behavior remain identical to pre-feature baselines in a focused smoke comparison.
- **SC-007**: In automated tests of FR-004 discard paths, at least one observable log/telemetry signal is present when a mismatched model preference is withheld, and the job still completes when the runtime provider’s default model path succeeds.

## Assumptions

- Proposal A from #820 is in scope: mirror the existing per-job *model* override pattern with per-job *provider* overrides for the three jobs above; the denser “job × provider model matrix” (proposal B) is deferred.
- Operator-facing setting identifiers will follow the same naming family as existing per-job model overrides (triple / relation / procedural), as described in #820.
- “Local provider” means the deployment’s Ollama-class local LLM endpoint already supported by the product.
- Client construction for cloud providers that already have credentials does not need a new operator-facing init step; only local-provider readiness needs the job-override-aware gate (FR-005).
- No database migration or persisted schema change is required; this is configuration and call-path consistency only.
- Constitution constraints apply: Test-First for the model-binding guard (Principle I), backward-compatible defaults (Principle II), lint/type-check/test and graphify gates before completion (Principle IV), and graceful/observable failure on provider errors where possible (Principle V).
- Brainstorm (2026-08-27): model binding, invalid/empty provider handling, and unavailable-override behavior are decided as recorded in Open Questions Q1–Q4 (all Resolved).
- Brainstorm session 2 (2026-08-27): provider token normalization, invalid-warning timing, restart-only config effect, job-override-equals-global no-op, and empty model override are decided as recorded in Open Questions Q5–Q9 (all Resolved).
- Brainstorm session 3 (2026-08-27): FR-004 discard observability, preferred-then-fallback (no new hard-pin), and job-scoped local readiness failure are decided as recorded in Open Questions Q10–Q12 (all Resolved).
- Brainstorm session 4 (2026-08-27): Closure self-review — FR-003 aligned with FR-017; FR-006 docs cover prefer-then-fallback + discard observability; no new model↔provider name validator (FR-019 / Q13). Further brainstorm **closed** — proceed to `/speckit.plan` only.
- Supported canonical LLM provider tokens for this feature are the same set already accepted for the global LLM provider setting (no expanded provider catalog in this feature).
- Per-job provider preferences do not introduce hot-reload; operators change them the same way they change other LLM env settings today (process restart unless an existing mechanism already reloads env).

## Out of Scope

- Refactoring consolidation summarization onto the shared LLM client path (separate issue).
- Unifying personal-agent’s dedicated provider namespace into the shared override map (separate issue).
- Embedding provider configuration.
- Proposal B (per job × per provider model matrix).
- Changing MCP tool schemas or HTTP admin APIs for provider selection (env/config only unless a later issue expands surface).

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | When only a per-job model override is set (no provider override), which provider is that model considered “bound” to for FR-004? | Resolved | Bound to the **global default provider resolved for that invocation**. Explicit valid job provider override binds the model to that override instead. (Option A; user confirmed “추천대로”.) |
| Q2 | Invalid / unrecognized per-job provider values: reject at config load, or ignore and fall through to global? | Resolved | **Ignore as unset** + observable warning; fall through to global. Do not abort startup / primary path. (FR-010.) |
| Q3 | Job override points at a provider that is unavailable: hard-fail that job’s LLM path, or fall back to the global provider selection path? | Resolved | **Follow existing provider-failure / fallback policy** for that job only; if runtime provider changes, apply FR-004. (FR-011.) |
| Q4 | Empty string / whitespace-only provider override: treat as unset (global), or as invalid? | Resolved | Treat as **unset** (same as omitting). (FR-012.) |
| Q5 | How should casing / whitespace in per-job provider tokens be handled? | Resolved | **Normalize like global LLM provider** (trim + lowercase canonical ids) before validity checks; unknown after normalize → FR-010. (FR-013.) |
| Q6 | When should the FR-010 invalid-provider warning fire? | Resolved | **Once at config load / process init** per invalid setting — not on every job invocation. (FR-014.) |
| Q7 | Do mid-process env changes to per-job provider overrides take effect without restart? | Resolved | **No new hot-reload**; same restart (or existing reload) semantics as other LLM env settings. |
| Q8 | What if a job provider override equals the global default? | Resolved | **Valid no-op** — accepted; still that provider for binding/readiness; not treated as invalid. |
| Q9 | Empty / whitespace-only per-job model override? | Resolved | Treat as **unset** (no model override), parity with FR-012. (FR-015.) |
| Q10 | Should FR-004 model discard be silent or observable? | Resolved | **Observable** structured log ≤1× per job invocation; discard alone does not fail job if default model path works. (FR-016, SC-007.) |
| Q11 | Does job provider override hard-pin with no fallback, or prefer-then-fallback? | Resolved | **Prefer-then-fallback** (same role as global provider pref for that job); FR-011; no new hard-pin mode. (FR-017.) |
| Q12 | Local readiness fails when only a job selected local — crash or existing unavailable path? | Resolved | **Existing unavailable/fallback** for that job; do not abort primary MCP/memory path. (FR-018.) |
| Q13 | Does FR-004 (or this feature) validate that a model name is suitable for its bound provider when runtime still equals bound? | Resolved | **No new validator** — existing client/model-selection failure applies; FR-004 only when runtime ≠ bound. (FR-019.) |

## Brainstorm Log

### 2026-08-27 — Initial Brainstorm Session

**Categories explored**: Boundary conditions, Error scenarios, Scale & performance, Security & privacy, User experience

**Mode**: User directed “추천대로 진행” after Q1 recommendation; remaining Q2–Q4 and light category pass applied with recommended resolutions.

**Key insights**:

1. **Model binding without provider override** — Bind to global default at resolution time (not “unguarded model-only”, not Proposal B inference). Clarifies FR-004 and User Story 2 for the common model-only config path.
2. **Invalid provider values** — Prefer degrade-to-global with warning over hard reject at load, preserving primary memory path and Principle V observability.
3. **Unavailable overridden provider** — Reuse existing fallback/failure policy per job; do not invent a new hard-fail-only rule; FR-004 still guards model names after fallback.
4. **Empty/whitespace** — Treat as unset to match common env-config operator mistakes and document alongside unset→global.
5. **Scale** — Per-invocation resolution; no new rate limits; concurrent jobs must not share resolved provider/model state.
6. **Security** — Env/config-only surface; no new request-body provider selection or auth endpoints.
7. **UX/docs** — FR-006 expanded to cover empty=unset, invalid→global+warning, and bound-provider definition.

**New / updated requirements**: FR-004 clarified; FR-010, FR-011, FR-012 added; FR-006 expanded; Key Entity **Bound provider** added.

**New / updated edge cases**: invalid→warn+global; empty=unset; binding with/without provider override; concurrent per-invocation isolation; security surface note.

**Open questions**: Q1–Q4 all Resolved. No remaining Open items.

### 2026-08-27 — Session 2 (deeper edge cases)

**Skipped**: Categories already covered in Session 1 (boundary/error/scale/security/UX high-level). Focus: residual ambiguity under those categories.

**Mode**: User re-ran brainstorm with “추천대로 진행”; recommendations applied without further interview.

**Key insights**:

1. **Token normalization** — Align per-job provider parsing with existing global `LLM_PROVIDER` canonicalization (trim + lowercase) to avoid `OpenAI` vs `openai` false-invalids.
2. **Warning spam** — FR-010 warnings at init once per bad setting; avoid per-invocation log flood under Principle V.
3. **No hot-reload scope creep** — Restart-same-as-today; do not invent config watchers for this feature.
4. **Override == global** — Valid no-op; still drives binding/readiness consistently.
5. **Empty model override** — Parity with empty provider: unset, don’t invent new model validation.

**New / updated requirements**: FR-013, FR-014, FR-015; Assumptions updated; Key Entity **Canonical provider token** added.

**New / updated edge cases**: normalization; override==global; warning timing; restart-only; empty model override.

**Open questions**: Q5–Q9 Resolved. Table has no Open items.

### 2026-08-27 — Session 3 (observability & fallback semantics)

**Skipped**: Session 1–2 categories and Q1–Q9. Focus: leftover semantic holes around FR-004/FR-005/FR-011.

**Mode**: User re-ran brainstorm with “추천대로 진행”; recommendations applied. Declared further brainstorm **low value** — proceed to plan.

**Key insights**:

1. **FR-004 discard observability** — Silent discard hides operator debugging; log ≤1×/invocation; don’t fail job solely for discard.
2. **Prefer-then-fallback** — Job override mirrors global preferred-provider semantics for that job; no new hard-pin mode (YAGNI).
3. **Job-scoped Ollama readiness failure** — Reuse existing unavailable path; protect primary MCP/memory path (Principle V).

**New / updated requirements**: FR-016, FR-017, FR-018; SC-007.

**New / updated edge cases**: model-discard observability; prefer-then-fallback; job-scoped local readiness failure.

**Open questions**: Q10–Q12 Resolved. **No Open items. Spec Ready for `/speckit.plan`.**

### 2026-08-27 — Session 4 (closure self-review)

**Skipped**: All prior category deep-dives (Sessions 1–3). Focus: Spec Self-Review only (placeholders, consistency, scope, ambiguity).

**Mode**: User re-ran brainstorm with “추천대로 진행”; recommendation was already “stop → plan”. Applied surgical consistency fixes only; **brainstorm phase closed**.

**Key insights**:

1. **FR-003 ↔ FR-017** — “MUST request” read as hard-pin; reworded to preferred-provider + FR-011/FR-004 so US1 acceptance matches prefer-then-fallback.
2. **Docs completeness** — FR-006 / US4 now require prefer-then-fallback and FR-016 discard observability in operator guides.
3. **Model name on matching bound provider** — FR-004 must not be misread as a model↔provider catalog check; FR-019 / Q13 defer to existing client failure paths.
4. **Closure** — No remaining Open items; additional brainstorm sessions add noise, not clarity. Next command: `/speckit.plan`.

**New / updated requirements**: FR-003 clarified; FR-006 expanded; FR-019 added; US1 scenarios 2–3 and US4 scenarios aligned.

**New / updated edge cases**: unsuitable model for bound provider when runtime == bound (no new validator).

**Open questions**: Q13 Resolved. **Brainstorm closed. Spec Ready for `/speckit.plan`.**
