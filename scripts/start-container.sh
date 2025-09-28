#!/bin/sh

# 데이터 디렉토리 권한 설정
echo "🔧 데이터 디렉토리 권한 설정 중..."
chmod -R 755 /app/data
chown -R memento:nodejs /app/data

# HTTP 서버 시작
echo "🚀 Memento HTTP 서버 시작 중..."
exec node dist/server/http-server.js
