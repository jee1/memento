# Design

## Source of truth
- Status: Active
- Locked product decisions (2026-09-12):
  - Brand: **quiet admin** (neutral chrome; no purple-indigo gradient identity)
  - Locale: **KO-first** (chrome/microcopy Korean; domain terms A/B/C·type names may stay Latin)
  - Default landing tab after sign-in: **Anchor Map**
- Primary product surfaces: HTTP Admin Dashboard (`/dashboard`), Memory Graph (`/graph`, also embedded in dashboard)
- Evidence reviewed:
  - `docs/DESIGN.md` (prior token cheat-sheet)
  - `static/css/tokens.css`, `static/css/components.css`, `static/css/dashboard.css`
  - `static/dashboard.html`, `static/graph.html`
  - `specs/668-883-fix-dashboard-async-anchor/contracts/dashboard-layout-auth.md`
  - `docs/agents/agent-workflow.md` (token-first UI rule)
  - Observed: 7 top-level tabs; Anchor Map toolbar 10+ controls; light dashboard + dark graph dual theme

## Brand
- Personality: Quiet operator console — calm, precise, trustworthy. Spatial memory tools (map/graph) are the visual hero; chrome stays neutral and secondary.
- Decision: **Quiet admin** — header/nav use neutral surfaces + thin accent (not brand gradient). Accent may reuse a single restrained primary for focus/links/primary buttons, not full-bleed purple header.
- Trust signals: Clear session state; visible loading/error; memory-type color consistency (episodic/semantic/procedural/working); anchor slot A/B/C semantics.
- Avoid: Emoji-as-brand in titles; purple-indigo “AI SaaS” gradient as identity; decorative glow; pill-stat clutter; inventing new hex outside tokens; EN chrome when KO string exists.

## Product goals
- Goals:
  - Let operators diagnose recall/anchor/embedding health quickly.
  - Support review queue + batch jobs + agent session provenance without leaving admin HTTP.
  - Keep UI framework-free (vanilla CSS tokens + components).
- Non-goals:
  - Public marketing site / consumer app visual language.
  - Replacing MCP tool UX; dashboard is admin/ops, not agent chat.
  - Full dark-mode for every panel in one pass (graph dark stays specialized).
- Success signals:
  - Primary job (find memory around anchors / review candidates / check job health) reachable in ≤2 clicks after sign-in.
  - No new hard-coded colors in panel CSS (token or component only).
  - Shared empty/loading/error patterns used by ≥3 panels.

## Personas and jobs
- Primary personas:
  - **Memory operator** — debugs recall quality, anchors, embeddings.
  - **Ops maintainer** — watches Jobs, Review Queue, batch health.
  - **Integrating developer** — inspects Agent Sessions / evolution demo for understanding.
- User jobs:
  - Sign in once → pick agent → explore Anchor Map / Graph.
  - Triage Review Queue with badge urgency.
  - Pause/run jobs (when not `ADMIN_JOBS_READ_ONLY`).
  - Explain memory evolution to stakeholders (demo tab).
- Key contexts of use: Local/loopback or internal network desktop browser; occasional narrow laptop; not primary mobile app.

## Information architecture
> **Current state.** This section describes what is deployed today. Adding or removing a tab or route means updating it in the same PR.
- Primary navigation: Top tab bar (`.m-tab-bar`) after header.
- Default landing: **Anchor Map** tab active after sign-in (and on cold load when session already valid). Do not auto-switch to Review Queue on badge alone.
- Core routes/screens:
  - `/dashboard` tabs: Anchor Map · Embedding Health · Memory Graph · 상태 · Review Queue · Jobs · Agent Sessions · 기억 진화 데모
  - `/graph` standalone dark graph (session-gated)
- Content hierarchy (target):
  1. Session chrome (collapsed when signed in)
  2. Task groups (Spatial · Ops · Learn) rather than a flat peer list
  3. Per-tab primary canvas + secondary inspector
  4. Advanced/layout controls behind disclosure

## Design principles
- Principle 1: **Token-first** — color, space, radius, type only via `tokens.css`.
- Principle 2: **Canvas over chrome** — map/graph/table gets vertical budget; header and toolbars shrink after auth.
- Principle 3: **Progressive disclosure** — default controls = current task; layout/auto-refresh/advanced nest under secondary.
- Tradeoffs: Flat tabs are discoverable but noisy; regrouping costs one click for secondary tasks. Brand refresh risks regressing screenshot/string specs — ship token change separately from IA.

## Visual language
- Color:
  - Legacy (to retire from chrome): `--color-brand-gradient` full-bleed header (`#667eea`→`#764ba2`).
  - Target (**quiet admin**, decided): `.m-header` / dashboard chrome = `--color-bg-card` (or near-neutral) + `--color-border-light`; text `--color-text-main`; primary actions may keep a restrained accent token (redefine primary away from “AI purple” when tokens change — prefer slate/ink + one functional accent, e.g. info/anchor-c family, not purple gradient).
  - Keep: memory-type colors; anchor A/B/C; graph dark specialized palette (dual theme decided as option A, #1026).
  - Dark surfaces are scoped, not global: `.graph-view--embedded` redefines `--color-*-graph` to the light neutral tokens for the dashboard iframe. Add new graph chrome as a token, never as a literal, so that override keeps working.
- Typography: `--font-family-base` system stack (admin OK). Hierarchy via `--font-size-*` + weight, not decorative fonts.
- Spacing/layout rhythm: `--spacing-xs`…`--xl`; prefer token gaps over raw rem in new CSS.
- Shape/radius/elevation: `--radius-sm|md|lg`; `--shadow-sm|md` sparingly (cards only; header prefers border over heavy shadow).
- Motion: Short 0.2s transitions already used; honor `prefers-reduced-motion` for future motion; no decorative animation.
- Imagery/iconography: Prefer text + color legend over emoji; SVG/status dots for slots and memory types.

## Components
- Existing components to reuse: `.m-button` (+ `--primary|--secondary|--ghost`), `.m-input`, `.m-card`, `.m-header`, `.m-badge`, `.m-tab-bar` / `.m-tab-btn` / `.m-tab-badge`.
- New/changed components (proposed):
  - `.m-toolbar` / `.m-toolbar-primary` / `.m-toolbar-more` (progressive disclosure)
  - `.m-empty`, `.m-loading`, `.m-error` (shared interaction states)
  - `.m-nav-group` or overflow “More” for tab IA
  - Compact `.m-session-chip` for signed-in header
- Variants and states: Document disabled/hover/focus on components; panels must not fork button styles.
- Token/component ownership: Tokens in `tokens.css`; primitives in `components.css`; page/panel layout only in `dashboard.css` (or panel-scoped files if split later).

## Accessibility
- Target standard: WCAG 2.2 AA for admin console chrome (contrast, focus, names).
- Keyboard/focus behavior: Tablist already uses `role="tab"`; extend `:focus-visible` rings via token (not border-only on `.m-input`). Map nodes that are interactive need keyboard paths where feasible.
- Contrast/readability: Quiet header uses main text on card/neutral (drop reliance on `--color-dashboard-text-on-brand` for primary chrome); muted text `#666` on `#f5f5f5` OK; verify badge colors on dark graph.
- Screen-reader semantics: Keep `aria-live` on auth/search status; ensure tab badges expose count when visible.
- Reduced motion and sensory considerations: Respect `prefers-reduced-motion` for force-layout animation / auto-refresh flash; avoid relying on color alone for anchor slots (labels required).

## Responsive behavior
- Supported breakpoints/devices: Contracts require ≤390px tab reachability (`overflow-x: auto` or wrap); existing `@media` at 768 / 480 and panel-specific widths.
- Layout adaptations: Column stack sidebar+map; auth panel full width; toolbar wrap.
- Touch/hover differences: Larger hit targets on toolbar when wrapped; avoid hover-only actions for review row open.

## Interaction states
- Loading: Prefer shared `.m-loading` using `--color-status-loading-*` (today: `.em-loading`, `.med-loading`, `.as-banner--loading` diverge).
- Empty: Prefer shared `.m-empty` (today: `.no-data`, `.med-empty`, per-panel copy).
- Error: Prefer shared `.m-error` / `role="alert"` (today: `.em-error`, auth message tones, status-error tokens).
- Success: Inline confirmation; avoid toast spam except Review Queue OS notify opt-in.
- Disabled: `.m-button:disabled` opacity 0.6; session-only tabs gated by auth state.
- Offline/slow network: Fetch failures surface in panel error regions; no global offline banner yet (open).

## Content voice
- Tone: Operator-direct, short, no marketing fluff.
- Locale decision: **KO-first** — visible chrome (titles, tabs, buttons, empty/error, auth) Korean. Keep stable domain tokens in Latin where operators already know them: slot `A`/`B`/`C`, type names, provider ids (`minilm`, …). Specs that assert EN strings must update with the KO pass.
- Terminology: 앵커 슬롯 A/B/C; 기억 유형 episodic/semantic/procedural/working; Jobs = 배치 작업; Review Queue = 검토 대기열.
- Microcopy rules: No emoji in `h1`; `title` tooltips OK for dense controls; prefer one KO string over bilingual clutter.

## Implementation constraints
- Framework/styling system: Vanilla JS + CSS custom properties; no React/Tailwind for admin UI.
- Design-token constraints: No new hex in panel CSS; add missing tokens (`--color-status-warning`, `--color-bg-hover`, `--color-bg-selected`, focus ring) before using them.
- Performance constraints: D3 maps / UMAP scatter — keep chrome light; avoid heavy CSS filters.
- Compatibility constraints: Modern evergreen browsers; Node admin server serves `static/`.
- Test/screenshot expectations: Server string/contract specs (`dashboard-*.spec.ts`); layout-auth contract min map height ≥200px; visual changes may need string updates for labels/IA.

## Improvement roadmap (proposals)
> **Proposal record, not a status board.** Each item is what was proposed on the date it was written. Do not edit an item to match today's code — that rewrites the record. Whether an item shipped is answered by its linked issue, not by this file.
### P0 — Consistency (low risk)
1. Close token gaps referenced with fallbacks in `dashboard.css` (status warning/success aliases, hover/selected surfaces).
2. Add shared `.m-empty` / `.m-loading` / `.m-error` and migrate one panel as template (Embedding Health or Jobs). (#965)
3. Global `:focus-visible` ring token on interactive controls.
4. Remove emoji from dashboard title; collapse auth chrome when `data-auth-state="authenticated"`.
5. Ensure default active tab remains / restores **Anchor Map** (already default in HTML — guard any auth-restore path that changes tab).

### P1 — IA & density (medium risk)
1. Group tabs: **Spatial** (Anchor, Embedding, Graph) · **Ops** (Review, Jobs, Sessions) · **Learn** (Evolution demo) via grouped nav or overflow. (#967)
2. Anchor Map toolbar: primary row = Agent + Search + Slot + Search/Clear; secondary = Refresh/Fit/layout/auto-refresh under “More” / details. (#968)
3. KO-first chrome pass (tabs, auth, toolbars, empty/error); update string specs. (#969)

### P2 — Visual identity (decided: quiet admin)
1. Replace indigo→purple gradient header with quiet neutral chrome + restrained accent; retune `--color-brand-*` / `.m-header` and secondary-on-brand tokens. (#965, #1023)
2. Align embedded Memory Graph light canvas vs standalone dark graph (document intentional dual mode or converge). (#1026)
3. Motion policy + reduced-motion for simulation/auto-refresh cues.

## Open questions
> **Decision record.** A checked item records the decision and its date, not that the implementation shipped.
- [x] Brand → **quiet admin** (2026-09-12)
- [x] Locale → **KO-first** (2026-09-12)
- [x] Default landing tab → **Anchor Map** (2026-09-12)
- [x] Tab IA → **Spatial / Ops / Learn** grouped nav (#967); toolbar More (#968) (2026-09-12)
- [x] Dual theme → **keep the split (option A)** (2026-09-19, #1026). `/graph` is a specialized dark canvas; `/dashboard` stays light. The `--color-graph-*` block is the sanctioned second palette, not drift.
  - Mechanism: `.graph-view--embedded` (`static/graph.html`) already redefines the graph tokens to the light neutral tokens at a scope root, so the embedded canvas and the standalone page share one stylesheet with two palettes. A future unified theme would reuse this same scope-root technique, not replace it.
  - Revisit when: someone asks for a dark dashboard, or a third surface needs the same palette. Until then the migration cost (semantic-token migration of `dashboard.css`, dark memory-type palette validation, theme toggle + persistence, `/graph` chrome spec updates) buys nothing.
