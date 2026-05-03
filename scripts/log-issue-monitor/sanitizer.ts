import { PIIMasker } from '../../packages/memento-core/src/shared/utils/pii-masker.js';

const TRUNCATED_SUFFIX = '...[truncated]';

export function limitUtf8Bytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  if (maxBytes <= 0) return '';

  const suffixBuffer = Buffer.from(TRUNCATED_SUFFIX, 'utf8');
  if (maxBytes <= suffixBuffer.length) {
    return suffixBuffer.subarray(0, maxBytes).toString('utf8');
  }

  const prefixBytes = maxBytes - suffixBuffer.length;
  return `${buffer.subarray(0, prefixBytes).toString('utf8')}${TRUNCATED_SUFFIX}`;
}

export function sanitizeExcerpt(excerpt: string, maxBytes: number): string {
  const masked = PIIMasker.mask(excerpt).masked;
  return limitUtf8Bytes(masked, maxBytes);
}
