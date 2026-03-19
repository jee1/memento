/**
 * SSE 서버 구현
 * 
 * Server-Sent Events를 통한 HTTP/SSE 서버를 래핑하는 클래스
 */

import type { Server } from '../server-factory.js';
import { startSseServer, stopSseServer, cleanupSseServer } from '../sse-server-impl.js';

/**
 * SSE 서버 클래스
 * 
 * Server-Sent Events를 통한 HTTP/SSE 서버를 구현합니다.
 */
export class SseServer implements Server {
  private isRunning = false;

  /**
   * 서버를 시작합니다
   * @returns Promise<void> 서버 시작 완료 시 resolve
   * @throws 서버 시작 실패 시 예외 발생
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('SSE 서버가 이미 실행 중입니다');
    }

    this.isRunning = true;
    try {
      await startSseServer();
    } catch (error) {
      this.isRunning = false;
      throw error;
    }
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

    await stopSseServer();
    this.isRunning = false;
  }

  /**
   * 서버 리소스를 정리합니다
   * @returns Promise<void> 정리 완료 시 resolve
   * @throws 정리 실패 시 예외 발생
   */
  async cleanup(): Promise<void> {
    await cleanupSseServer();
    this.isRunning = false;
  }
}

