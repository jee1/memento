/**
 * Memento MCP Server 메인 진입점
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { mementoConfig, validateConfig } from '../config/index.js';
import type { MemoryType, PrivacyScope } from '../types/index.js';
import { DatabaseUtils } from '../utils/database.js';
import sqlite3 from 'sqlite3';

// MCP 서버 인스턴스
let server: Server;
let db: sqlite3.Database;

// MCP Tools 스키마 정의
const RememberSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
  type: z.enum(['working', 'episodic', 'semantic', 'procedural']).default('episodic'),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  source: z.string().optional(),
  privacy_scope: z.enum(['private', 'team', 'public']).default('private')
});

const RecallSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  filters: z.object({
    type: z.array(z.enum(['working', 'episodic', 'semantic', 'procedural'])).optional(),
    tags: z.array(z.string()).optional(),
    privacy_scope: z.array(z.enum(['private', 'team', 'public'])).optional(),
    time_from: z.string().optional(),
    time_to: z.string().optional(),
    pinned: z.boolean().optional()
  }).optional(),
  limit: z.number().min(1).max(50).default(10)
});

const ForgetSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty'),
  hard: z.boolean().default(false)
});

const PinSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty')
});

const UnpinSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty')
});

// Tool 핸들러들 (임시 구현)
async function handleRemember(params: z.infer<typeof RememberSchema>) {
  const { content, type, tags, importance, source, privacy_scope } = params;
  
  // UUID 생성 (임시로 간단한 ID 사용)
  const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 데이터베이스에 저장
  await DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, privacy_scope, tags, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [id, type, content, importance, privacy_scope, 
      tags ? JSON.stringify(tags) : null, source]);
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          memory_id: id,
          message: `기억이 저장되었습니다: ${id}`
        })
      }
    ]
  };
}

async function handleRecall(params: z.infer<typeof RecallSchema>) {
  const { query, filters, limit } = params;
  
  // 간단한 검색 구현 (FTS5 사용)
  let sql = `
    SELECT m.id, m.content, m.type, m.importance, m.created_at, m.last_accessed, m.pinned, m.tags, m.source
    FROM memory_item_fts f
    JOIN memory_item m ON f.rowid = m.rowid
    WHERE memory_item_fts MATCH ?
  `;
  
  const conditions: string[] = [];
  const params_array: any[] = [query];
  
  if (filters?.type && filters.type.length > 0) {
    conditions.push(`m.type IN (${filters.type.map(() => '?').join(',')})`);
    params_array.push(...filters.type);
  }
  
  if (filters?.privacy_scope && filters.privacy_scope.length > 0) {
    conditions.push(`m.privacy_scope IN (${filters.privacy_scope.map(() => '?').join(',')})`);
    params_array.push(...filters.privacy_scope);
  }
  
  if (filters?.pinned !== undefined) {
    conditions.push(`m.pinned = ?`);
    params_array.push(filters.pinned);
  }
  
  if (conditions.length > 0) {
    sql += ` AND ${conditions.join(' AND ')}`;
  }
  
  sql += ` ORDER BY m.created_at DESC LIMIT ?`;
  params_array.push(limit);
  
  const results = await DatabaseUtils.all(db, sql, params_array);
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          items: results.map((row: any) => ({
            id: row.id,
            content: row.content,
            type: row.type,
            importance: row.importance,
            created_at: row.created_at,
            last_accessed: row.last_accessed,
            pinned: row.pinned,
            tags: row.tags ? JSON.parse(row.tags) : [],
            score: 1.0, // 임시 점수
            recall_reason: `FTS5 검색: "${query}"`
          }))
        })
      }
    ]
  };
}

async function handleForget(params: z.infer<typeof ForgetSchema>) {
  const { id, hard } = params;
  
  if (hard) {
    // 하드 삭제
    const result = await DatabaseUtils.run(db, 'DELETE FROM memory_item WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `기억이 완전히 삭제되었습니다: ${id}`
          })
        }
      ]
    };
  } else {
    // 소프트 삭제 (pinned 해제 후 TTL에 의해 삭제)
    const result = await DatabaseUtils.run(db, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `기억이 삭제 대상으로 표시되었습니다: ${id}`
          })
        }
      ]
    };
  }
}

async function handlePin(params: z.infer<typeof PinSchema>) {
  const { id } = params;
  
  const result = await DatabaseUtils.run(db, 'UPDATE memory_item SET pinned = TRUE WHERE id = ?', [id]);
  
  if (result.changes === 0) {
    throw new Error(`Memory with ID ${id} not found`);
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: `기억이 고정되었습니다: ${id}`
        })
      }
    ]
  };
}

async function handleUnpin(params: z.infer<typeof UnpinSchema>) {
  const { id } = params;
  
  const result = await DatabaseUtils.run(db, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
  
  if (result.changes === 0) {
    throw new Error(`Memory with ID ${id} not found`);
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: `기억 고정이 해제되었습니다: ${id}`
        })
      }
    ]
  };
}

// MCP 서버 초기화
async function initializeServer() {
  try {
    // 설정 검증
    validateConfig();
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    
    // MCP 서버 생성
    server = new Server(
      {
        name: mementoConfig.serverName,
        version: mementoConfig.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );
    
    // Tools 등록
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'remember',
            description: '새로운 기억을 저장합니다',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '저장할 내용' },
                type: { 
                  type: 'string', 
                  enum: ['working', 'episodic', 'semantic', 'procedural'],
                  description: '기억 타입',
                  default: 'episodic'
                },
                tags: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: '태그 목록'
                },
                importance: { 
                  type: 'number', 
                  minimum: 0, 
                  maximum: 1,
                  description: '중요도 (0-1)',
                  default: 0.5
                },
                source: { type: 'string', description: '출처' },
                privacy_scope: { 
                  type: 'string', 
                  enum: ['private', 'team', 'public'],
                  description: '프라이버시 범위',
                  default: 'private'
                }
              },
              required: ['content']
            }
          },
          {
            name: 'recall',
            description: '관련 기억을 검색합니다',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '검색 쿼리' },
                filters: {
                  type: 'object',
                  properties: {
                    type: { 
                      type: 'array', 
                      items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural'] }
                    },
                    tags: { type: 'array', items: { type: 'string' } },
                    privacy_scope: { 
                      type: 'array', 
                      items: { type: 'string', enum: ['private', 'team', 'public'] }
                    },
                    time_from: { type: 'string' },
                    time_to: { type: 'string' },
                    pinned: { type: 'boolean' }
                  }
                },
                limit: { type: 'number', minimum: 1, maximum: 50, default: 10 }
              },
              required: ['query']
            }
          },
          {
            name: 'forget',
            description: '기억을 삭제합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '삭제할 기억의 ID' },
                hard: { type: 'boolean', description: '완전 삭제 여부', default: false }
              },
              required: ['id']
            }
          },
          {
            name: 'pin',
            description: '기억을 고정합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '고정할 기억의 ID' }
              },
              required: ['id']
            }
          },
          {
            name: 'unpin',
            description: '기억 고정을 해제합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '고정 해제할 기억의 ID' }
              },
              required: ['id']
            }
          }
        ]
      };
    });
    
    // Tool 실행 핸들러
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        switch (name) {
          case 'remember':
            return await handleRemember(RememberSchema.parse(args));
          case 'recall':
            return await handleRecall(RecallSchema.parse(args));
          case 'forget':
            return await handleForget(ForgetSchema.parse(args));
          case 'pin':
            return await handlePin(PinSchema.parse(args));
          case 'unpin':
            return await handleUnpin(UnpinSchema.parse(args));
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`);
        }
        throw error;
      }
    });
    
    // MCP 서버는 stdio 프로토콜을 사용하므로 console.log 사용 금지
    // 로그는 stderr로 출력
    console.error('🚀 Memento MCP Server가 시작되었습니다!');
    console.error(`📊 서버: ${mementoConfig.serverName} v${mementoConfig.serverVersion}`);
    console.error(`🗄️  데이터베이스: ${mementoConfig.dbPath}`);
    
  } catch (error) {
    console.error('❌ 서버 초기화 실패:', error);
    process.exit(1);
  }
}

// 서버 시작
async function startServer() {
  await initializeServer();
  
  // Stdio 전송 계층 사용
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('🔗 MCP 클라이언트 연결 대기 중...');
}

// 정리 함수
async function cleanup() {
  if (db) {
    closeDatabase(db);
  }
  console.error('👋 Memento MCP Server 종료');
}

// 프로세스 종료 시 정리
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (error) => {
  console.error('❌ 예상치 못한 오류:', error);
  cleanup();
  process.exit(1);
});

// 서버 시작
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  console.error('🚀 Memento MCP Server 시작 중...');
  startServer().catch(error => {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  });
}
