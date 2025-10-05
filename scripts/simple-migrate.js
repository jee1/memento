#!/usr/bin/env node

import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'data', 'memory.db');

console.log('🔍 임베딩 데이터 분석 중...');

try {
  const db = new Database(dbPath);
  
  // 기존 데이터 분석
  const analysis = db.prepare(`
    SELECT 
      dim,
      model,
      COUNT(*) as count
    FROM memory_embedding 
    GROUP BY dim, model
    ORDER BY count DESC
  `).all();
  
  console.log('📊 기존 데이터 분석 결과:');
  console.table(analysis);
  
  // 전체 통계
  const total = db.prepare('SELECT COUNT(*) as total FROM memory_embedding').get();
  console.log(`\n📈 총 임베딩 수: ${total.total}`);
  
  // 스키마 확인
  const schema = db.prepare("PRAGMA table_info(memory_embedding)").all();
  console.log('\n📋 현재 테이블 구조:');
  console.table(schema);
  
  db.close();
  
} catch (error) {
  console.error('❌ 오류 발생:', error.message);
  process.exit(1);
}
