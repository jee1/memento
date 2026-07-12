# Implementation Plan: Hash-Chained Audit Log

1. Add the audit migration and a core append/verify service.
2. Add best-effort and strict coverage policy helpers.
3. Integrate HTTP authentication/administrative boundaries, then MCP dispatch.
4. Add a read-only admin query/export API and security-retention documentation.
