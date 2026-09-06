/**
 * Injectable log family roots for log_rotation (#852).
 * Production roots derive from dbPath / MEMENTO_HOME; tests inject temp dirs.
 */

import { homedir } from 'os';
import { dirname, join } from 'path';
import { mementoConfig } from '../../shared/config/index.js';

export interface LogRotationRoots {
  migrationLogDir: string;
  tripleExtractionLogDir: string;
  dockerDiagnosticsDir: string;
  logIssueMonitorDir: string;
}

export function resolveMementoLogsHome(): string {
  const home = process.env.MEMENTO_HOME;
  if (home && home.length > 0) {
    return join(home, 'logs');
  }
  return join(homedir(), '.memento', 'logs');
}

export function resolveLogRotationRoots(
  overrides?: Partial<LogRotationRoots>
): LogRotationRoots {
  const logsHome = resolveMementoLogsHome();
  return {
    migrationLogDir:
      overrides?.migrationLogDir ?? join(dirname(mementoConfig.dbPath), 'logs'),
    tripleExtractionLogDir:
      overrides?.tripleExtractionLogDir ??
      join(process.cwd(), 'logs', 'triple-extraction'),
    dockerDiagnosticsDir:
      overrides?.dockerDiagnosticsDir ?? join(logsHome, 'docker-diagnostics'),
    logIssueMonitorDir:
      overrides?.logIssueMonitorDir ?? join(logsHome, 'log-issue-monitor'),
  };
}
