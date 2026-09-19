/**
 * 리포트 출력 루트 경로 (#910)
 *
 * report-comparison 계열이 공유한다. dirname 을 두 번 적용하는 계산을 파일마다
 * 복사해 두면 디렉터리를 옮길 때 조용히 갈라지므로 한 곳에만 둔다.
 */

import { dirname } from 'path';
import { fileURLToPath } from 'url';

export const reportOutputRoot = dirname(dirname(fileURLToPath(import.meta.url)));
