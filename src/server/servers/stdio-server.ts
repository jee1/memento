/**
 * Stdio 서버 구현
 * 
 * 표준 입출력을 통한 MCP 서버를 래핑하는 클래스
 */

import type { Server } from '../server-factory.js';
import { startStdioServer } from '../stdio-server-impl.js';

/**
 * Stdio 서버 클래스
 * 
 * 표준 입출력을 통한 MCP 서버를 구현합니다.
 */
export class StdioServer implements Server {
  private isRunning = false;
  private stopPromise: Promise<void> | null = null;

  /**
   * 서버를 시작합니다
   * @returns Promise<void> 서버 시작 완료 시 resolve
   * @throws 서버 시작 실패 시 예외 발생
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Stdio 서버가 이미 실행 중입니다');
    }

    this.isRunning = true;
    this.stopPromise = startStdioServer();
    
    // 서버가 종료될 때까지 대기
    await this.stopPromise;
    this.isRunning = false;
    this.stopPromise = null;
  }

  /**
   * 서버를 중지합니다
   * @returns Promise<void> 서버 중지 완료 시 resolve
   * @throws 서버 중지 실패 시 예외 발생
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // SIGTERM 신호를 보내서 서버 종료
    process.emit('SIGTERM', 'SIGTERM');
    
    // 서버가 종료될 때까지 대기
    if (this.stopPromise) {
      await this.stopPromise;
    }
    
    this.isRunning = false;
    this.stopPromise = null;
  }

  /**
   * 서버 리소스를 정리합니다
   * @returns Promise<void> 정리 완료 시 resolve
   * @throws 정리 실패 시 예외 발생
   */
  async cleanup(): Promise<void> {
    await this.stop();
  }
}

