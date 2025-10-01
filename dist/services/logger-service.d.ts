/**
 * 개선된 로거 서비스
 * 상세한 오류 추적 및 디버깅을 위한 로그 시스템
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    CRITICAL = 4
}
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    component: string;
    message: string;
    context?: Record<string, any>;
    stack?: string;
    requestId?: string;
    userId?: string;
    sessionId?: string;
}
export declare class LoggerService {
    private logLevel;
    private logDir;
    private logFile;
    private errorLogFile;
    private requestId;
    constructor();
    /**
     * 설정에서 로그 레벨 가져오기
     */
    private getLogLevelFromConfig;
    /**
     * 로그 디렉토리 생성
     */
    private ensureLogDirectory;
    /**
     * 요청 ID 설정 (요청 추적용)
     */
    setRequestId(requestId: string): void;
    /**
     * 디버그 로그
     */
    debug(component: string, message: string, context?: Record<string, any>): void;
    /**
     * 정보 로그
     */
    info(component: string, message: string, context?: Record<string, any>): void;
    /**
     * 경고 로그
     */
    warn(component: string, message: string, context?: Record<string, any>): void;
    /**
     * 오류 로그
     */
    error(component: string, message: string, error?: Error, context?: Record<string, any>): void;
    /**
     * 치명적 오류 로그
     */
    critical(component: string, message: string, error?: Error, context?: Record<string, any>): void;
    /**
     * 내부 로그 메서드
     */
    private log;
    /**
     * 콘솔에 로그 출력
     */
    private logToConsole;
    /**
     * 일반 로그 파일에 저장
     */
    private logToFile;
    /**
     * 오류 로그 파일에 저장
     */
    private logToErrorFile;
    /**
     * 데이터베이스 오류 전용 로그
     */
    logDatabaseError(operation: string, error: Error, context?: Record<string, any>): void;
    /**
     * 검색 엔진 오류 전용 로그
     */
    logSearchError(query: string, error: Error, context?: Record<string, any>): void;
    /**
     * 임베딩 서비스 오류 전용 로그
     */
    logEmbeddingError(operation: string, error: Error, context?: Record<string, any>): void;
    /**
     * MCP 서버 오류 전용 로그
     */
    logMCPServerError(operation: string, error: Error, context?: Record<string, any>): void;
    /**
     * 성능 모니터링 로그
     */
    logPerformance(component: string, operation: string, duration: number, context?: Record<string, any>): void;
    /**
     * 서비스 정리
     */
    cleanup(): void;
}
export declare const logger: LoggerService;
//# sourceMappingURL=logger-service.d.ts.map