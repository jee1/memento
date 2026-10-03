/**
 * #1230: automatic triple extraction (after remember, and the hourly batch) can be turned off.
 * Measured on production: 78% of the generated "X는 Y를 …합니다" semantics were meaningless
 * fragments that crowded search results. Explicit extract_triples tool calls are not affected.
 */
export function isAutoTripleExtractionEnabled(): boolean {
  return process.env.TRIPLE_EXTRACTION_ENABLED?.trim().toLowerCase() !== 'false';
}
