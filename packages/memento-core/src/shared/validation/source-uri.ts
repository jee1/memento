import { parseMementoResourceUri } from '../utils/memento-resource-uri.js';

/**
 * remember `source` 필드 URI 검증 (#671)
 *
 * 지원 형식:
 * - file://path/to/file
 * - https://example.com/path
 * - commit:<sha>
 * - doc:<id>
 * - memento://<owner>/<resource-kind>/<resource-id>
 * - memento://memory/<memory_id> (legacy alias)
 */

export type SourceUriType = 'file' | 'https' | 'commit' | 'doc' | 'memento';

export interface SourceValidationResult {
  isValid: boolean;
  type?: SourceUriType;
  message?: string;
}

const FILE_URI = /^file:\/\/.+/i;
const HTTPS_URI = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
const COMMIT_URI = /^commit:[0-9a-f]{7,64}$/i;
const DOC_URI = /^doc:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MEMENTO_URI = /^memento:\/\/memory\/mem_[a-zA-Z0-9_]+$/;

/**
 * source 문자열이 지원 URI 형식인지 검증합니다.
 * 빈 문자열·undefined는 유효(선택 필드)로 처리합니다.
 */
export function validateSource(source: string | undefined | null): SourceValidationResult {
  if (source === undefined || source === null || source.trim() === '') {
    return { isValid: true };
  }

  const trimmed = source.trim();

  if (FILE_URI.test(trimmed)) {
    return { isValid: true, type: 'file' };
  }
  if (HTTPS_URI.test(trimmed)) {
    return { isValid: true, type: 'https' };
  }
  if (COMMIT_URI.test(trimmed)) {
    return { isValid: true, type: 'commit' };
  }
  if (DOC_URI.test(trimmed)) {
    return { isValid: true, type: 'doc' };
  }
  if (MEMENTO_URI.test(trimmed)) {
    return { isValid: true, type: 'memento' };
  }
  try {
    parseMementoResourceUri(trimmed);
    return { isValid: true, type: 'memento' };
  } catch {
    // Continue to the shared invalid-source response below.
  }

  return {
    isValid: false,
    message:
      "source는 file://, https://, commit:<sha>, doc:<id>, memento://{owner}/{kind}/{id} 형식이어야 합니다",
  };
}
