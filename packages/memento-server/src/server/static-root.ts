import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * 정적 UI(graph.html 등) 위치 — Docker(/app/static), 로컬 모노레포 루트(./static),
 * 또는 memento-server 패키지 cwd에서 상위 탐색.
 */
export function resolveStaticRoot(): string {
  const env = process.env.MEMENTO_STATIC_ROOT?.trim();
  if (env) {
    return env;
  }
  const cwd = process.cwd();
  const candidates = [join(cwd, 'static'), join(cwd, '..', 'static'), join(cwd, '..', '..', 'static')];
  // #1057: an npm-installed bin runs from the user's cwd, so none of the cwd
  // candidates can reach node_modules/<pkg>/static. Walk up from this module to
  // the installed package root as well. Source and dist layouts sit at different
  // depths, so walk rather than hard-code one.
  let moduleDir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.push(join(moduleDir, 'static'));
    const parent = dirname(moduleDir);
    if (parent === moduleDir) {
      break;
    }
    moduleDir = parent;
  }
  for (const p of candidates) {
    const graphPath = join(p, 'graph.html');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- 모노레포·Docker에서 static/ 위치만 탐색
    if (existsSync(graphPath)) {
      return p;
    }
  }
  return join(cwd, 'static');
}
