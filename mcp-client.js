#!/usr/bin/env node

/**
 * Memento MCP Client Launcher
 * 도커 컨테이너에서 실행되는 MCP 서버에 연결하는 클라이언트
 */

import { spawn } from 'child_process';
import path from 'path';

// 도커 컨테이너에서 MCP 서버 실행 (stdio 모드)
const dockerCommand = 'docker';
const containerName = process.env.MEMENTO_CONTAINER_NAME || 'memento-memento-mcp-server-1';
const dockerArgs = [
  'exec',
  '-i',
  containerName,
  'node',
  'dist/server/index.js'
];

console.error('🐳 도커 컨테이너에서 Memento MCP 서버에 연결 중...');

// MCP 서버 프로세스 시작
const mcpProcess = spawn(dockerCommand, dockerArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
});

// 에러 처리
mcpProcess.on('error', (error) => {
  console.error('❌ MCP 서버 실행 오류:', error.message);
  process.exit(1);
});

mcpProcess.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`❌ MCP 서버 종료 (코드: ${code}, 신호: ${signal})`);
    process.exit(code || 1);
  }
});

// stdio 파이프 연결
process.stdin.pipe(mcpProcess.stdin);
mcpProcess.stdout.pipe(process.stdout);
mcpProcess.stderr.pipe(process.stderr);

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  mcpProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  mcpProcess.kill('SIGTERM');
});
