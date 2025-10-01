/**
 * Memento MCP Client
 * MCP 서버와 통신하는 클라이언트 라이브러리
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export class MementoClient {
    client;
    connected = false;
    constructor() {
        this.client = new Client({
            name: 'memento-client',
            version: '0.1.0'
        }, {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {}
            }
        });
    }
    /**
     * MCP 서버에 연결
     */
    async connect() {
        try {
            // stdio를 통해 서버에 연결
            const transport = new StdioClientTransport({
                command: 'node',
                args: ['dist/server/index.js']
            });
            await this.client.connect(transport);
            this.connected = true;
            console.log('✅ Memento MCP 서버에 연결되었습니다');
        }
        catch (error) {
            console.error('❌ MCP 서버 연결 실패:', error);
            throw error;
        }
    }
    /**
     * 연결 해제
     */
    async disconnect() {
        if (this.connected) {
            await this.client.close();
            this.connected = false;
            console.log('🔌 MCP 서버 연결이 해제되었습니다');
        }
    }
    /**
     * 기억 저장
     */
    async remember(params) {
        this.ensureConnected();
        const result = await this.client.callTool({
            name: 'remember',
            arguments: params
        });
        if (result.content && Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]) {
            const response = JSON.parse(result.content[0].text);
            return response.memory_id;
        }
        throw new Error('기억 저장에 실패했습니다');
    }
    /**
     * 기억 검색
     */
    async recall(params) {
        this.ensureConnected();
        const result = await this.client.callTool({
            name: 'recall',
            arguments: params
        });
        if (result.content && Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]) {
            const response = JSON.parse(result.content[0].text);
            // 응답 구조: { items: { items: [...], total_count: ..., query_time: ... }, ... }
            return response.items?.items || [];
        }
        throw new Error('기억 검색에 실패했습니다');
    }
    /**
     * 기억 삭제
     */
    async forget(params) {
        this.ensureConnected();
        const result = await this.client.callTool({
            name: 'forget',
            arguments: params
        });
        if (result.content && Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]) {
            const response = JSON.parse(result.content[0].text);
            return response.message;
        }
        throw new Error('기억 삭제에 실패했습니다');
    }
    /**
     * 기억 고정
     */
    async pin(params) {
        this.ensureConnected();
        const result = await this.client.callTool({
            name: 'pin',
            arguments: params
        });
        if (result.content && Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]) {
            const response = JSON.parse(result.content[0].text);
            return response.message;
        }
        throw new Error('기억 고정에 실패했습니다');
    }
    /**
     * 기억 고정 해제
     */
    async unpin(params) {
        this.ensureConnected();
        const result = await this.client.callTool({
            name: 'unpin',
            arguments: params
        });
        if (result.content && Array.isArray(result.content) && result.content[0] && 'text' in result.content[0]) {
            const response = JSON.parse(result.content[0].text);
            return response.message;
        }
        throw new Error('기억 고정 해제에 실패했습니다');
    }
    /**
     * 연결 상태 확인
     */
    ensureConnected() {
        if (!this.connected) {
            throw new Error('MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.');
        }
    }
    /**
     * 연결 상태 반환
     */
    isConnected() {
        return this.connected;
    }
    /**
     * 일반적인 도구 호출
     */
    async callTool(name, args = {}) {
        if (!this.connected) {
            throw new Error('서버에 연결되지 않았습니다');
        }
        try {
            const result = await this.client.callTool({
                name,
                arguments: args
            });
            // 결과 파싱
            if (result.content && Array.isArray(result.content) && result.content.length > 0) {
                const content = result.content[0];
                if (content.type === 'text') {
                    try {
                        return JSON.parse(content.text);
                    }
                    catch {
                        return content.text;
                    }
                }
                return content;
            }
            return result;
        }
        catch (error) {
            throw new Error(`도구 호출 실패 (${name}): ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
/**
 * 간편한 사용을 위한 팩토리 함수
 */
export function createMementoClient() {
    return new MementoClient();
}
//# sourceMappingURL=index.js.map