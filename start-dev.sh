#!/bin/bash
echo "🚀 Memento MCP Server 개발 모드 시작..."

# TRANSPORT_TYPE 환경 변수 설정 (기본값: stdio)
# stdio: 표준 입출력을 통한 MCP 서버
# sse: Server-Sent Events를 통한 HTTP/SSE 서버
export TRANSPORT_TYPE=${TRANSPORT_TYPE:-stdio}

echo "📡 서버 타입: ${TRANSPORT_TYPE}"
npm run dev
