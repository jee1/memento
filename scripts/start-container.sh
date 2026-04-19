#!/bin/sh

# 데이터 디렉토리 권한 설정
echo "🔧 데이터 디렉토리 권한 설정 중..."
chmod -R 755 /app/data
chown -R memento:nodejs /app/data
mkdir -p /app/.memento
chmod 755 /app/.memento
chown -R memento:nodejs /app/.memento

# HTTP 서버 시작
echo "🚀 Memento HTTP 서버 시작 중..."
exec node packages/memento-server/dist/server/index.js
