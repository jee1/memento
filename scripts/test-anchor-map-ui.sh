#!/bin/bash
# Anchor Map UI 자동 테스트 스크립트

echo "🧪 Anchor Map UI 테스트 시작..."
echo ""

# 서버 포트 확인
PORT=8080
if ! curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    PORT=9001
    if ! curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo "❌ 서버가 실행 중이지 않습니다. npm run dev:http를 먼저 실행하세요."
        exit 1
    fi
fi

echo "✅ 서버 연결 확인: http://localhost:$PORT"
echo ""

# 1. 헬스 체크
echo "1️⃣ 헬스 체크 테스트..."
HEALTH=$(curl -s http://localhost:$PORT/health)
if echo "$HEALTH" | grep -q "healthy"; then
    echo "   ✅ 헬스 체크 성공"
else
    echo "   ❌ 헬스 체크 실패"
    echo "   응답: $HEALTH"
fi
echo ""

# 2. 대시보드 접근 테스트
echo "2️⃣ 대시보드 접근 테스트..."
DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/dashboard)
if [ "$DASHBOARD" = "200" ]; then
    echo "   ✅ 대시보드 접근 성공 (HTTP $DASHBOARD)"
else
    echo "   ❌ 대시보드 접근 실패 (HTTP $DASHBOARD)"
fi
echo ""

# 3. Static 파일 서빙 테스트
echo "3️⃣ Static 파일 서빙 테스트..."
CSS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/static/css/dashboard.css)
JS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/static/js/anchor-map.js)

if [ "$CSS" = "200" ]; then
    echo "   ✅ dashboard.css 서빙 성공 (HTTP $CSS)"
else
    echo "   ❌ dashboard.css 서빙 실패 (HTTP $CSS)"
fi

if [ "$JS" = "200" ]; then
    echo "   ✅ anchor-map.js 서빙 성공 (HTTP $JS)"
else
    echo "   ❌ anchor-map.js 서빙 실패 (HTTP $JS)"
fi
echo ""

# 4. 테스트 메모리 생성
echo "4️⃣ 테스트 메모리 생성..."
MEMORY_RESPONSE=$(curl -s -X POST http://localhost:$PORT/tools/remember \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Anchor Map UI 테스트용 메모리",
    "type": "episodic",
    "importance": 0.8
  }')

MEMORY_ID=$(echo "$MEMORY_RESPONSE" | jq -r '.result.content[0].text' 2>/dev/null | jq -r '.memory_id' 2>/dev/null)

if [ -n "$MEMORY_ID" ] && [ "$MEMORY_ID" != "null" ]; then
    echo "   ✅ 메모리 생성 성공: $MEMORY_ID"
else
    echo "   ❌ 메모리 생성 실패"
    echo "   응답: $MEMORY_RESPONSE"
    exit 1
fi
echo ""

# 5. 앵커 설정
echo "5️⃣ 앵커 설정 테스트..."
ANCHOR_RESPONSE=$(curl -s -X POST http://localhost:$PORT/tools/set_anchor \
  -H "Content-Type: application/json" \
  -d "{
    \"memory_id\": \"$MEMORY_ID\",
    \"slot\": \"A\",
    \"agent_id\": \"default\"
  }")

if echo "$ANCHOR_RESPONSE" | grep -q "success\|완료"; then
    echo "   ✅ 앵커 설정 성공"
else
    echo "   ⚠️  앵커 설정 응답 확인 필요"
    echo "   응답: $ANCHOR_RESPONSE" | head -5
fi
echo ""

# 6. Anchor Map API 테스트
echo "6️⃣ Anchor Map API 테스트..."
MAP_RESPONSE=$(curl -s "http://localhost:$PORT/api/anchors/map?agent_id=default")
ANCHORS_COUNT=$(echo "$MAP_RESPONSE" | jq -r '.anchors | length' 2>/dev/null)
NODES_COUNT=$(echo "$MAP_RESPONSE" | jq -r '.nodes | length' 2>/dev/null)
LINKS_COUNT=$(echo "$MAP_RESPONSE" | jq -r '.links | length' 2>/dev/null)

if [ -n "$ANCHORS_COUNT" ] && [ "$ANCHORS_COUNT" != "null" ]; then
    echo "   ✅ Anchor Map API 응답 성공"
    echo "   - 앵커 수: $ANCHORS_COUNT"
    echo "   - 노드 수: $NODES_COUNT"
    echo "   - 링크 수: $LINKS_COUNT"
else
    echo "   ❌ Anchor Map API 응답 실패"
    echo "   응답: $MAP_RESPONSE" | head -10
fi
echo ""

# 7. 검색 API 테스트
echo "7️⃣ 검색 API 테스트..."
SEARCH_RESPONSE=$(curl -s -X POST http://localhost:$PORT/tools/search_local \
  -H "Content-Type: application/json" \
  -d '{
    "slot": "A",
    "query": "테스트",
    "agent_id": "default",
    "limit": 10
  }')

if echo "$SEARCH_RESPONSE" | grep -q "items\|total_count"; then
    echo "   ✅ 검색 API 응답 성공"
else
    echo "   ⚠️  검색 API 응답 확인 필요"
    echo "   응답: $SEARCH_RESPONSE" | head -5
fi
echo ""

# 8. 앵커 조회 테스트
echo "8️⃣ 앵커 조회 테스트..."
GET_ANCHOR_RESPONSE=$(curl -s -X POST http://localhost:$PORT/tools/get_anchor \
  -H "Content-Type: application/json" \
  -d '{
    "slot": "A",
    "agent_id": "default"
  }')

if echo "$GET_ANCHOR_RESPONSE" | grep -q "memory_id\|slot"; then
    echo "   ✅ 앵커 조회 성공"
else
    echo "   ⚠️  앵커 조회 응답 확인 필요"
    echo "   응답: $GET_ANCHOR_RESPONSE" | head -5
fi
echo ""

echo "✅ Anchor Map UI 테스트 완료!"
echo ""
echo "📊 테스트 결과 요약:"
echo "   - 서버: http://localhost:$PORT"
echo "   - 대시보드: http://localhost:$PORT/dashboard"
echo "   - API: http://localhost:$PORT/api/anchors/map?agent_id=default"
echo ""
echo "💡 브라우저에서 http://localhost:$PORT/dashboard 접속하여 UI를 확인하세요."

