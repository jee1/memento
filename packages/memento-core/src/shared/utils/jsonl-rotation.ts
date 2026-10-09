/* eslint-disable security/detect-non-literal-fs-filename -- 로그 경로는 env 설정이나 process.cwd() 기준 고정 디렉터리에서 온다. HTTP·MCP 입력이 닿지 않는다. */
import { rename, stat, unlink } from 'fs/promises';

export async function rotateJsonlIfNeeded(
  filePath: string,
  maxBytes: number,
  retainFiles: number,
): Promise<boolean> {
  if (maxBytes <= 0 || retainFiles < 1) {
    return false;
  }

  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (size < maxBytes) {
    return false;
  }

  const oldest = `${filePath}.${retainFiles}`;
  try {
    await unlink(oldest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  for (let index = retainFiles - 1; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`;
    const to = `${filePath}.${index + 1}`;
    try {
      await rename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  await rename(filePath, `${filePath}.1`);
  return true;
}
