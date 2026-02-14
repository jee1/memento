# Async augmentation pipeline (Issue #89)

## Overview

Conversations/events are **saved immediately**; Fact/Triple extraction, summarization, deduplication, and consolidation run in **background workers**. This follows a “no added latency” design.

For full design and implementation notes, see the [Korean version](../ko/async-augmentation-pipeline.md).
