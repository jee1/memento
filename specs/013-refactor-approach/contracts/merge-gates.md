# Contract: Merge gates (program-level)

**Applies to**: Refactor increments under **`specs/013-refactor-approach/spec.md`**.  
**Authority**: Spec FR-013, FR-026, FR-019; clarified 2026-04-12.

## Invariant G1 — CI

Every increment merged to the **integration line** named in **`plan.md`** **must** pass:

- `npm run lint`
- `npm run type-check`
- `npm test`

## Invariant G2 — Manual regression (conditional)

**Mandatory** before merge **iff** the increment **directly** modifies **runtime behavior** or **request-handling paths** for **any** of:

1. Agent memory **recall**
2. **Hybrid search** execution
3. **Administrative HTTP**

**Completion evidence**: Maintainer attests completion of **`manual-regression-checklist.md`** (same directory as `spec.md`) for affected sections.

## Invariant G3 — Exemptions to mandatory manual (program level)

Mandatory **manual** regression **does not** apply (CI still required) when:

- **Documentation-only** (FR-026), or
- **Type-only** / **emit-equivalent** changes that do **not** alter runtime behavior or request paths on the three surfaces (FR-026), or
- Changes **confined** to **other** capability areas (embedding, scheduling, relationship extraction, etc.) **without** **direct** changes to the three surfaces—**indirect** effects on recall/search **do not** trigger G2 by themselves.

**Build/tooling** changes that **can** change emitted code or runtime wiring **may** still require G2 when they affect the three surfaces.

## Invariant G4 — Emergency

Production **hotfixes** may follow **organization policy** (FR-019); this file does not waive org rules.

## Consumer expectations

- **Bots / CI**: Enforce **G1** always; **G2** is a **human** attestation unless encoded in CI later (out of scope for this contract).
- **Reviewers**: Block merge on missing checklist attestation when G2 applies.
