export interface CosineSimilarityOptions {
  /** Gemini/lightweight historically treated NaN vector elements as zero. */
  nanAsZero?: boolean;
}

function vectorValue(value: number | undefined, nanAsZero: boolean): number {
  const resolved = value ?? 0;
  return nanAsZero && Number.isNaN(resolved) ? 0 : resolved;
}

export function dotProduct(
  a: number[],
  b: number[],
  options: CosineSimilarityOptions = {},
): number {
  if (a.length !== b.length) return 0;

  let product = 0;
  for (let index = 0; index < a.length; index++) {
    product += vectorValue(a[index], options.nanAsZero === true)
      * vectorValue(b[index], options.nanAsZero === true);
  }
  return product;
}

export function cosineSimilarity(
  a: number[],
  b: number[],
  options: CosineSimilarityOptions = {},
): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let normA = 0;
  let normB = 0;
  const nanAsZero = options.nanAsZero === true;

  for (let index = 0; index < a.length; index++) {
    const aValue = vectorValue(a[index], nanAsZero);
    const bValue = vectorValue(b[index], nanAsZero);
    normA += aValue * aValue;
    normB += bValue * bValue;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct(a, b, options) / magnitude;
}
