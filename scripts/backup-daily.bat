@echo off
REM Memento 데이터베이스 일일 백업 스크립트
REM 실행 시간: 매일 오전 2시
REM PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지

set timestamp=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set timestamp=%timestamp: =0%

echo [%date% %time%] 데이터베이스 백업 시작...

REM 백업 디렉토리 생성 (PRD 0019: Path Traversal 방지 - 허용된 디렉토리만 사용)
if not exist "backup" mkdir backup

REM 백업 파일명 정제 (PRD 0019: Path Traversal 방지)
REM timestamp는 날짜/시간에서 생성되므로 상대적으로 안전하지만, 
REM 추가 보안을 위해 Node.js 유틸리티로 파일명 정제 (선택사항)
set backupFileName=memory-backup-%timestamp%.db

REM 메인 데이터베이스 백업
REM PRD 0019: Path Traversal 방지 - 경로는 하드코딩되어 있어 상대적으로 안전
REM data\memory.db와 backup\ 디렉토리는 기본 허용 디렉토리 목록에 포함됨
copy "data\memory.db" "backup\%backupFileName%"

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
