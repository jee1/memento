import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export class RuntimeDiagnosticsLogger {
  constructor(
    private readonly enabled: boolean,
    private readonly logDir: string
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
      await appendFile(join(this.logDir, fileName), `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      return;
    }
  }
}
