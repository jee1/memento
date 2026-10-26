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

const USER_CONTENT_KEYS = new Set([
  'query', 'content', 'source', 'tags', 'args', 'arguments', 'params',
  'input', 'text', 'prompt', 'messages', 'context_text', 'summary',
]);

function stripUserContent(line: string): string {
  const payloadStart = line.indexOf(' | {');
  const message = (payloadStart < 0 ? line : line.slice(0, payloadStart))
    .replace(/\((source|query|content)='[^']*'\)/g, "($1='[omitted]')");
  if (payloadStart < 0) return message;

  try {
    const payload: unknown = JSON.parse(line.slice(payloadStart + 3), (key, value: unknown) =>
      USER_CONTENT_KEYS.has(key) ? '[omitted]' : value);
    return `${message} | ${JSON.stringify(payload)}`;
  } catch {
    return `${message} | [payload omitted]`;
  }
}

export function sanitizeExcerpt(excerpt: string, maxBytes: number): string {
  const masked = PIIMasker.mask(excerpt.split('\n').map(stripUserContent).join('\n')).masked;
  return limitUtf8Bytes(masked, maxBytes);
}
