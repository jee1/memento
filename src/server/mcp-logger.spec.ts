/**
 * MCP Logger 테스트
 * MCP 전용 로거의 동작을 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPLogger } from './mcp-logger.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

describe('MCPLogger', () => {
  let logger: MCPLogger;
  let mockServer: Server;
  let originalStderrWrite: typeof process.stderr.write;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Given: 테스트 환경 설정
    logger = new MCPLogger();
    
    // Mock Server 생성
    mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined)
    } as unknown as Server;

    // stderr.write 모킹
    originalStderrWrite = process.stderr.write;
    process.stderr.write = vi.fn();

    // 환경 변수 백업
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // When: 테스트 후 정리
    process.stderr.write = originalStderrWrite;
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('setServer', () => {
    it('Server 인스턴스를 설정해야 함', () => {
      // Given: Server 인스턴스
      const server = mockServer;

      // When: Server 설정
      logger.setServer(server);

      // Then: Server가 설정되어야 함 (내부적으로 확인)
      expect(logger).toBeDefined();
    });
  });

  describe('logMCPProtocol', () => {
    it('Server가 있을 때 sendLoggingMessage를 호출해야 함', async () => {
      // Given: Server가 설정된 상태
      logger.setServer(mockServer);
      const message = '도구 목록 요청 처리';
      process.env.LOG_LEVEL = 'debug';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: MCP 프로토콜 로그 출력
      await logger.logMCPProtocol('debug', message);

      // Then: sendLoggingMessage가 호출되어야 함
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'debug',
        logger: 'mcp-protocol',
        data: message
      });
    });

    it('Server가 없을 때 stderr로 fallback해야 함', async () => {
      // Given: Server가 설정되지 않은 상태
      const message = '도구 목록 요청 처리';
      process.env.LOG_LEVEL = 'debug';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: MCP 프로토콜 로그 출력
      await logger.logMCPProtocol('debug', message);

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('[MCP]')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('로그 레벨이 낮으면 출력하지 않아야 함', async () => {
      // Given: LOG_LEVEL이 info인 상태
      logger.setServer(mockServer);
      process.env.LOG_LEVEL = 'info';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: debug 레벨 로그 출력
      await logger.logMCPProtocol('debug', 'Debug message');

      // Then: sendLoggingMessage가 호출되지 않아야 함
      expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    });

    it('MCP_LOG_PROTOCOL이 false일 때 debug 로그를 숨겨야 함', async () => {
      // Given: MCP_LOG_PROTOCOL이 false인 상태
      logger.setServer(mockServer);
      process.env.LOG_LEVEL = 'debug';
      process.env.MCP_LOG_PROTOCOL = 'false';

      // When: debug 레벨 로그 출력
      await logger.logMCPProtocol('debug', 'Debug message');

      // Then: sendLoggingMessage가 호출되지 않아야 함
      expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    });

    it('warn 레벨을 warning으로 변환해야 함', async () => {
      // Given: Server가 설정된 상태
      logger.setServer(mockServer);
      process.env.LOG_LEVEL = 'warn';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: warn 레벨 로그 출력
      await logger.logMCPProtocol('warn', 'Warning message');

      // Then: warning 레벨로 전송되어야 함
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'warning',
        logger: 'mcp-protocol',
        data: 'Warning message'
      });
    });

    it('sendLoggingMessage 실패 시 stderr로 fallback해야 함', async () => {
      // Given: sendLoggingMessage가 실패하는 Server
      const failingServer = {
        sendLoggingMessage: vi.fn().mockRejectedValue(new Error('Send failed'))
      } as unknown as Server;
      logger.setServer(failingServer);
      process.env.LOG_LEVEL = 'info';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: MCP 프로토콜 로그 출력
      await logger.logMCPProtocol('info', 'Test message');

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('[MCP]')
      );
    });

    it('data 파라미터를 포함해야 함', async () => {
      // Given: Server가 설정된 상태
      logger.setServer(mockServer);
      const message = '도구 실행';
      const data = { toolName: 'remember', count: 5 };
      process.env.LOG_LEVEL = 'info';
      process.env.MCP_LOG_PROTOCOL = 'true';

      // When: data와 함께 로그 출력
      await logger.logMCPProtocol('info', message, data);

      // Then: data가 포함되어야 함
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
        level: 'info',
        logger: 'mcp-protocol',
        data: { message, ...data }
      });
    });
  });

  describe('logServer', () => {
    it('stderr에 로그를 출력해야 함', () => {
      // Given: 로그 레벨이 info인 상태
      process.env.LOG_LEVEL = 'info';
      const message = '서버 초기화 완료';

      // When: 서버 로그 출력
      logger.logServer('info', message);

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('[SERVER]')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('로그 레벨이 낮으면 출력하지 않아야 함', () => {
      // Given: LOG_LEVEL이 warn인 상태
      process.env.LOG_LEVEL = 'warn';

      // When: info 레벨 로그 출력
      logger.logServer('info', 'Info message');

      // Then: stderr.write가 호출되지 않아야 함
      expect(process.stderr.write).not.toHaveBeenCalled();
    });

    it('data 파라미터를 포함해야 함', () => {
      // Given: 로그 레벨이 info인 상태
      process.env.LOG_LEVEL = 'info';
      const message = '서버 상태';
      const data = { uptime: 1000, activeJobs: 2 };

      // When: data와 함께 로그 출력
      logger.logServer('info', message, data);

      // Then: data가 포함되어야 함
      const callArg = (process.stderr.write as any).mock.calls[0][0];
      expect(callArg).toContain(message);
      expect(callArg).toContain('"uptime": 1000');
    });
  });

  describe('logBatch', () => {
    it('stderr에 로그를 출력해야 함', () => {
      // Given: 로그 레벨이 info인 상태
      process.env.LOG_LEVEL = 'info';
      const message = '메모리 정리 작업 시작';

      // When: 배치 로그 출력
      logger.logBatch('info', message);

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('[BATCH]')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('로그 레벨이 낮으면 출력하지 않아야 함', () => {
      // Given: LOG_LEVEL이 error인 상태
      process.env.LOG_LEVEL = 'error';

      // When: warn 레벨 로그 출력
      logger.logBatch('warn', 'Warning message');

      // Then: stderr.write가 호출되지 않아야 함
      expect(process.stderr.write).not.toHaveBeenCalled();
    });

    it('data 파라미터를 포함해야 함', () => {
      // Given: 로그 레벨이 info인 상태
      process.env.LOG_LEVEL = 'info';
      const message = '작업 완료';
      const data = { processed: 10, deleted: 5 };

      // When: data와 함께 로그 출력
      logger.logBatch('info', message, data);

      // Then: data가 포함되어야 함
      const callArg = (process.stderr.write as any).mock.calls[0][0];
      expect(callArg).toContain(message);
      expect(callArg).toContain('"processed": 10');
    });
  });

  describe('로그 레벨 필터링', () => {
    it('error 레벨은 항상 출력되어야 함', () => {
      // Given: LOG_LEVEL이 info인 상태
      process.env.LOG_LEVEL = 'info';

      // When: error 레벨 로그 출력
      logger.logServer('error', 'Error message');

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
    });

    it('warn 레벨은 info 이상에서 출력되어야 함', () => {
      // Given: LOG_LEVEL이 info인 상태
      process.env.LOG_LEVEL = 'info';

      // When: warn 레벨 로그 출력
      logger.logServer('warn', 'Warning message');

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
    });

    it('info 레벨은 info 이상에서 출력되어야 함', () => {
      // Given: LOG_LEVEL이 info인 상태
      process.env.LOG_LEVEL = 'info';

      // When: info 레벨 로그 출력
      logger.logServer('info', 'Info message');

      // Then: stderr.write가 호출되어야 함
      expect(process.stderr.write).toHaveBeenCalledTimes(1);
    });

    it('debug 레벨은 debug에서만 출력되어야 함', () => {
      // Given: LOG_LEVEL이 info인 상태
      process.env.LOG_LEVEL = 'info';

      // When: debug 레벨 로그 출력
      logger.logServer('debug', 'Debug message');

      // Then: stderr.write가 호출되지 않아야 함
      expect(process.stderr.write).not.toHaveBeenCalled();
    });
  });
});
