/**
 * 기본 도구 클래스
 * 모든 MCP 도구의 기본 구조를 제공
 */
export class BaseTool {
    name;
    description;
    inputSchema;
    constructor(name, description, inputSchema) {
        this.name = name;
        this.description = description;
        this.inputSchema = inputSchema;
    }
    /**
     * 도구 정의 반환
     */
    getDefinition() {
        return {
            name: this.name,
            description: this.description,
            inputSchema: this.inputSchema,
            handler: this.handle.bind(this),
        };
    }
    /**
     * 성공 결과 생성
     */
    createSuccessResult(data) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(data),
                },
            ],
        };
    }
    /**
     * 에러 결과 생성
     */
    createErrorResult(error, message, details) {
        return {
            error,
            ...(message && { message }),
            ...(details && { details }),
        };
    }
    /**
     * 데이터베이스 연결 확인
     */
    validateDatabase(context) {
        if (!context.db) {
            throw new Error('데이터베이스가 초기화되지 않았습니다');
        }
    }
    /**
     * 서비스 확인
     */
    validateService(service, serviceName) {
        if (!service) {
            throw new Error(`${serviceName}이 초기화되지 않았습니다`);
        }
    }
}
//# sourceMappingURL=base-tool.js.map