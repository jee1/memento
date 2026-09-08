/**
 * 저장소 감사 스크립트가 공유하는 파일 목록 유틸리티.
 *
 * gitignore 규칙을 다시 구현하지 않고 git 에 직접 묻는다. `.omx/`·`.serena/` 처럼
 * 에이전트가 만드는 상태 디렉터리는 커밋되지 않으므로 감사 대상이 아니며,
 * 새 도구가 디렉터리를 하나 더 만들어도 제외 목록을 손볼 필요가 없다 (#911).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 저장소에 커밋될 수 있는 파일 목록을 반환한다.
 *
 * 추적 중인 파일(`--cached`)과 아직 추적되지 않았지만 gitignore 대상도 아닌
 * 파일(`--others --exclude-standard`)을 합친 것으로, "지금 커밋하면 저장소에
 * 들어갈 파일"과 일치한다.
 *
 * @param {string} root 저장소 루트 절대 경로
 * @returns {{ full: string, relPath: string }[]} 루트 기준 상대 경로와 절대 경로 쌍
 */
export function listRepoFiles(root) {
  const stdout = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const files = [];
  const seen = new Set();
  for (const relPath of stdout.split('\0')) {
    // 병합 충돌 중인 경로는 스테이지마다 한 번씩 나오므로 중복을 걸러낸다.
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);

    const full = path.join(root, relPath);
    // 인덱스에는 있지만 작업 트리에서 지워진 파일은 읽을 수 없으므로 제외한다.
    if (!fs.existsSync(full)) continue;

    files.push({ full, relPath });
  }
  return files;
}
