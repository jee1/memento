# Multi-agent usage guide

**Related**: [Issue #57](https://github.com/jee1/memento/issues/57) Phase 2 D (multi-agent).

## Overview

The `memory_item` table has an **owner_id** field so that multiple agents using the same Memento instance can filter and separate memories by owner.

## owner_id

- **NULL**: No owner (single agent or legacy rows).
- **String**: Owner/agent identifier (e.g. `"agent-a"`, `"default"`).

## remember / remember_procedure

When saving, set `owner_id` in the tool context or request so that the memory is attributed to the correct agent.

For full details and recall filtering, see the [Korean version](../ko/multi-agent-usage.md).
