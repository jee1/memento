/**
 * CLI 전용 .env 로드 유틸
 * 명세: REQ-CFG-2, REQ-CFG-3, REQ-OPT-2, REQ-OPT-3
 * 탐색 순서: envFile → configDir/MEMENTO_CONFIG_DIR → cwd → ~/.memento/.env
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { config } from 'dotenv';

export interface EnvLoaderOptions {
  /** 사용자 지정 .env 파일 경로 (있으면 이 파일만 사용, 없으면 에러) */
  envFile?: string;
  /** 사용자 지정 설정 디렉터리 (이 디렉터리 내 .env 사용) */
  configDir?: string;
}

/**
 * .env 탐색 순서에 따라 경로를 결정하고, 파일이 있으면 로드한다.
 * - envFile이 있으면 해당 파일만 사용(존재하지 않으면 에러).
 * - 없으면 configDir 또는 MEMENTO_CONFIG_DIR/.env, cwd/.env, ~/.memento/.env 순서.
 * @returns 선택된 .env 경로. 파일이 없을 때도 기본 경로(~/.memento/.env)를 반환할 수 있음.
 *   실제 로드 여부는 loadEnv() 호출 결과 또는 existsSync(반환경로)로 확인해야 함. (REQ-CFG-4)
 */
export function resolveEnvPath(options: EnvLoaderOptions = {}): string {
  const { envFile, configDir } = options;

  if (envFile !== undefined && envFile !== '') {
    if (!fs.existsSync(envFile)) {
      throw new Error(`Env file not found: ${envFile}`);
    }
    return path.resolve(envFile);
  }

  const dirForConfig = configDir ?? process.env.MEMENTO_CONFIG_DIR;
  if (dirForConfig) {
    const p = path.join(path.resolve(dirForConfig), '.env');
    if (fs.existsSync(p)) return p;
  }

  const cwdEnv = path.join(process.cwd(), '.env');
  if (fs.existsSync(cwdEnv)) return cwdEnv;

  const homeEnv = path.join(os.homedir(), '.memento', '.env');
  if (fs.existsSync(homeEnv)) return homeEnv;

  return path.join(os.homedir(), '.memento', '.env');
}

/**
 * resolveEnvPath로 경로를 정한 뒤, 해당 경로에 파일이 있으면 dotenv.config({ path }) 호출.
 * 없으면 무시(에러 아님).
 */
export function loadEnv(options: EnvLoaderOptions = {}): void {
  const resolved = resolveEnvPath(options);
  if (fs.existsSync(resolved)) {
    config({ path: resolved });
  }
}
