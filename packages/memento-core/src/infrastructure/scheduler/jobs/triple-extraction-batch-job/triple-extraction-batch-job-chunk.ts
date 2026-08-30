/**
 * 메모리 배열을 청크로 분할 (SQLite WAL 환경 고려)
 */
export function splitTripleExtractionIntoChunks<T>(memories: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < memories.length; i += chunkSize) {
    chunks.push(memories.slice(i, i + chunkSize));
  }
  return chunks;
}
