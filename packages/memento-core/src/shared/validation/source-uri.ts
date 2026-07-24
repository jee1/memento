import { parseMementoResourceUri } from '../utils/memento-resource-uri.js';

/**
 * remember `source` 필드 URI 검증 (#671, #696)
 *
 * 지원 형식:
 * - file://path/to/file
 * - https://example.com/path
 * - commit:<sha>
 * - doc:<id>
 * - agent:<id> (에이전트·워크플로 식별자)
 * - bare <id> → agent:<id>로 정규화 (#696)
 * - memento://<owner>/<resource-kind>/<resource-id>
 * - memento://memory/<memory_id> (legacy alias)
 */

export type SourceUriType = 'file' | 'https' | 'commit' | 'doc' | 'memento' | 'agent';

export interface SourceValidationResult {
  isValid: boolean;
  type?: SourceUriType;
  message?: string;
  /** bare agent id가 agent:<id>로 정규화된 경우 저장에 사용할 값 */
  normalizedSource?: string;
}

const FILE_URI = /^file:\/\/.+/i;
const HTTPS_URI = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
const COMMIT_URI = /^commit:[0-9a-f]{7,64}$/i;
/** doc·agent id charset (#671 / #696) */
const ID_BODY = '[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}';
const DOC_URI = new RegExp(`^doc:${ID_BODY}$`);
const AGENT_URI = new RegExp(`^agent:${ID_BODY}$`);
const BARE_AGENT_ID = new RegExp(`^${ID_BODY}$`);
const MEMENTO_URI = /^memento:\/\/memory\/mem_[a-zA-Z0-9_]+$/;

/**
 * source 문자열이 지원 URI 형식인지 검증합니다.
 * 빈 문자열·undefined는 유효(선택 필드)로 처리합니다.
 * bare agent/workflow id는 agent:<id>로 정규화합니다 (#696).
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
  if (AGENT_URI.test(trimmed)) {
    return { isValid: true, type: 'agent' };
  }
  if (MEMENTO_URI.test(trimmed)) {
    return { isValid: true, type: 'memento' };
  }
  try {
    parseMementoResourceUri(trimmed);
    return { isValid: true, type: 'memento' };
  } catch {
    // Continue — may still be a bare agent id (#696).
  }
  if (BARE_AGENT_ID.test(trimmed)) {
    return {
      isValid: true,
      type: 'agent',
      normalizedSource: `agent:${trimmed}`,
    };
  }

  return {
    isValid: false,
    message:
      "source는 file://, https://, commit:<sha>, doc:<id>, agent:<id>, memento://{owner}/{kind}/{id} 형식이어야 합니다",
  };
}
