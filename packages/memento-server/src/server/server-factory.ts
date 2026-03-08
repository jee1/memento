/**
 * 서버 팩토리 모듈
 * 
 * 서버 타입에 따라 적절한 서버 인스턴스를 생성하는 팩토리 패턴 구현
 * 환경 변수 TRANSPORT_TYPE에 따라 stdio 또는 sse 서버를 생성합니다.
 */

/**
 * 지원되는 서버 전송 타입
 * - stdio: 표준 입출력을 통한 MCP 서버 (기본값)
 * - sse: Server-Sent Events를 통한 HTTP/SSE 서버
 */
export type ServerType = 'stdio' | 'sse';

/**
 * 서버 인스턴스 인터페이스
 * 
 * 모든 서버 타입이 구현해야 하는 공통 인터페이스
 */
export interface Server {
  /**
   * 서버를 시작합니다
   * @returns Promise<void> 서버 시작 완료 시 resolve
   * @throws 서버 시작 실패 시 예외 발생
   */
  start(): Promise<void>;

  /**
   * 서버를 중지합니다
   * @returns Promise<void> 서버 중지 완료 시 resolve
   * @throws 서버 중지 실패 시 예외 발생
   */
  stop(): Promise<void>;

  /**
   * 서버 리소스를 정리합니다
   * @returns Promise<void> 정리 완료 시 resolve
   * @throws 정리 실패 시 예외 발생
   */
  cleanup(): Promise<void>;
}

/**
 * 서버 팩토리 인터페이스
 * 
 * 서버 타입에 따라 적절한 서버 인스턴스를 생성하는 팩토리
 */
export interface ServerFactory {
  /**
   * 지정된 타입의 서버를 생성합니다
   * @param type 서버 타입 ('stdio' | 'sse')
   * @returns Server 인스턴스
   * @throws 지원되지 않는 서버 타입이거나 서버 생성 실패 시 예외 발생
   */
  createServer(type: ServerType): Server;

  /**
   * 환경 변수에 따라 적절한 서버를 생성합니다
   * TRANSPORT_TYPE 환경 변수를 확인하여 서버 타입을 결정합니다.
   * 환경 변수가 설정되지 않은 경우 기본값 'stdio'를 사용합니다.
   * @returns Server 인스턴스
   * @throws 서버 생성 실패 시 예외 발생
   */
  createServerFromEnv(): Server;
}

import { StdioServer } from './servers/stdio-server.js';
import { SseServer } from './servers/sse-server.js';

/**
 * 서버 팩토리 인스턴스를 생성합니다
 * @returns ServerFactory 인스턴스
 */
export function createServerFactory(): ServerFactory {
  return {
    createServer(type: ServerType): Server {
      switch (type) {
        case 'stdio':
          return new StdioServer();
        case 'sse':
          return new SseServer();
        default:
          throw new Error(`지원되지 않는 서버 타입: ${type}`);
      }
    },
    createServerFromEnv(): Server {
      const transportType = process.env.TRANSPORT_TYPE;
      
      // 환경 변수가 설정되지 않은 경우 기본값 'stdio' 사용
      if (!transportType) {
        return new StdioServer();
      }
      
      // 환경 변수 값을 소문자로 변환하여 비교
      const normalizedType = transportType.toLowerCase() as ServerType;
      
      if (normalizedType !== 'stdio' && normalizedType !== 'sse') {
        throw new Error(`지원되지 않는 TRANSPORT_TYPE: ${transportType}. 'stdio' 또는 'sse'를 사용하세요.`);
      }
      
      return this.createServer(normalizedType);
    }
  };
}

