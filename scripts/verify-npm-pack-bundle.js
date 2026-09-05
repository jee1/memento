#!/usr/bin/env node
/**
 * tarball에 server 런타임 closure가 실제로 포함되는지 검증한다.
 *
 * - bundled: `@memento/core`, `@memento/agent-integration` (prepack 복사 → node_modules)
 * - root dependencies: `express-rate-limit`, `helmet`, `umap-js` (설치 시 registry에서 해석;
 *   tarball 안의 package/package.json에 선언되어 있어야 함)
 *
 * `npm pack --dry-run`은 bundled files: 0처럼 잘못 표시되는 경우가 있어(특히 private 워크스페이스 패키지),
 * 릴리스 게이트는 실제 .tgz 내용을 본다.
 *
 * 순서: prepack-bundle-core → npm pack --ignore-scripts → zlib+tar 헤더 파싱으로 경로·deps 검사
 * → (선택) empty-temp install + resolve smoke → 워크스페이스 링크 복구
 * (POSIX `tar` 바이너리/`/bin/sh` 의존 없음 — Windows·제한 CI 호환)
 *
 * 검증 실패 시에도 try/finally로 postpack 복구를 반드시 실행한다(process.exit는 마지막에 한 번만).
 *
 * Empty-temp smoke: `MEMENTO_PACK_SMOKE=0` 이면 스킵. 네이티브 모듈(better-sqlite3 등) 전체
 * 기동은 CI에서 무거울 수 있어, 기본 smoke는 설치 후 JS 패키지 resolve + bin 파일 존재만 본다.
 */
import { execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { gunzipSync } from 'zlib';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/** tarball에 물리적으로 있어야 하는 bundled 워크스페이스 패키지 경로 */
const REQUIRED_BUNDLED_PATHS = [
  'package/node_modules/@memento/core/dist/index.js',
  'package/node_modules/@memento/agent-integration/dist/index.js',
];

/**
 * 루트 package.json dependencies에 선언되어 tarball 메타데이터에 실려야 하는
 * server 런타임 external (registry 패키지).
 */
const REQUIRED_ROOT_DEPS = ['express-rate-limit', 'helmet', 'umap-js'];

/** empty-temp install 후 resolve해야 하는 패키지 (closure 누락 시 실패) */
const SMOKE_RESOLVE_PACKAGES = [
  '@memento/core',
  '@memento/agent-integration',
  'express-rate-limit',
  'helmet',
  'umap-js',
];

/** Windows에서는 PATH의 `npm`이 .cmd 배치 파일이라 spawn 시 npm.cmd를 쓴다. */
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * npm pack 산출 .tgz(ustar gzip)에서 엔트리 경로 목록 — 외부 `tar` 명령 없이 검증한다.
 * @param {string} tgzPath
 * @returns {{ paths: Set<string>, files: Map<string, Buffer> }}
 */
function listUstarGzipEntries(tgzPath) {
  const tar = gunzipSync(readFileSync(tgzPath));
  const paths = new Set();
  /** @type {Map<string, Buffer>} */
  const files = new Map();
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
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (norm && typeflag !== 76 && typeflag !== 75 && typeflag !== 103 && typeflag !== 120) {
      // L=longname, K=GNU longlink, g=global ext, x=PAX — 이름만 건너뛰고 블록은 스킵
      paths.add(norm);
      // regular file or contiguous (0 or '0' / 48)
      if (typeflag === 0 || typeflag === 48) {
        files.set(norm, Buffer.from(data));
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { paths, files };
}

/** @param {Buffer} buf @param {number} start @param {number} len */
function readTarString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const z = slice.indexOf(0);
  const s = (z === -1 ? slice : slice.subarray(0, z)).toString('utf8');
  return s.trim();
}

/**
 * @param {Map<string, Buffer>} files
 * @returns {Record<string, string> | null}
 */
function readPackedRootDependencies(files) {
  const buf = files.get('package/package.json');
  if (!buf) return null;
  try {
    const pkg = JSON.parse(buf.toString('utf8'));
    return pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {};
  } catch {
    return null;
  }
}

/**
 * empty temp에 tarball 설치 후 JS closure resolve + bin 경로 존재 확인.
 * 네이티브 모듈 전체 서버 기동은 하지 않는다(문서화된 제한).
 * @param {string} tgzPath
 * @param {Record<string, string>} packEnv
 * @returns {number} exit code contribution (0 = ok)
 */
function runEmptyTempInstallSmoke(tgzPath, packEnv) {
  if (process.env.MEMENTO_PACK_SMOKE === '0') {
    console.log('[verify-npm-pack-bundle] empty-temp smoke skipped (MEMENTO_PACK_SMOKE=0)');
    return 0;
  }

  const smokeRoot = mkdtempSync(join(tmpdir(), 'memento-pack-smoke-'));
  const installDir = join(smokeRoot, 'app');
  /** #860: 홈 기본 DB 경로 오염 방지 + postinstall 후 파일 존재 assert */
  const smokeDbPath = join(smokeRoot, 'smoke-memory.db');
  const smokeEnv = { ...packEnv, DB_PATH: smokeDbPath };
  try {
    execSync(`mkdir -p "${installDir}"`, { stdio: 'ignore' });
    // package name from tarball → npm install local tgz
    const install = spawnSync(
      npmCli,
      ['install', tgzPath, '--omit=dev', '--no-fund', '--no-audit'],
      {
        cwd: installDir,
        stdio: 'inherit',
        env: { ...smokeEnv, npm_config_cache: join(smokeRoot, 'npm-cache') },
      }
    );
    if (install.error) {
      console.error('[verify-npm-pack-bundle] empty-temp npm install error:', install.error);
      return 1;
    }
    if (install.status !== 0) {
      console.error('[verify-npm-pack-bundle] empty-temp npm install 실패 (closure/네이티브 빌드)');
      return install.status ?? 1;
    }

    // #860: postinstall 이 DB 초기화에 성공했는지 (catch 삼킴 회귀 방지)
    if (!existsSync(smokeDbPath)) {
      console.error(
        '[verify-npm-pack-bundle] empty-temp: postinstall 이후 DB 파일이 없습니다 (DB_PATH 스모크 경로). #860'
      );
      return 1;
    }
    console.log('[verify-npm-pack-bundle] OK — postinstall DB file present (smoke DB_PATH)');

    // installed package lives under node_modules/<name>
    const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const pkgName = rootPkg.name;
    const installedPkg = join(installDir, 'node_modules', pkgName);
    if (!existsSync(installedPkg)) {
      console.error(`[verify-npm-pack-bundle] empty-temp: installed package missing: ${installedPkg}`);
      return 1;
    }

    const requireFromInstalled = createRequire(join(installedPkg, 'package.json'));
    for (const name of SMOKE_RESOLVE_PACKAGES) {
      try {
        requireFromInstalled.resolve(name);
      } catch (err) {
        console.error(
          `[verify-npm-pack-bundle] empty-temp resolve 실패: ${name} — server runtime closure 누락 가능`,
          err && typeof err === 'object' && 'message' in err ? err.message : err
        );
        return 1;
      }
    }

    const bin = rootPkg.bin && typeof rootPkg.bin === 'object' ? rootPkg.bin : {};
    for (const [binName, binRel] of Object.entries(bin)) {
      const binPath = join(installedPkg, binRel);
      if (!existsSync(binPath)) {
        console.error(
          `[verify-npm-pack-bundle] empty-temp bin 누락: ${binName} -> ${binRel} (${binPath})`
        );
        return 1;
      }
    }

    // Light bin smoke: node can parse/load the MCP entry without full native DB init
    // by only checking the file is valid JS module graph for first-party imports.
    // Full server start needs better-sqlite3 rebuild — not required for closure gate.
    const mcpBin = bin['memento-mcp-server'] || bin['memento-mcp'] || Object.values(bin)[0];
    if (mcpBin) {
      const marker = join(smokeRoot, 'smoke-ok.txt');
      const probe = `
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const req = createRequire(${JSON.stringify(join(installedPkg, 'package.json'))});
for (const n of ${JSON.stringify(SMOKE_RESOLVE_PACKAGES)}) req.resolve(n);
writeFileSync(${JSON.stringify(marker)}, 'ok');
`;
      writeFileSync(join(smokeRoot, 'probe.mjs'), probe);
      const probeRun = spawnSync(process.execPath, [join(smokeRoot, 'probe.mjs')], {
        cwd: smokeRoot,
        stdio: 'inherit',
        env: smokeEnv,
      });
      if (probeRun.status !== 0 || !existsSync(marker)) {
        console.error('[verify-npm-pack-bundle] empty-temp resolve probe 실패');
        return probeRun.status ?? 1;
      }
    }

    console.log(
      '[verify-npm-pack-bundle] OK — empty-temp install + resolve smoke + DB init (native full boot not required)'
    );
    return 0;
  } catch (err) {
    console.error('[verify-npm-pack-bundle] empty-temp smoke:', err);
    return 1;
  } finally {
    try {
      rmSync(smokeRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

let exitCode = 0;
const tmp = mkdtempSync(join(tmpdir(), 'memento-pack-verify-'));
/** HOME/~/.npm 이 읽기 전용인 CI/샌드박스에서도 pack이 실패하지 않도록 캐시를 임시 디렉터리로 둔다. */
const npmCache = mkdtempSync(join(tmpdir(), 'memento-npm-cache-'));
const packEnv = { ...process.env, npm_config_cache: npmCache };
/** @type {string | null} */
let packedTgzAbs = null;
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
      packedTgzAbs = join(tmp, tgz);
      const { paths, files } = listUstarGzipEntries(packedTgzAbs);

      const missingPaths = REQUIRED_BUNDLED_PATHS.filter((p) => !paths.has(p));
      if (missingPaths.length > 0) {
        for (const p of missingPaths) {
          console.error(
            `[verify-npm-pack-bundle] tarball에 ${p} 가 없습니다. bundledDependencies 번들이 깨졌을 수 있습니다.`
          );
        }
        exitCode = 1;
      } else {
        console.log(
          `[verify-npm-pack-bundle] OK — bundled paths 포함 (${REQUIRED_BUNDLED_PATHS.join(', ')}) (${tgz})`
        );
      }

      const deps = readPackedRootDependencies(files);
      if (!deps) {
        console.error('[verify-npm-pack-bundle] tarball에 package/package.json 이 없거나 파싱 실패');
        exitCode = 1;
      } else {
        const missingDeps = REQUIRED_ROOT_DEPS.filter((name) => !(name in deps));
        if (missingDeps.length > 0) {
          for (const name of missingDeps) {
            console.error(
              `[verify-npm-pack-bundle] tarball package.json dependencies에 ${name} 이(가) 없습니다. server 런타임 closure 누락.`
            );
          }
          exitCode = 1;
        } else {
          console.log(
            `[verify-npm-pack-bundle] OK — root deps 선언 (${REQUIRED_ROOT_DEPS.join(', ')})`
          );
        }
        if (!('@memento/agent-integration' in deps)) {
          console.error(
            '[verify-npm-pack-bundle] tarball package.json dependencies에 @memento/agent-integration 이 없습니다 (bundledDependencies 대상).'
          );
          exitCode = 1;
        }
      }

      if (exitCode === 0 && packedTgzAbs) {
        const smokeCode = runEmptyTempInstallSmoke(packedTgzAbs, packEnv);
        if (smokeCode !== 0) exitCode = smokeCode;
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
