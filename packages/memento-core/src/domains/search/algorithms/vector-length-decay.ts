/**
 * Soft length decay for hybrid vector similarity (#921).
 * factor = len / (len + k) — continuous, monotone in length; no hard cutoff.
 */

export interface VectorLengthDecayOptions {
  enabled: boolean;
  characteristic_length: number;
}

/** len/(len+k); empty/non-finite length → 0; non-finite/non-positive k → 1 (no decay). */
export function vectorLengthDecayFactor(length: number, characteristicLength: number): number {
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  if (!Number.isFinite(characteristicLength) || characteristicLength <= 0) {
    return 1;
  }
  return length / (length + characteristicLength);
}

/**
 * Multiply each item's similarity by length decay from `content`.
 * When disabled, returns the same array reference.
 */
export function applyVectorLengthDecay<T extends { similarity?: number; content?: string }>(
  items: T[],
  options: VectorLengthDecayOptions
): T[] {
  if (!options.enabled) {
    return items;
  }
  const k = options.characteristic_length;
  return items.map((item) => {
    const len = typeof item.content === 'string' ? item.content.length : 0;
    const factor = vectorLengthDecayFactor(len, k);
    const sim = typeof item.similarity === 'number' && Number.isFinite(item.similarity) ? item.similarity : 0;
    return { ...item, similarity: sim * factor };
  });
}
