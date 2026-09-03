/**
 * Float32 little-endian BLOB codec for memory_embedding (#809).
 */

function assertFiniteNumbers(values: ArrayLike<number>, label: string): void {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`${label}: non-finite number at index ${i}`);
    }
  }
}

/**
 * Encode a number[] as little-endian float32 Buffer.
 * Rejects NaN / ±Inf.
 */
export function encodeFloat32Embedding(values: number[]): Buffer {
  assertFiniteNumbers(values, 'encodeFloat32Embedding');
  const f32 = Float32Array.from(values);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Decode a little-endian float32 BLOB to Float32Array.
 * byteLength must be a multiple of 4.
 */
export function decodeFloat32Embedding(blob: Buffer): Float32Array {
  if (blob.byteLength % 4 !== 0) {
    throw new Error(
      `decodeFloat32Embedding: byteLength ${blob.byteLength} is not a multiple of 4`,
    );
  }
  // Copy into aligned ArrayBuffer so Float32Array view is always valid
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/**
 * Parse a legacy JSON embedding array into float32 BLOB.
 * Empty `[]` → `{ blob: null, dimensions: 0 }` (FR-018).
 * NaN/Inf or invalid shape → throw (FR-020).
 */
export function migrateJsonEmbeddingToBlob(json: string): {
  blob: Buffer | null;
  dimensions: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `migrateJsonEmbeddingToBlob: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('migrateJsonEmbeddingToBlob: expected JSON array');
  }

  if (parsed.length === 0) {
    return { blob: null, dimensions: 0 };
  }

  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`migrateJsonEmbeddingToBlob: non-finite number at index ${i}`);
    }
  }

  const numbers = parsed as number[];
  return {
    blob: encodeFloat32Embedding(numbers),
    dimensions: numbers.length,
  };
}

/** Euclidean (L2) norm. */
export function computeL2Norm(values: number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/**
 * |norm − 1| < tolerance → 1 (normalized), else 0.
 * Default tolerance 1e-5 (FR-009).
 */
export function shouldNormalizeFlag(norm: number, tolerance = 1e-5): 0 | 1 {
  return Math.abs(norm - 1) < tolerance ? 1 : 0;
}

/**
 * Post-cutover memory_embedding.embedding column → number[].
 * Buffer-only (FR-021); empty / invalid → undefined.
 */
export function embeddingColumnToNumbers(raw: unknown): number[] | undefined {
  if (!Buffer.isBuffer(raw) || raw.byteLength === 0) {
    return undefined;
  }
  try {
    const floats = decodeFloat32Embedding(raw);
    if (floats.length === 0) {
      return undefined;
    }
    return Array.from(floats);
  } catch {
    return undefined;
  }
}
