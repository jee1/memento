/**
 * #804 격리 러너의 산출물 — dry-run 리포트와 관계 내보내기.
 *
 * 표본에 기억 본문이 들어가므로 경로 규칙을 여기서 강제한다 (FR-006b).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { QuarantineGateError } from './quarantine-gates.js';

/**
 * FR-006b: .gitignore 가 .md·.json 을 막지 않으므로 경로 자체로 막는다.
 * 저장소 밖(예: /tmp)은 커밋 대상이 아니므로 그대로 허용한다.
 */
export function resolveOutDir(out: string, repoRoot: string): string {
  const abs = resolve(repoRoot, out);
  const insideRepo = abs === repoRoot || abs.startsWith(repoRoot + sep);
  const insideLocal = abs.startsWith(join(repoRoot, '.local') + sep);
  if (insideRepo && !insideLocal) {
    throw new QuarantineGateError(1, `산출물은 저장소 안이면 .local/ 아래여야 합니다: ${abs}`);
  }
  return abs;
}

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}
