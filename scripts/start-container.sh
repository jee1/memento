#!/bin/sh

# 데이터 디렉토리 권한 설정
echo "🔧 데이터 디렉토리 권한 설정 중..."
chmod -R 755 /app/data
chown -R memento:nodejs /app/data
mkdir -p /app/.memento
chmod 755 /app/.memento
chown -R memento:nodejs /app/.memento

# WAL sidecar 정리 (비정상 종료 후 재기동 시 일관성 개선)
if [ -f /app/data/memory.db ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 /app/data/memory.db "PRAGMA wal_checkpoint(PASSIVE);" >/dev/null 2>&1 || true
  fi
fi

# HTTP 서버 시작
echo "🚀 Memento HTTP 서버 시작 중..."
exec node packages/memento-server/dist/server/index.js
