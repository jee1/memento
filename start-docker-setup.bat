@echo off
echo 🐳 Memento Docker 설정 시작...
echo.

echo 1. Docker Desktop 상태 확인...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Desktop이 실행되지 않았습니다.
    echo    Docker Desktop을 시작한 후 다시 실행해주세요.
    pause
    exit /b 1
)

echo ✅ Docker Desktop이 실행 중입니다.
echo.

echo 2. 도커 이미지 빌드...
docker-compose build

echo 3. 도커 컨테이너 시작...
docker-compose up -d

echo 4. 데이터 마운트 확인...
echo    호스트 ./data 폴더가 컨테이너 /app/data에 마운트됩니다.

echo 5. 컨테이너 상태 확인...
docker-compose ps

echo 6. 서버 접속 정보...
echo    HTTP 서버: http://localhost:9001
echo    WebSocket: ws://localhost:9001
echo    API 문서: http://localhost:9001/tools
echo    헬스 체크: http://localhost:9001/health

echo.
echo ✅ 설정 완료! 이제 Cursor에서 Memento MCP 서버를 사용할 수 있습니다.
echo.
pause
