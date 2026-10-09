/* eslint-disable security/detect-non-literal-fs-filename -- 로그 경로는 env 설정이나 process.cwd() 기준 고정 디렉터리에서 온다. HTTP·MCP 입력이 닿지 않는다. */
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { rotateJsonlIfNeeded } from '../../../shared/utils/jsonl-rotation.js';

export class RuntimeDiagnosticsLogger {
  constructor(
    private readonly enabled: boolean,
    private readonly logDir: string,
    private readonly jsonlMaxBytes = 64 * 1024 * 1024,
    private readonly jsonlRetainFiles = 3,
  ) {}

  async writeSample(sample: Record<string, unknown>): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.appendJsonl('app-runtime.jsonl', sample);
  }

  async writeEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.appendJsonl('app-events.jsonl', event);
  }

  private async appendJsonl(fileName: string, record: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true });
      const filePath = join(this.logDir, fileName);
      await rotateJsonlIfNeeded(filePath, this.jsonlMaxBytes, this.jsonlRetainFiles);
      await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      return;
    }
  }
}
