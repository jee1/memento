# External API call list

This inventory lists **outbound HTTP/API calls** from memento-core and memento-server (OpenAI, Gemini, Ollama, etc.) with priority for compliance and outage planning. Regenerate JSON snapshots when providers or endpoints change.

Full categorized list and maintenance notes (KO): [external-api-calls.md (KO)](../ko/external-api-calls.md).

## Updating the list

```bash
npx tsx scripts/find-external-api-calls.ts --core-only --format=json > docs/reference/en/external-api-calls.json
npx tsx scripts/find-external-api-calls.ts --format=json > docs/reference/en/external-api-calls-full.json
```
