# Legacy 서버 복원 스크립트
# 백업에서 Legacy 버전을 복원합니다
Write-Host "🔄 Legacy 서버 복원 중..." -ForegroundColor Yellow

# 백업 디렉토리 확인
$backupDir = Get-ChildItem -Path "backup" -Directory | Where-Object { $_.Name -like "legacy-removal-*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $backupDir) {
    Write-Host "❌ Legacy 백업을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "💡 backup/legacy-removal-* 디렉토리를 확인해주세요." -ForegroundColor Yellow
    exit 1
}

Write-Host "📦 백업 디렉토리 발견: $($backupDir.Name)" -ForegroundColor Blue

# 1. 현재 http-server.ts를 백업
if (Test-Path "src/server/http-server.ts") {
    Write-Host "📦 현재 서버를 백업 중..." -ForegroundColor Blue
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item "src/server/http-server.ts" "src/server/http-server-backup-$timestamp.ts"
    Write-Host "✅ 현재 서버 백업 완료: http-server-backup-$timestamp.ts" -ForegroundColor Green
}

# 2. Legacy 서버 복원
if (Test-Path "$($backupDir.FullName)/http-server-legacy.ts") {
    Write-Host "🔄 Legacy 서버 복원 중..." -ForegroundColor Blue
    Copy-Item "$($backupDir.FullName)/http-server-legacy.ts" "src/server/http-server.ts"
    Write-Host "✅ Legacy 서버 복원 완료" -ForegroundColor Green
} else {
    Write-Host "❌ Legacy 서버 파일을 찾을 수 없습니다." -ForegroundColor Red
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

Write-Host "🎉 Legacy 서버 복원 완료!" -ForegroundColor Green
Write-Host "💡 필요시 현재 서버는 http-server-backup-$timestamp.ts에서 복원할 수 있습니다." -ForegroundColor Yellow
