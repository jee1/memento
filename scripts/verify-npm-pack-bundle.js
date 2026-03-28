#!/usr/bin/env node
/**
 * tarball에 bundledDependencies(@memento/core)가 실제로 포함되는지 검증한다.
 *
 * `npm pack --dry-run`은 bundled files: 0처럼 잘못 표시되는 경우가 있어(특히 private 워크스페이스 패키지),
 * 릴리스 게이트는 실제 .tgz 내용을 본다.
 *
 * 순서: prepack-bundle-core → npm pack --ignore-scripts → zlib+tar 헤더 파싱으로 경로 검사 → 워크스페이스 링크 복구
 * (POSIX `tar` 바이너리/`/bin/sh` 의존 없음 — Windows·제한 CI 호환)
 *
 * 검증 실패 시에도 try/finally로 postpack 복구를 반드시 실행한다(process.exit는 마지막에 한 번만).
 */
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { gunzipSync } from 'zlib';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const REQUIRED = 'package/node_modules/@memento/core/dist/index.js';
/** Windows에서는 PATH의 `npm`이 .cmd 배치 파일이라 spawn 시 npm.cmd를 쓴다. */
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * npm pack 산출 .tgz(ustar gzip)에서 엔트리 경로 목록 — 외부 `tar` 명령 없이 검증한다.
 * @param {string} tgzPath
 * @returns {Set<string>}
 */
function listUstarGzipEntryPaths(tgzPath) {
  const tar = gunzipSync(readFileSync(tgzPath));
  const paths = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every((b) => b === 0)) break;
    const name = readTarString(h, 0, 100);
    const prefix = readTarString(h, 345, 155);
    const size = Number.parseInt(readTarString(h, 124, 12).trimEnd(), 8) || 0;
    const typeflag = h[156];
    const full = prefix ? `${prefix.replace(/\/$/, '')}/${name}` : name;
    const norm = full.replace(/\\/g, '/').replace(/^\.\//, '');
    if (norm && typeflag !== 76 && typeflag !== 75 && typeflag !== 103 && typeflag !== 120) {
      // L=longname, K=GNU longlink, g=global ext, x=PAX — 이름만 건너뛰고 블록은 스킵
      paths.add(norm);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return paths;
}

/** @param {Buffer} buf @param {number} start @param {number} len */
function readTarString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const z = slice.indexOf(0);
  const s = (z === -1 ? slice : slice.subarray(0, z)).toString('utf8');
  return s.trim();
}

let exitCode = 0;
const tmp = mkdtempSync(join(tmpdir(), 'memento-pack-verify-'));
/** HOME/~/.npm 이 읽기 전용인 CI/샌드박스에서도 pack이 실패하지 않도록 캐시를 임시 디렉터리로 둔다. */
const npmCache = mkdtempSync(join(tmpdir(), 'memento-npm-cache-'));
const packEnv = { ...process.env, npm_config_cache: npmCache };
try {
  execSync('node scripts/prepack-bundle-core.js', { cwd: root, stdio: 'inherit', env: packEnv });
  const pack = spawnSync(npmCli, ['pack', '--pack-destination', tmp, '--ignore-scripts'], {
    cwd: root,
    stdio: 'inherit',
    env: packEnv,
  });
  if (pack.error) {
    throw pack.error;
  }
  if (pack.status !== 0) {
    console.error('[verify-npm-pack-bundle] npm pack 실패');
    exitCode = pack.status ?? 1;
  } else {
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgz) {
      console.error('[verify-npm-pack-bundle] tarball이 생성되지 않았습니다.');
      exitCode = 1;
    } else {
      const paths = listUstarGzipEntryPaths(join(tmp, tgz));
      if (!paths.has(REQUIRED)) {
        console.error(
          `[verify-npm-pack-bundle] tarball에 ${REQUIRED} 가 없습니다. bundledDependencies 번들이 깨졌을 수 있습니다.`
        );
        exitCode = 1;
      } else {
        console.log(`[verify-npm-pack-bundle] OK — ${REQUIRED} 포함 (${tgz})`);
      }
    }
  }
} catch (err) {
  console.error('[verify-npm-pack-bundle]', err);
  exitCode = 1;
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(npmCache, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    execSync('node scripts/postpack-restore-workspace.js', { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.error('[verify-npm-pack-bundle] 워크스페이스 복구(postpack) 실패:', e);
    exitCode = 1;
  }
}

process.exit(exitCode);
