#!/bin/bash

# Legacy 서버 복원 스크립트
# 백업에서 Legacy 버전을 복원합니다
echo "🔄 Legacy 서버 복원 중..."

# 백업 디렉토리 확인
BACKUP_DIR=$(ls -t backup/legacy-removal-* 2>/dev/null | head -1)

if [ -z "$BACKUP_DIR" ]; then
    echo "❌ Legacy 백업을 찾을 수 없습니다."
    echo "💡 backup/legacy-removal-* 디렉토리를 확인해주세요."
    exit 1
fi

echo "📦 백업 디렉토리 발견: $BACKUP_DIR"

# 1. 현재 http-server.ts를 백업
if [ -f "src/server/http-server.ts" ]; then
    echo "📦 현재 서버를 백업 중..."
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    cp "src/server/http-server.ts" "src/server/http-server-backup-$TIMESTAMP.ts"
    echo "✅ 현재 서버 백업 완료: http-server-backup-$TIMESTAMP.ts"
fi

# 2. Legacy 서버 복원
if [ -f "$BACKUP_DIR/http-server-legacy.ts" ]; then
    echo "🔄 Legacy 서버 복원 중..."
    cp "$BACKUP_DIR/http-server-legacy.ts" "src/server/http-server.ts"
    echo "✅ Legacy 서버 복원 완료"
else
    echo "❌ Legacy 서버 파일을 찾을 수 없습니다."
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

echo "🎉 Legacy 서버 복원 완료!"
echo "💡 필요시 현재 서버는 http-server-backup-$TIMESTAMP.ts에서 복원할 수 있습니다."
