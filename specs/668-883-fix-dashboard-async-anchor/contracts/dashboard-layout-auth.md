# Contract: Dashboard layout & auth visibility

## Invariants

1. Elements with the HTML `hidden` attribute MUST NOT be visible due to author
   `display:flex` rules (use `[hidden]{display:none!important}` or equivalent
   higher-specificity rule covering `.dashboard-auth-form`).
2. At viewport width ≤390px, `.m-tab-bar` MUST allow horizontal access to all tabs
   (`overflow-x: auto` or wrap that preserves reachability).
3. On Anchor Map tab, the map host (`#anchor-map` or designated wrapper) MUST have
   `min-height` ≥ 200px so computed layout height is not 0 solely from flex shrink.

## Non-contracts

- Exact pixel map height above 200px.
- Desktop (>768px) layout redesign.
