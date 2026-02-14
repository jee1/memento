# External API call list

This document identifies external API calls in the codebase and their priority. For the full list and update instructions, see the [Korean version](../ko/external-api-calls.md).

## Updating the list

```bash
npx tsx scripts/find-external-api-calls.ts --core-only --format=json > docs/reference/en/external-api-calls.json
npx tsx scripts/find-external-api-calls.ts --format=json > docs/reference/en/external-api-calls-full.json
```
