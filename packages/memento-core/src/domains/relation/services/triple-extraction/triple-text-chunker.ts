/**
 * 트리플 추출 파이프라인용 텍스트 청킹
 *
 * 인접 청크는 `overlap`만큼 앞쪽과 겹친다. 다음 청크 시작 인덱스는
 * `이전_시작 + (chunkSize - overlap)`이며, 문자열 끝까지 슬라이드한다.
 * 마지막 청크는 남은 길이가 `chunkSize`보다 짧을 수 있다.
 */

export function splitTextIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  if (chunkSize <= 0) {
    throw new RangeError('chunkSize must be > 0');
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new RangeError('overlap must be >= 0 and < chunkSize');
  }
  if (text === '') {
    return [];
  }

  const chunks: string[] = [];
  const step = chunkSize - overlap;
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) {
      break;
    }
    start += step;
  }

  return chunks;
}
