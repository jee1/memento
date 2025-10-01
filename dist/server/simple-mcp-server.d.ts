/**
 * 간단한 MCP 서버 구현
 * SSE 연결 문제 해결을 위한 최소 구현
 */
declare const app: import("express-serve-static-core").Express;
declare const server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
export { app, server };
//# sourceMappingURL=simple-mcp-server.d.ts.map