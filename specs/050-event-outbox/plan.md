# Implementation Plan: Durable Event Outbox

1. Add migration 039 for a durable SQLite outbox and indexes.
2. Add a small core service with feature-flagged enqueue and polling publisher interfaces.
3. Emit URI-bearing events from successful memory write and forget boundaries.
4. Document vocabulary, payload schema, and at-least-once limits; run focused tests and static checks.
