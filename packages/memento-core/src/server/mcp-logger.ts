/**
 * Core 패키지용 MCP 로거 스텁
 * MCP 서버 없이 라이브러리 모드에서 사용. stderr로만 출력.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function getCurrentLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const level = (envLevel || 'info') as LogLevel;
  return LOG_LEVEL_PRIORITY[level] !== undefined ? level : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getCurrentLogLevel()];
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/** stderr.write에 undefined가 넘어가면 Node가 문자열 "undefined"를 출력하므로 항상 문자열만 전달 */
function safeStderrWrite(chunk: string): void {
  const s = typeof chunk === 'string' ? chunk : String(chunk ?? '');
  if (s) process.stderr.write(s);
}

class MCPLoggerStub {
  private _server: { sendLoggingMessage?: (msg: unknown) => Promise<void> } | null = null;

  setServer(server: { sendLoggingMessage?: (msg: unknown) => Promise<void> } | null): void {
    this._server = server;
  }

  logServer(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const dataStr = data ? ' ' + JSON.stringify(data, null, 2) : '';
    const logMessage = `[${getTimestamp()}] [SERVER] [${level.toUpperCase()}] ${message}${dataStr}\n`;
    safeStderrWrite(logMessage);
  }

  logBatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const dataStr = data ? ' ' + JSON.stringify(data, null, 2) : '';
    const logMessage = `[${getTimestamp()}] [BATCH] [${level.toUpperCase()}] ${message}${dataStr}\n`;
    safeStderrWrite(logMessage);
  }

  async logMCPProtocol(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    if (this._server?.sendLoggingMessage) {
      await this._server.sendLoggingMessage({
        level,
        logger: 'mcp-protocol',
        data: { message, ...data }
      });
    }
  }
}

export const mcpLogger = new MCPLoggerStub();
