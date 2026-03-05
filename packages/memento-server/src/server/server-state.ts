/**
 * ServerState 클래스
 * 
 * 전역 상태를 관리하는 싱글톤 클래스
 * globalThis 사용을 제거하고 클래스 기반 상태 관리로 전환
 * 
 * 상태 속성:
 * - mcpServerInitialized: MCP 서버 초기화 완료 여부
 * - consoleErrorOverridden: console.error 오버라이드 여부
 * - consoleOverridden: console 메서드 오버라이드 여부
 * - mcpTransportConnected: MCP 전송 계층 연결 여부
 * 
 * 싱글톤 패턴을 사용하여 전역 상태를 관리
 * 
 * 테스트 가능성:
 * - reset(): 모든 상태를 초기화 (테스트 격리용)
 * - resetInstance(): 싱글톤 인스턴스를 강제로 리셋 (테스트용, 주의해서 사용)
 */
export class ServerState {
  private static instance: ServerState | null = null;

  // 상태 속성들
  private mcpServerInitialized: boolean = false;
  private consoleErrorOverridden: boolean = false;
  private consoleOverridden: boolean = false;
  private mcpTransportConnected: boolean = false;

  /**
   * 싱글톤 인스턴스 가져오기
   * 
   * @returns ServerState 싱글톤 인스턴스
   */
  public static getInstance(): ServerState {
    if (ServerState.instance === null) {
      ServerState.instance = new ServerState();
    }
    return ServerState.instance;
  }

  /**
   * private 생성자 (싱글톤 패턴)
   */
  private constructor() {
    // 싱글톤 패턴: 외부에서 직접 인스턴스 생성 불가
  }

  /**
   * MCP 서버 초기화 상태 확인
   * 
   * @returns MCP 서버 초기화 완료 여부
   */
  public isMcpServerInitialized(): boolean {
    return this.mcpServerInitialized;
  }

  /**
   * MCP 서버 초기화 상태 설정
   * 
   * @param value 초기화 완료 여부
   */
  public setMcpServerInitialized(value: boolean): void {
    this.mcpServerInitialized = value;
  }

  /**
   * console.error 오버라이드 여부 확인
   * 
   * @returns console.error 오버라이드 여부
   */
  public isConsoleErrorOverridden(): boolean {
    return this.consoleErrorOverridden;
  }

  /**
   * console.error 오버라이드 여부 설정
   * 
   * @param value 오버라이드 여부
   */
  public setConsoleErrorOverridden(value: boolean): void {
    this.consoleErrorOverridden = value;
  }

  /**
   * console 메서드 오버라이드 여부 확인
   * 
   * @returns console 메서드 오버라이드 여부
   */
  public isConsoleOverridden(): boolean {
    return this.consoleOverridden;
  }

  /**
   * console 메서드 오버라이드 여부 설정
   * 
   * @param value 오버라이드 여부
   */
  public setConsoleOverridden(value: boolean): void {
    this.consoleOverridden = value;
  }

  /**
   * MCP 전송 계층 연결 여부 확인
   * 
   * @returns MCP 전송 계층 연결 여부
   */
  public isMcpTransportConnected(): boolean {
    return this.mcpTransportConnected;
  }

  /**
   * MCP 전송 계층 연결 여부 설정
   * 
   * @param value 연결 여부
   */
  public setMcpTransportConnected(value: boolean): void {
    this.mcpTransportConnected = value;
  }

  /**
   * 모든 상태를 초기화 (테스트용)
   * 
   * 테스트 격리를 위해 모든 상태를 false로 초기화
   * 인스턴스는 유지하고 상태만 초기화
   */
  public reset(): void {
    this.mcpServerInitialized = false;
    this.consoleErrorOverridden = false;
    this.consoleOverridden = false;
    this.mcpTransportConnected = false;
  }

  /**
   * 싱글톤 인스턴스를 강제로 리셋 (테스트용)
   * 
   * 주의: 이 메서드는 테스트 격리를 위해서만 사용해야 합니다.
   * 프로덕션 코드에서는 사용하지 마세요.
   * 
   * 테스트에서 완전히 새로운 인스턴스를 원할 때 사용
   */
  public static resetInstance(): void {
    ServerState.instance = null;
  }

  /**
   * 현재 상태 스냅샷 가져오기 (테스트용)
   * 
   * 테스트에서 상태를 저장하고 나중에 복원할 때 사용
   * 
   * @returns 현재 상태의 스냅샷
   */
  public getSnapshot(): ServerStateSnapshot {
    return {
      mcpServerInitialized: this.mcpServerInitialized,
      consoleErrorOverridden: this.consoleErrorOverridden,
      consoleOverridden: this.consoleOverridden,
      mcpTransportConnected: this.mcpTransportConnected
    };
  }

  /**
   * 상태 스냅샷으로 복원 (테스트용)
   * 
   * 테스트에서 저장한 상태를 복원할 때 사용
   * 
   * @param snapshot 복원할 상태 스냅샷
   */
  public restoreSnapshot(snapshot: ServerStateSnapshot): void {
    this.mcpServerInitialized = snapshot.mcpServerInitialized;
    this.consoleErrorOverridden = snapshot.consoleErrorOverridden;
    this.consoleOverridden = snapshot.consoleOverridden;
    this.mcpTransportConnected = snapshot.mcpTransportConnected;
  }
}

/**
 * ServerState 상태 스냅샷 타입
 * 테스트에서 상태를 저장하고 복원할 때 사용
 */
export interface ServerStateSnapshot {
  mcpServerInitialized: boolean;
  consoleErrorOverridden: boolean;
  consoleOverridden: boolean;
  mcpTransportConnected: boolean;
}
