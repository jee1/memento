@echo off
REM Memento 데이터베이스 일일 백업 스크립트
REM 실행 시간: 매일 오전 2시

set timestamp=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set timestamp=%timestamp: =0%

echo [%date% %time%] 데이터베이스 백업 시작...

REM 백업 디렉토리 생성
if not exist "backup" mkdir backup

REM 메인 데이터베이스 백업
copy "data\memory.db" "backup\memory-backup-%timestamp%.db"

if %errorlevel% equ 0 (
    echo [%date% %time%] 백업 완료: memory-backup-%timestamp%.db
    
    REM 오래된 백업 파일 정리 (30일 이상)
    forfiles /p backup /m memory-backup-*.db /d -30 /c "cmd /c del @path" 2>nul
    
    echo [%date% %time%] 오래된 백업 파일 정리 완료
) else (
    echo [%date% %time%] 백업 실패!
    exit /b 1
)

echo [%date% %time%] 데이터베이스 백업 완료
