/**
 * 서버 팩토리 타입 검증 테스트
 * 
 * Given/When/Then 구조를 따르는 타입 검증 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ServerType, Server, ServerFactory } from './server-factory.js';
import { createServerFactory } from './server-factory.js';

describe('server-factory 타입 검증', () => {
  describe('ServerType 타입 검증', () => {
    /**
     * @given ServerType 타입이 정의되어 있음
     * @when 'stdio' 값을 ServerType으로 사용
     * @then 타입 오류가 발생하지 않아야 함
     */
    it('should accept stdio as ServerType', () => {
      const stdioType: ServerType = 'stdio';
      expect(stdioType).toBe('stdio');
    });

    /**
     * @given ServerType 타입이 정의되어 있음
     * @when 'sse' 값을 ServerType으로 사용
     * @then 타입 오류가 발생하지 않아야 함
     */
    it('should accept sse as ServerType', () => {
      const sseType: ServerType = 'sse';
      expect(sseType).toBe('sse');
    });
  });

  describe('Server 인터페이스 검증', () => {
    /**
     * @given Server 인터페이스가 정의되어 있음
     * @when Server 인터페이스를 구현하는 객체를 생성
     * @then start(), stop(), cleanup() 메서드가 모두 존재해야 함
     */
    it('should have required methods in Server interface', () => {
      const mockServer: Server = {
        async start() {
          // Mock implementation
        },
        async stop() {
          // Mock implementation
        },
        async cleanup() {
          // Mock implementation
        }
      };

      expect(typeof mockServer.start).toBe('function');
      expect(typeof mockServer.stop).toBe('function');
      expect(typeof mockServer.cleanup).toBe('function');
    });

    /**
     * @given Server 인터페이스가 정의되어 있음
     * @when Server 인터페이스를 구현하는 객체의 메서드가 Promise를 반환
     * @then 모든 메서드가 Promise<void>를 반환해야 함
     */
    it('should have methods that return Promise<void>', async () => {
      const mockServer: Server = {
        async start() {
          return Promise.resolve();
        },
        async stop() {
          return Promise.resolve();
        },
        async cleanup() {
          return Promise.resolve();
        }
      };

      await expect(mockServer.start()).resolves.toBeUndefined();
      await expect(mockServer.stop()).resolves.toBeUndefined();
      await expect(mockServer.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('ServerFactory 인터페이스 검증', () => {
    /**
     * @given ServerFactory 인터페이스가 정의되어 있음
     * @when ServerFactory 인터페이스를 구현하는 객체를 생성
     * @then createServer()와 createServerFromEnv() 메서드가 모두 존재해야 함
     */
    it('should have required methods in ServerFactory interface', () => {
      const mockFactory: ServerFactory = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
        createServer(_type: ServerType): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        },
        createServerFromEnv(): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        }
      };

      expect(typeof mockFactory.createServer).toBe('function');
      expect(typeof mockFactory.createServerFromEnv).toBe('function');
    });

    /**
     * @given ServerFactory 인터페이스가 정의되어 있음
     * @when createServer() 메서드를 호출하여 Server 인스턴스를 생성
     * @then 반환된 객체가 Server 인터페이스를 구현해야 함
     */
    it('should return Server instance from createServer', () => {
      const mockFactory: ServerFactory = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
        createServer(_type: ServerType): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        },
        createServerFromEnv(): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        }
      };

      const server = mockFactory.createServer('stdio');
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.cleanup).toBe('function');
    });

    /**
     * @given ServerFactory 인터페이스가 정의되어 있음
     * @when createServerFromEnv() 메서드를 호출하여 Server 인스턴스를 생성
     * @then 반환된 객체가 Server 인터페이스를 구현해야 함
     */
    it('should return Server instance from createServerFromEnv', () => {
      const mockFactory: ServerFactory = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
        createServer(_type: ServerType): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        },
        createServerFromEnv(): Server {
          return {
            async start() {},
            async stop() {},
            async cleanup() {}
          };
        }
      };

      const server = mockFactory.createServerFromEnv();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.cleanup).toBe('function');
    });
  });

  describe('서버 팩토리 구현 (TDD)', () => {
    let factory: ServerFactory;
    const originalEnv = process.env;

    beforeEach(() => {
      factory = createServerFactory();
      // 환경 변수 초기화
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    describe('stdio 서버 생성', () => {
      /**
       * @given 서버 팩토리 인터페이스 정의 완료
       * @when stdio 서버 생성 테스트 작성 (RED)
       * @then 테스트 실패 확인
       */
      it('should create stdio server', () => {
        const server = factory.createServer('stdio');
        expect(server).toBeDefined();
        expect(typeof server.start).toBe('function');
        expect(typeof server.stop).toBe('function');
        expect(typeof server.cleanup).toBe('function');
      });
    });

    describe('SSE 서버 생성', () => {
      /**
       * @given stdio 서버 생성 테스트 통과
       * @when SSE 서버 생성 테스트 작성 (RED)
       * @then 테스트 실패 확인
       */
      it('should create sse server', () => {
        const server = factory.createServer('sse');
        expect(server).toBeDefined();
        expect(typeof server.start).toBe('function');
        expect(typeof server.stop).toBe('function');
        expect(typeof server.cleanup).toBe('function');
      });
    });

    describe('환경 변수 기반 서버 선택', () => {
      /**
       * @given 모든 서버 생성 테스트 통과
       * @when 환경 변수 기반 서버 선택 로직 테스트 작성 (RED)
       * @then 테스트 실패 확인
       */
      it('should create server from TRANSPORT_TYPE environment variable', () => {
        process.env.TRANSPORT_TYPE = 'stdio';
        const server = factory.createServerFromEnv();
        expect(server).toBeDefined();
        expect(typeof server.start).toBe('function');
      });

      it('should create sse server when TRANSPORT_TYPE is sse', () => {
        process.env.TRANSPORT_TYPE = 'sse';
        const server = factory.createServerFromEnv();
        expect(server).toBeDefined();
        expect(typeof server.start).toBe('function');
      });
    });

    describe('기본값 stdio 동작', () => {
      /**
       * @given 환경 변수 기반 서버 선택 테스트 통과
       * @when TRANSPORT_TYPE 미설정 시 기본값 stdio 동작 테스트 작성 (RED)
       * @then 테스트 실패 확인
       */
      it('should default to stdio when TRANSPORT_TYPE is not set', () => {
        delete process.env.TRANSPORT_TYPE;
        const server = factory.createServerFromEnv();
        expect(server).toBeDefined();
        expect(typeof server.start).toBe('function');
      });
    });
  });
});

