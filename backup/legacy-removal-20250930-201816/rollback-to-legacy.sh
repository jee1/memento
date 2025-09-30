#!/bin/bash

# 롤백 스크립트: HTTP 서버 v2에서 Legacy 버전으로 롤백
echo "🔄 HTTP 서버 Legacy 버전으로 롤백 중..."

# 1. 현재 http-server.ts를 http-server-v2-backup.ts로 백업
if [ -f "src/server/http-server.ts" ]; then
    echo "📦 현재 v2 버전을 백업 중..."
    cp src/server/http-server.ts src/server/http-server-v2-backup.ts
    echo "✅ v2 백업 완료: src/server/http-server-v2-backup.ts"
fi

# 2. Legacy 버전을 메인으로 복원
if [ -f "src/server/http-server-legacy.ts" ]; then
    echo "🔄 Legacy 버전을 메인으로 복원 중..."
    cp src/server/http-server-legacy.ts src/server/http-server.ts
    echo "✅ Legacy 복원 완료"
else
    echo "❌ Legacy 버전을 찾을 수 없습니다: src/server/http-server-legacy.ts"
    exit 1
fi

# 3. 빌드
echo "🔨 애플리케이션 빌드 중..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ 빌드 성공"
else
    echo "❌ 빌드 실패"
    exit 1
fi

# 4. Docker 컨테이너 재시작
echo "🐳 Docker 컨테이너 재시작 중..."
docker-compose down
docker-compose up -d

if [ $? -eq 0 ]; then
    echo "✅ Docker 컨테이너 재시작 완료"
    echo "🌐 서버 주소: http://localhost:9001"
    echo "❤️  헬스 체크: http://localhost:9001/health"
else
    echo "❌ Docker 컨테이너 재시작 실패"
    exit 1
fi

echo "🎉 롤백 완료! Legacy 버전이 실행 중입니다."
