# Issue 209 Design: Release `git 128` Root-Cause Confirmation and Recurrence Prevention

## 1) Context and Goal

### Problem
CI release workflow intermittently fails with `/usr/bin/git` exit code `128`.  
At the same time, Node 20 deprecation warnings are visible in GitHub Actions, but that is not the immediate failure root cause for this issue.

### In-scope
- Confirm and isolate root-cause category for `git 128` in release workflow.
- Add minimal, low-risk recurrence-prevention changes in release workflow.
- Keep normal release/publish behavior intact.

### Out-of-scope
- Full Node 24 migration across all workflows.
- Broad refactor of CI workflows outside release root-cause track.

## 2) Scope and Architecture Boundary

- Primary target file: `.github/workflows/release.yml`
- Secondary workflow files (`ci.yml`, `security-check.yml`, `relation-engine.yml`) are reference-only in this issue.
- Strategy:
  1. Increase observability at checkout/ref/tag/permission boundaries.
  2. Add fail-fast validations before side-effect steps.
  3. Keep default logs minimal; enable detailed diagnostics conditionally.

## 3) Approach Options and Selection

### Option 1: Minimal observability only
- Add checkout fetch options and small context logs.
- Pros: Lowest change volume.
- Cons: Might still require second patch for permission/API edge cases.

### Option 2: Balanced observability + guardrails (**Selected**)
- Option 1 plus explicit minimal permissions and preflight checks for tag/API context.
- Pros: Covers major `git 128` root-cause families in one pass, still minimal risk.
- Cons: Slightly more workflow lines changed.

### Option 3: Deep forensic mode
- Option 2 plus failure artifact packaging for heavy diagnostics.
- Pros: Best RCA speed on recurrence.
- Cons: Extra complexity and maintenance overhead.

## 4) Component Design (Workflow Segments)

### C1. Source acquisition
- Keep `actions/checkout`, but make tag/history assumptions explicit (`fetch-depth`, `fetch-tags` policy).
- Immediately validate repository state after checkout:
  - shallow/full clone status
  - visible tag refs

### C2. Release context normalization
- Normalize event/ref/tag derivation path for:
  - `release` event
  - `workflow_dispatch` event
- Fail fast when tag cannot be resolved or is malformed.

### C3. Permission and remote access preflight
- Explicitly declare required permissions at workflow/job level (principle of least privilege, but sufficient for release operations).
- Before release API-dependent logic, print safe response metadata (status class), not sensitive content.

### C4. Existing release business flow (preserve)
- Keep current behavior for:
  - dependency install/build/test
  - version extraction/update
  - npm publish
  - release existence check/create or skip
- Only inject guardrails and diagnostics around failure-prone boundaries.

### C5. Conditional debug diagnostics
- Default: compact logs only.
- Debug mode enabled by explicit flag (for manual rerun/incident response), then emit detailed git/ref/API diagnostics.

## 5) Data Flow Design

1. Trigger enters via `release.published` or `workflow_dispatch`.
2. Checkout executes with explicit fetch policy.
3. Repository integrity/context preflight runs.
4. Event-to-tag normalization derives `TAG_NAME`.
5. Permission/API preflight validates remote readiness.
6. Existing release path executes (build/test/version/publish/release).
7. On failure, step-local error prefix and diagnostics identify failure family quickly.

## 6) Error Handling and Guardrails

### Fail-fast rules
- Missing or unresolved tag => immediate failure.
- Invalid API preflight response => immediate failure.
- Missing required secrets (`NPM_TOKEN`, etc.) => immediate failure (existing checks preserved).

### Error family prefixes
- `E_CHECKOUT_CONTEXT`
- `E_TAG_RESOLUTION`
- `E_GH_API_ACCESS`
- `E_NPM_AUTH`

Each failure message should include one prefix so responders can classify issue source without reading full logs.

### Logging policy
- Default path: minimum meaningful observability.
- Debug path: conditional expanded logs only.
- Never print secret values.

## 7) Validation and Test Plan

### Static verification
- Workflow syntax consistency and expression validity.
- Output variable chain consistency (step outputs and downstream references).

### Runtime verification (manual)
- Run `workflow_dispatch` with debug flag OFF:
  - ensure concise logs
  - ensure normal path stays intact
- Run `workflow_dispatch` with debug flag ON:
  - ensure diagnostic coverage for checkout/ref/tag/permission boundaries

### Regression verification
- Confirm release path still behaves correctly for:
  - release already exists => skip create path
  - release missing => create path
  - npm publish path unchanged except safety checks

## 8) Definition of Done (Issue 209 Scope)

- `git 128` failures are classifiable to a concrete failure family from logs.
- Minimal recurrence-prevention guards are in place in `release.yml`.
- Existing release behavior remains functionally intact.
- Node 24 migration remains explicitly deferred to follow-up issue/PR.

## 9) Follow-up (Deferred)

- Separate issue/PR for Node 24 migration across all workflows:
  - action major updates where required
  - runtime version bump to 24
  - warning cleanup and compatibility checks
