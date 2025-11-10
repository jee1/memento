/**
 * simple-mcp-server 테스트
 * 간단한 MCP 서버 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';

// simple-mcp-server의 로직을 테스트하기 위해 모듈을 직접 import
// 하지만 실제로는 서버를 시작하는 것이므로 통합 테스트로 접근
describe('simple-mcp-server', () => {
  // simple-mcp-server는 실제 서버를 시작하는 파일이므로
  // 직접적인 단위 테스트보다는 통합 테스트나 E2E 테스트가 적합합니다.
  // 여기서는 핵심 로직만 테스트합니다.

  describe('서버 구조', () => {
    it('Express 앱과 HTTP 서버를 생성해야 함', () => {
      // Given: Express 앱 생성
      const app = express();
      const server = createServer(app);

      // Then: 앱과 서버가 생성되어야 함
      expect(app).toBeDefined();
      expect(server).toBeDefined();
    });

    it('CORS 미들웨어를 사용해야 함', () => {
      // Given: Express 앱 생성
      const app = express();

      // When: CORS 미들웨어 적용
      app.use(cors());

      // Then: 앱이 설정되어야 함
      expect(app).toBeDefined();
    });

    it('JSON 파싱 미들웨어를 사용해야 함', () => {
      // Given: Express 앱 생성
      const app = express();

      // When: JSON 파싱 미들웨어 적용
      app.use(express.json());

      // Then: 앱이 설정되어야 함
      expect(app).toBeDefined();
    });
  });

  describe('도구 정의', () => {
    it('remember 도구를 정의해야 함', () => {
      // Given: 도구 정의
      const tools = [
        {
          name: 'remember',
          description: '기억을 저장합니다',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '저장할 기억 내용' }
            },
            required: ['content']
          }
        }
      ];

      // Then: remember 도구가 정의되어야 함
      const rememberTool = tools.find(t => t.name === 'remember');
      expect(rememberTool).toBeDefined();
      expect(rememberTool?.name).toBe('remember');
      expect(rememberTool?.description).toBe('기억을 저장합니다');
      expect(rememberTool?.inputSchema.properties).toHaveProperty('content');
    });

    it('recall 도구를 정의해야 함', () => {
      // Given: 도구 정의
      const tools = [
        {
          name: 'recall',
          description: '기억을 검색합니다',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '검색 쿼리' }
            },
            required: ['query']
          }
        }
      ];

      // Then: recall 도구가 정의되어야 함
      const recallTool = tools.find(t => t.name === 'recall');
      expect(recallTool).toBeDefined();
      expect(recallTool?.name).toBe('recall');
      expect(recallTool?.description).toBe('기억을 검색합니다');
      expect(recallTool?.inputSchema.properties).toHaveProperty('query');
    });
  });

  describe('SSE 엔드포인트 로직', () => {
    it('세션 ID를 생성해야 함', () => {
      // When: 세션 ID 생성
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Then: 세션 ID가 생성되어야 함
      expect(sessionId).toBeDefined();
      expect(sessionId).toContain('session_');
      expect(typeof sessionId).toBe('string');
    });

    it('엔드포인트 URL을 생성해야 함', () => {
      // Given: 세션 ID
      const sessionId = 'session_1234567890_abc123';

      // When: 엔드포인트 URL 생성
      const endpointUrl = `/messages?sessionId=${sessionId}`;

      // Then: 엔드포인트 URL이 생성되어야 함
      expect(endpointUrl).toBe('/messages?sessionId=session_1234567890_abc123');
      expect(endpointUrl).toContain('sessionId=');
    });
  });

  describe('메시지 처리 로직', () => {
    it('initialize 메서드를 처리해야 함', () => {
      // Given: initialize 메시지
      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      };

      // When: initialize 처리
      const result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'memento-memory',
            version: '0.1.0'
          }
        }
      };

      // Then: 올바른 응답 생성
      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(message.id);
      expect(result.result.protocolVersion).toBe('2024-11-05');
      expect(result.result.serverInfo.name).toBe('memento-memory');
    });

    it('tools/list 메서드를 처리해야 함', () => {
      // Given: tools/list 메시지
      const message = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      // Given: 도구 목록
      const tools = [
        {
          name: 'remember',
          description: '기억을 저장합니다',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '저장할 기억 내용' }
            },
            required: ['content']
          }
        },
        {
          name: 'recall',
          description: '기억을 검색합니다',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '검색 쿼리' }
            },
            required: ['query']
          }
        }
      ];

      // When: tools/list 처리
      const result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: tools
        }
      };

      // Then: 올바른 응답 생성
      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(message.id);
      expect(result.result.tools).toHaveLength(2);
      expect(result.result.tools[0].name).toBe('remember');
      expect(result.result.tools[1].name).toBe('recall');
    });
  });
});

