# 롤백 스크립트: HTTP 서버 v2에서 Legacy 버전으로 롤백
Write-Host "🔄 HTTP 서버 Legacy 버전으로 롤백 중..." -ForegroundColor Yellow

# 1. 현재 http-server.ts를 http-server-v2-backup.ts로 백업
if (Test-Path "src/server/http-server.ts") {
    Write-Host "📦 현재 v2 버전을 백업 중..." -ForegroundColor Blue
    Copy-Item "src/server/http-server.ts" "src/server/http-server-v2-backup.ts"
    Write-Host "✅ v2 백업 완료: src/server/http-server-v2-backup.ts" -ForegroundColor Green
}

# 2. Legacy 버전을 메인으로 복원
if (Test-Path "src/server/http-server-legacy.ts") {
    Write-Host "🔄 Legacy 버전을 메인으로 복원 중..." -ForegroundColor Blue
    Copy-Item "src/server/http-server-legacy.ts" "src/server/http-server.ts"
    Write-Host "✅ Legacy 복원 완료" -ForegroundColor Green
} else {
    Write-Host "❌ Legacy 버전을 찾을 수 없습니다: src/server/http-server-legacy.ts" -ForegroundColor Red
    exit 1
}

# 3. 빌드
Write-Host "🔨 애플리케이션 빌드 중..." -ForegroundColor Blue
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 빌드 성공" -ForegroundColor Green
} else {
    Write-Host "❌ 빌드 실패" -ForegroundColor Red
    exit 1
}

# 4. Docker 컨테이너 재시작
Write-Host "🐳 Docker 컨테이너 재시작 중..." -ForegroundColor Blue
docker-compose down
docker-compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker 컨테이너 재시작 완료" -ForegroundColor Green
    Write-Host "🌐 서버 주소: http://localhost:9001" -ForegroundColor Cyan
    Write-Host "❤️  헬스 체크: http://localhost:9001/health" -ForegroundColor Cyan
} else {
    Write-Host "❌ Docker 컨테이너 재시작 실패" -ForegroundColor Red
    exit 1
}

Write-Host "🎉 롤백 완료! Legacy 버전이 실행 중입니다." -ForegroundColor Green
