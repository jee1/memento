/**
 * MementoClient 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MementoClient, createMementoClient } from './index.js';
import type { 
  RememberParams, 
  RecallParams, 
  ForgetParams, 
  PinParams, 
  UnpinParams 
} from '../types/index.js';

// Mock @modelcontextprotocol/sdk
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn()
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn()
}));

describe('MementoClient', () => {
  let mementoClient: MementoClient;
  let mockClient: any;
  let mockTransport: any;

  beforeEach(async () => {
    // Mock transport
    mockTransport = {
      // transport methods if needed
    };

    // Mock client
    mockClient = {
      connect: vi.fn(),
      close: vi.fn(),
      callTool: vi.fn()
    };

    // Mock Client constructor
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    vi.mocked(Client).mockImplementation(() => mockClient);

    // Mock StdioClientTransport constructor
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    vi.mocked(StdioClientTransport).mockImplementation(() => mockTransport);

    mementoClient = new MementoClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('생성자', () => {
    it('새로운 MementoClient 인스턴스를 생성해야 함', () => {
      expect(mementoClient).toBeInstanceOf(MementoClient);
      expect(mementoClient.isConnected()).toBe(false);
    });

    it('createMementoClient 팩토리 함수가 올바르게 작동해야 함', () => {
      const client = createMementoClient();
      expect(client).toBeInstanceOf(MementoClient);
    });
  });

  describe('connect', () => {
    it('성공적으로 연결되어야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await mementoClient.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);
      expect(mementoClient.isConnected()).toBe(true);
    });

    it('연결 실패 시 에러를 던져야 함', async () => {
      const error = new Error('연결 실패');
      mockClient.connect.mockRejectedValue(error);

      await expect(mementoClient.connect()).rejects.toThrow('연결 실패');
      expect(mementoClient.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('연결된 상태에서 연결을 해제해야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.close.mockResolvedValue(undefined);

      await mementoClient.connect();
      await mementoClient.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mementoClient.isConnected()).toBe(false);
    });

    it('연결되지 않은 상태에서 호출해도 에러가 발생하지 않아야 함', async () => {
      await expect(mementoClient.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('remember', () => {
    const rememberParams: RememberParams = {
      content: '테스트 기억',
      type: 'episodic',
      tags: ['test'],
      importance: 0.8,
      source: 'test'
    };

    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('기억을 성공적으로 저장해야 함', async () => {
      const expectedMemoryId = 'test-memory-id';
      mockClient.callTool.mockResolvedValue({
        content: [{ text: JSON.stringify({ memory_id: expectedMemoryId }), type: 'text' }]
      });

      const result = await mementoClient.remember(rememberParams);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'remember',
        arguments: rememberParams
      });
      expect(result).toBe(expectedMemoryId);
    });

    it('응답 파싱 실패 시 에러를 던져야 함', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ text: 'invalid json', type: 'text' }]
      });

      await expect(mementoClient.remember(rememberParams)).rejects.toThrow();
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.remember(rememberParams)).rejects.toThrow(
        'MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.'
      );
    });
  });

  describe('recall', () => {
    const recallParams: RecallParams = {
      query: '테스트 검색',
      limit: 10
    };

    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('기억을 성공적으로 검색해야 함', async () => {
      const expectedResults = [
        { id: '1', content: '테스트 기억 1', type: 'episodic' },
        { id: '2', content: '테스트 기억 2', type: 'semantic' }
      ];
      
      mockClient.callTool.mockResolvedValue({
        content: [{ 
          text: JSON.stringify({ 
            items: { 
              items: expectedResults, 
              total_count: 2, 
              query_time: 0.1 
            } 
          }), 
          type: 'text' 
        }]
      });

      const result = await mementoClient.recall(recallParams);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'recall',
        arguments: recallParams
      });
      expect(result).toEqual(expectedResults);
    });

    it('검색 결과가 없을 때 빈 배열을 반환해야 함', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ 
          text: JSON.stringify({ 
            items: { 
              items: [], 
              total_count: 0, 
              query_time: 0.1 
            } 
          }), 
          type: 'text' 
        }]
      });

      const result = await mementoClient.recall(recallParams);
      expect(result).toEqual([]);
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.recall(recallParams)).rejects.toThrow(
        'MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.'
      );
    });
  });

  describe('forget', () => {
    const forgetParams: ForgetParams = {
      id: 'test-memory-id',
      hard: false
    };

    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('기억을 성공적으로 삭제해야 함', async () => {
      const expectedMessage = '기억이 삭제되었습니다';
      mockClient.callTool.mockResolvedValue({
        content: [{ text: JSON.stringify({ message: expectedMessage }), type: 'text' }]
      });

      const result = await mementoClient.forget(forgetParams);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'forget',
        arguments: forgetParams
      });
      expect(result).toBe(expectedMessage);
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.forget(forgetParams)).rejects.toThrow(
        'MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.'
      );
    });
  });

  describe('pin', () => {
    const pinParams: PinParams = {
      id: 'test-memory-id'
    };

    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('기억을 성공적으로 고정해야 함', async () => {
      const expectedMessage = '기억이 고정되었습니다';
      mockClient.callTool.mockResolvedValue({
        content: [{ text: JSON.stringify({ message: expectedMessage }), type: 'text' }]
      });

      const result = await mementoClient.pin(pinParams);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'pin',
        arguments: pinParams
      });
      expect(result).toBe(expectedMessage);
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.pin(pinParams)).rejects.toThrow(
        'MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.'
      );
    });
  });

  describe('unpin', () => {
    const unpinParams: UnpinParams = {
      id: 'test-memory-id'
    };

    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('기억 고정을 성공적으로 해제해야 함', async () => {
      const expectedMessage = '기억 고정이 해제되었습니다';
      mockClient.callTool.mockResolvedValue({
        content: [{ text: JSON.stringify({ message: expectedMessage }), type: 'text' }]
      });

      const result = await mementoClient.unpin(unpinParams);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'unpin',
        arguments: unpinParams
      });
      expect(result).toBe(expectedMessage);
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.unpin(unpinParams)).rejects.toThrow(
        'MCP 서버에 연결되지 않았습니다. connect()를 먼저 호출하세요.'
      );
    });
  });

  describe('callTool', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();
    });

    it('일반적인 도구를 성공적으로 호출해야 함', async () => {
      const toolName = 'test-tool';
      const toolArgs = { param1: 'value1' };
      const expectedResult = { success: true, data: 'test' };

      mockClient.callTool.mockResolvedValue({
        content: [{ text: JSON.stringify(expectedResult), type: 'text' }]
      });

      const result = await mementoClient.callTool(toolName, toolArgs);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: toolName,
        arguments: toolArgs
      });
      expect(result).toEqual(expectedResult);
    });

    it('JSON이 아닌 텍스트 응답을 처리해야 함', async () => {
      const toolName = 'test-tool';
      const expectedText = 'plain text response';

      mockClient.callTool.mockResolvedValue({
        content: [{ text: expectedText, type: 'text' }]
      });

      const result = await mementoClient.callTool(toolName);

      expect(result).toBe(expectedText);
    });

    it('도구 호출 실패 시 에러를 던져야 함', async () => {
      const toolName = 'test-tool';
      const error = new Error('도구 호출 실패');

      mockClient.callTool.mockRejectedValue(error);

      await expect(mementoClient.callTool(toolName)).rejects.toThrow(
        `도구 호출 실패 (${toolName}): 도구 호출 실패`
      );
    });

    it('연결되지 않은 상태에서 호출 시 에러를 던져야 함', async () => {
      const disconnectedClient = new MementoClient();
      
      await expect(disconnectedClient.callTool('test-tool')).rejects.toThrow(
        '서버에 연결되지 않았습니다'
      );
    });
  });

  describe('isConnected', () => {
    it('초기 상태에서는 false를 반환해야 함', () => {
      expect(mementoClient.isConnected()).toBe(false);
    });

    it('연결 후에는 true를 반환해야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      
      await mementoClient.connect();
      expect(mementoClient.isConnected()).toBe(true);
    });

    it('연결 해제 후에는 false를 반환해야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.close.mockResolvedValue(undefined);
      
      await mementoClient.connect();
      await mementoClient.disconnect();
      expect(mementoClient.isConnected()).toBe(false);
    });
  });

  describe('에러 처리', () => {
    it('remember에서 잘못된 응답 형식 시 에러를 던져야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();

      mockClient.callTool.mockResolvedValue({
        content: [{ invalid: 'response' }]
      });

      await expect(mementoClient.remember({
        content: 'test',
        type: 'episodic'
      })).rejects.toThrow('기억 저장에 실패했습니다');
    });

    it('recall에서 잘못된 응답 형식 시 에러를 던져야 함', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await mementoClient.connect();

      mockClient.callTool.mockResolvedValue({
        content: [{ invalid: 'response' }]
      });

      await expect(mementoClient.recall({
        query: 'test'
      })).rejects.toThrow('기억 검색에 실패했습니다');
    });
  });
});
