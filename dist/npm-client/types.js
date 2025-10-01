/**
 * @memento/client 타입 정의
 * Memento MCP Server와 통신하기 위한 클라이언트 라이브러리 타입들
 */
// ============================================================================
// 에러 타입들
// ============================================================================
export class MementoError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code, statusCode, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'MementoError';
    }
}
export class ConnectionError extends MementoError {
    constructor(message, details) {
        super(message, 'CONNECTION_ERROR', undefined, details);
        this.name = 'ConnectionError';
    }
}
export class AuthenticationError extends MementoError {
    constructor(message, details) {
        super(message, 'AUTHENTICATION_ERROR', 401, details);
        this.name = 'AuthenticationError';
    }
}
export class ValidationError extends MementoError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 400, details);
        this.name = 'ValidationError';
    }
}
export class NotFoundError extends MementoError {
    constructor(message, details) {
        super(message, 'NOT_FOUND', 404, details);
        this.name = 'NotFoundError';
    }
}
//# sourceMappingURL=types.js.map