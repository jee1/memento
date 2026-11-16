/**
 * ServerState: stdio 서버의 MCP 전송 연결 여부를 들고 있는 싱글톤
 *
 * mcp-logger 가 연결 전 로그를 막는 데 쓴다. 읽는 곳이 없던 초기화, 콘솔 덮어쓰기 플래그는 #1751 에서 지웠다.
 */
export class ServerState {
  private static instance: ServerState | null = null;

  private mcpTransportConnected: boolean = false;

  public static getInstance(): ServerState {
    if (ServerState.instance === null) {
      ServerState.instance = new ServerState();
    }
    return ServerState.instance;
  }

  private constructor() {}

  public isMcpTransportConnected(): boolean {
    return this.mcpTransportConnected;
  }

  public setMcpTransportConnected(value: boolean): void {
    this.mcpTransportConnected = value;
  }

  /** 테스트 격리용 */
  public reset(): void {
    this.mcpTransportConnected = false;
  }
}
