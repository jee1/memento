/**
 * Soft length decay for hybrid vector similarity (#921).
 * factor = len / (len + k) — continuous, monotone in length; no hard cutoff.
 */

export interface VectorLengthDecayOptions {
  enabled: boolean;
  characteristic_length: number;
  /** #921: length at which decay saturates to 1. Omitted / <=0 disables saturation. */
  saturation_length?: number;
}

/**
 * len/(len+k), normalised so that documents at or above `saturationLength` get exactly 1.
 * empty/non-finite length → 0; non-finite/non-positive k → 1 (no decay);
 * non-finite/non-positive saturationLength → no saturation (bare len/(len+k)).
 */
export function vectorLengthDecayFactor(
  length: number,
  characteristicLength: number,
  saturationLength?: number
): number {
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  if (!Number.isFinite(characteristicLength) || characteristicLength <= 0) {
    return 1;
  }
  const base = length / (length + characteristicLength);
  if (saturationLength === undefined || !Number.isFinite(saturationLength) || saturationLength <= 0) {
    return base;
  }
  const norm = saturationLength / (saturationLength + characteristicLength);
  return Math.min(1, base / norm);
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
  const sat = options.saturation_length;
  return items.map((item) => {
    const len = typeof item.content === 'string' ? item.content.length : 0;
    const factor = vectorLengthDecayFactor(len, k, sat);
    const sim = typeof item.similarity === 'number' && Number.isFinite(item.similarity) ? item.similarity : 0;
    return { ...item, similarity: sim * factor };
  });
}
