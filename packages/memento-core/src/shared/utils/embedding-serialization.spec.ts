import { describe, expect, it } from 'vitest';
import {
  computeL2Norm,
  decodeFloat32Embedding,
  embeddingColumnToNumbers,
  encodeFloat32Embedding,
  migrateJsonEmbeddingToBlob,
  shouldNormalizeFlag,
} from './embedding-serialization.js';

describe('encodeFloat32Embedding / decodeFloat32Embedding', () => {
  it('round-trip preserves float32 values', () => {
    const values = [0.1, -2.5, 3.1415926535, 0];
    const blob = encodeFloat32Embedding(values);
    const decoded = decodeFloat32Embedding(blob);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded)).toEqual(Array.from(new Float32Array(values)));
  });

  it('encodes little-endian float32 bytes', () => {
    const blob = encodeFloat32Embedding([1]);
    expect(blob.byteLength).toBe(4);
    // IEEE754 float32 LE for 1.0 → 0x00 0x00 0x80 0x3f
    expect([...blob]).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  it('rejects NaN', () => {
    expect(() => encodeFloat32Embedding([1, Number.NaN])).toThrow(Error);
  });

  it('rejects ±Inf', () => {
    expect(() => encodeFloat32Embedding([Number.POSITIVE_INFINITY])).toThrow(Error);
    expect(() => encodeFloat32Embedding([Number.NEGATIVE_INFINITY])).toThrow(Error);
  });

  it('decode rejects byteLength not multiple of 4', () => {
    expect(() => decodeFloat32Embedding(Buffer.from([1, 2, 3]))).toThrow(Error);
  });
});

describe('migrateJsonEmbeddingToBlob', () => {
  it('empty [] → null blob and dimensions 0', () => {
    expect(migrateJsonEmbeddingToBlob('[]')).toEqual({ blob: null, dimensions: 0 });
  });

  it('parses JSON array to float32 blob + dimensions', () => {
    const { blob, dimensions } = migrateJsonEmbeddingToBlob('[1, 2, 3]');
    expect(dimensions).toBe(3);
    expect(blob).not.toBeNull();
    expect(Array.from(decodeFloat32Embedding(blob!))).toEqual(
      Array.from(new Float32Array([1, 2, 3])),
    );
  });

  it('rejects NaN / Inf in JSON', () => {
    // JSON.stringify turns NaN/Inf into null; reject those as non-finite
    expect(() => migrateJsonEmbeddingToBlob('[1, null]')).toThrow(Error);
    // Non-standard NaN/Inf literals also fail (parse or validation)
    expect(() => migrateJsonEmbeddingToBlob('[1, NaN]')).toThrow(Error);
    expect(() => migrateJsonEmbeddingToBlob('[Infinity]')).toThrow(Error);
  });

  it('rejects non-array JSON (dim mismatch / invalid shape)', () => {
    expect(() => migrateJsonEmbeddingToBlob('{"a":1}')).toThrow(Error);
    expect(() => migrateJsonEmbeddingToBlob('null')).toThrow(Error);
    expect(() => migrateJsonEmbeddingToBlob('[1, "x"]')).toThrow(Error);
  });
});

describe('computeL2Norm / shouldNormalizeFlag', () => {
  it('computes L2 norm for number[] and Float32Array', () => {
    expect(computeL2Norm([3, 4])).toBe(5);
    expect(computeL2Norm(new Float32Array([3, 4]))).toBe(5);
  });

  it('|norm-1| < tolerance → 1 else 0', () => {
    expect(shouldNormalizeFlag(1)).toBe(1);
    expect(shouldNormalizeFlag(1 + 1e-6)).toBe(1);
    expect(shouldNormalizeFlag(1 - 1e-6)).toBe(1);
    expect(shouldNormalizeFlag(1 + 1e-4)).toBe(0);
    expect(shouldNormalizeFlag(0.5)).toBe(0);
    expect(shouldNormalizeFlag(1.001, 0.01)).toBe(1);
  });
});

describe('embeddingColumnToNumbers', () => {
  it('decodes Buffer; rejects string / empty / invalid', () => {
    const values = [0.25, -0.5, 1];
    expect(embeddingColumnToNumbers(encodeFloat32Embedding(values))).toEqual(
      Array.from(new Float32Array(values)),
    );
    expect(embeddingColumnToNumbers('[0.25,-0.5,1]')).toBeUndefined();
    expect(embeddingColumnToNumbers(Buffer.alloc(0))).toBeUndefined();
    expect(embeddingColumnToNumbers(Buffer.from([1, 2, 3]))).toBeUndefined();
    expect(embeddingColumnToNumbers(null)).toBeUndefined();
  });
});
