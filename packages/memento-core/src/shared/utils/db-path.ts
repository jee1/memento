/**
 * DB 경로 검증 및 정규화 규칙 (Phase 6: 보안·일관성).
 *
 * **허용 값**
 * - `:memory:` — SQLite 인메모리 DB (그대로 사용).
 * - `file:<path>` — SQLite URI (그대로 사용).
 * - 그 외 — 파일 경로로 간주. 절대경로로 정규화하여 상대 경로·path traversal을 예측 가능한 경로로 만든다.
 *
 * **거부**
 * - 빈 문자열 또는 공백만 있는 값 → Error.
 *
 * **적용 위치**: createMementoCore(options)에서 options.dbPath에 적용.
 */

import { resolve } from 'path';

const ALLOWED_SPECIAL = [':memory:'] as const;
const FILE_URI_PREFIX = 'file:';

export function validateAndNormalizeDbPath(dbPath: string): string {
  const trimmed = dbPath?.trim() ?? '';
  if (trimmed === '') {
    throw new Error('dbPath는 비어 있을 수 없습니다. :memory: 또는 유효한 파일 경로를 지정하세요.');
  }

  if (ALLOWED_SPECIAL.includes(trimmed as (typeof ALLOWED_SPECIAL)[number])) {
    return trimmed;
  }
  if (trimmed.toLowerCase().startsWith(FILE_URI_PREFIX)) {
    return trimmed;
  }

  return resolve(trimmed);
}
