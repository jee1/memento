/**
 * 개선된 로거 서비스
 * 상세한 오류 추적 및 디버깅을 위한 로그 시스템
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { mementoConfig } from '../config/index.js';
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    LogLevel[LogLevel["CRITICAL"] = 4] = "CRITICAL";
})(LogLevel || (LogLevel = {}));
export class LoggerService {
    logLevel;
    logDir;
    logFile;
    errorLogFile;
    requestId = '';
    constructor() {
        this.logLevel = this.getLogLevelFromConfig();
        this.logDir = './logs';
        this.logFile = join(this.logDir, 'memento-server.log');
        this.errorLogFile = join(this.logDir, 'memento-errors.log');
        this.ensureLogDirectory();
    }
    /**
     * 설정에서 로그 레벨 가져오기
     */
    getLogLevelFromConfig() {
        const level = mementoConfig.logLevel?.toLowerCase();
        switch (level) {
            case 'debug': return LogLevel.DEBUG;
            case 'info': return LogLevel.INFO;
            case 'warn': return LogLevel.WARN;
            case 'error': return LogLevel.ERROR;
            case 'critical': return LogLevel.CRITICAL;
            default: return LogLevel.INFO;
        }
    }
    /**
     * 로그 디렉토리 생성
     */
    ensureLogDirectory() {
        if (!existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true });
        }
    }
    /**
     * 요청 ID 설정 (요청 추적용)
     */
    setRequestId(requestId) {
        this.requestId = requestId;
    }
    /**
     * 디버그 로그
     */
    debug(component, message, context) {
        this.log(LogLevel.DEBUG, component, message, context);
    }
    /**
     * 정보 로그
     */
    info(component, message, context) {
        this.log(LogLevel.INFO, component, message, context);
    }
    /**
     * 경고 로그
     */
    warn(component, message, context) {
        this.log(LogLevel.WARN, component, message, context);
    }
    /**
     * 오류 로그
     */
    error(component, message, error, context) {
        const logContext = {
            ...context,
            errorName: error?.name,
            errorMessage: error?.message,
            errorCode: error?.code,
            errorErrno: error?.errno,
            errorSyscall: error?.syscall,
            errorPath: error?.path
        };
        this.log(LogLevel.ERROR, component, message, logContext, error?.stack);
    }
    /**
     * 치명적 오류 로그
     */
    critical(component, message, error, context) {
        const logContext = {
            ...context,
            errorName: error?.name,
            errorMessage: error?.message,
            errorCode: error?.code,
            errorErrno: error?.errno,
            errorSyscall: error?.syscall,
            errorPath: error?.path
        };
        this.log(LogLevel.CRITICAL, component, message, logContext, error?.stack);
    }
    /**
     * 내부 로그 메서드
     */
    log(level, component, message, context, stack) {
        // 로그 레벨 체크
        if (level < this.logLevel) {
            return;
        }
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            component,
            message,
            context,
            stack,
            requestId: this.requestId
        };
        // 콘솔 출력 (MCP 모드에서는 stderr 사용)
        this.logToConsole(logEntry);
        // 파일 출력
        this.logToFile(logEntry);
        // 오류는 별도 파일에도 저장
        if (level >= LogLevel.ERROR) {
            this.logToErrorFile(logEntry);
        }
    }
    /**
     * 콘솔에 로그 출력
     */
    logToConsole(entry) {
        const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
        const colors = {
            [LogLevel.DEBUG]: '\x1b[36m', // cyan
            [LogLevel.INFO]: '\x1b[32m', // green
            [LogLevel.WARN]: '\x1b[33m', // yellow
            [LogLevel.ERROR]: '\x1b[31m', // red
            [LogLevel.CRITICAL]: '\x1b[41m\x1b[37m' // red background, white text
        };
        const resetColor = '\x1b[0m';
        const color = colors[entry.level] || '';
        const levelName = levelNames[entry.level];
        // MCP 모드에서는 stderr 사용, 일반 모드에서는 console 사용
        const output = process.stdin.isTTY === false && process.stdout.isTTY === false
            ? process.stderr
            : process.stdout;
        const logLine = `${color}[${levelName}]${resetColor} ${entry.timestamp} [${entry.component}] ${entry.message}`;
        if (entry.context && Object.keys(entry.context).length > 0) {
            output.write(logLine + `\n  Context: ${JSON.stringify(entry.context, null, 2)}\n`);
        }
        else {
            output.write(logLine + '\n');
        }
        if (entry.stack) {
            output.write(`  Stack: ${entry.stack}\n`);
        }
    }
    /**
     * 일반 로그 파일에 저장
     */
    logToFile(entry) {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            writeFileSync(this.logFile, logLine, { flag: 'a' });
        }
        catch (error) {
            // 로그 파일 쓰기 실패 시 콘솔에 출력
            process.stderr.write(`Failed to write to log file: ${error}\n`);
        }
    }
    /**
     * 오류 로그 파일에 저장
     */
    logToErrorFile(entry) {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            writeFileSync(this.errorLogFile, logLine, { flag: 'a' });
        }
        catch (error) {
            // 오류 로그 파일 쓰기 실패 시 콘솔에 출력
            process.stderr.write(`Failed to write to error log file: ${error}\n`);
        }
    }
    /**
     * 데이터베이스 오류 전용 로그
     */
    logDatabaseError(operation, error, context) {
        this.error('Database', `Database operation failed: ${operation}`, error, {
            ...context,
            operation,
            databasePath: mementoConfig.dbPath,
            nodeEnv: mementoConfig.nodeEnv
        });
    }
    /**
     * 검색 엔진 오류 전용 로그
     */
    logSearchError(query, error, context) {
        this.error('SearchEngine', `Search operation failed`, error, {
            ...context,
            query,
            queryLength: query.length,
            searchType: context?.searchType || 'unknown'
        });
    }
    /**
     * 임베딩 서비스 오류 전용 로그
     */
    logEmbeddingError(operation, error, context) {
        this.error('EmbeddingService', `Embedding operation failed: ${operation}`, error, {
            ...context,
            operation,
            provider: mementoConfig.embeddingProvider,
            dimensions: mementoConfig.embeddingDimensions
        });
    }
    /**
     * MCP 서버 오류 전용 로그
     */
    logMCPServerError(operation, error, context) {
        this.critical('MCPServer', `MCP Server operation failed: ${operation}`, error, {
            ...context,
            operation,
            serverName: mementoConfig.serverName,
            serverVersion: mementoConfig.serverVersion
        });
    }
    /**
     * 성능 모니터링 로그
     */
    logPerformance(component, operation, duration, context) {
        this.info('Performance', `${component} - ${operation} completed`, {
            ...context,
            operation,
            duration,
            durationMs: `${duration}ms`
        });
    }
    /**
     * 서비스 정리
     */
    cleanup() {
        // 로그 서비스 정리 (필요시)
    }
}
// 전역 로거 인스턴스
export const logger = new LoggerService();
//# sourceMappingURL=logger-service.js.map