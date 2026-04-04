#!/bin/bash
if [ -z "$BASH_VERSION" ]; then exec bash "$0" "$@"; fi

# Memento MCP Server 자동 설치 스크립트
# 사용법: curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 로그 함수들
log() {
    echo -e "${CYAN}🚀 $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 설치 모드 선택
select_install_mode() {
    echo -e "${MAGENTA}Memento MCP Server 설치 모드를 선택하세요:${NC}"
    echo "1) npx 방식 (빠른 설치, 개발용)"
    echo "2) Docker 방식 (안정적, 프로덕션용)"
    echo "3) 소스코드 방식 (개발자용)"
    echo "4) 종료"
    
    read -p "선택 (1-4): " choice < /dev/tty
    
    case $choice in
        1) install_npx ;;
        2) install_docker ;;
        3) install_source ;;
        4) exit 0 ;;
        *) log_error "잘못된 선택입니다."; exit 1 ;;
    esac
}

# npm 캐시 정리 함수
clean_npm_cache() {
    log "npm 캐시를 정리합니다..."
    npm cache clean --force || true
    log_success "npm 캐시 정리 완료"
}

# npx 방식 설치
install_npx() {
    log "npx 방식으로 설치를 시작합니다..."
    
    # Node.js 버전 확인
    if ! command -v node &> /dev/null; then
        log_error "Node.js가 설치되어 있지 않습니다."
        log "Node.js 20 이상을 설치해주세요: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        log_error "Node.js 20 이상이 필요합니다. 현재 버전: $(node -v)"
        exit 1
    fi
    
    log_success "Node.js 버전 확인 완료: $(node -v)"
    
    # npm 버전 확인
    if ! command -v npm &> /dev/null; then
        log_error "npm이 설치되어 있지 않습니다."
        exit 1
    fi
    
    # npx로 서버 실행 (에러 발생 시 캐시 정리 후 재시도)
    log "Memento MCP Server를 시작합니다..."
    
    # setup 실행
    if ! npx --yes memento-mcp-server@latest setup 2>&1; then
        log_warning "설정 실행 중 오류가 발생했습니다. npm 캐시를 정리하고 재시도합니다..."
        clean_npm_cache
        if ! npx --yes memento-mcp-server@latest setup 2>&1; then
            log_error "설정 실행에 실패했습니다."
            log "수동으로 다음 명령어를 실행해보세요:"
            log "  npm cache clean --force"
            log "  npx --yes memento-mcp-server@latest setup"
            exit 1
        fi
    fi
    
    # dev 서버 시작
    log "개발 서버를 시작합니다..."
    if ! npx --yes memento-mcp-server@latest dev 2>&1; then
        log_warning "서버 시작 중 오류가 발생했습니다. npm 캐시를 정리하고 재시도합니다..."
        clean_npm_cache
        if ! npx --yes memento-mcp-server@latest dev 2>&1; then
            log_error "서버 시작에 실패했습니다."
            log "수동으로 다음 명령어를 실행해보세요:"
            log "  npm cache clean --force"
            log "  npx --yes memento-mcp-server@latest dev"
            exit 1
        fi
    fi
    
    log_success "npx 방식 설치 완료!"
    log "서버가 http://localhost:9001 에서 실행 중입니다."
}

# Docker 방식 설치
install_docker() {
    log "Docker 방식으로 설치를 시작합니다..."
    
    # Docker 확인
    if ! command -v docker &> /dev/null; then
        log_error "Docker가 설치되어 있지 않습니다."
        log "Docker를 설치해주세요: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Docker Compose 확인
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose가 설치되어 있지 않습니다."
        exit 1
    fi
    
    log_success "Docker 환경 확인 완료"

    # docker compose 명령어 결정 (플러그인 방식 우선)
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi

    # 프로젝트 클론
    if [ ! -d "memento" ]; then
        log "프로젝트를 클론합니다..."
        git clone https://github.com/jee1/memento.git
        cd memento
    else
        log "기존 프로젝트 디렉토리를 사용합니다..."
        cd memento
        git pull
    fi
    
    # 환경 변수 설정
    if [ ! -f ".env" ]; then
        log "환경 변수 파일을 생성합니다..."
        cp env.example .env
        log_warning ".env 파일을 편집하여 API 키를 설정하세요."
    fi
    
    # Docker Compose 실행
    log "Docker 컨테이너를 시작합니다..."
    $COMPOSE_CMD up -d

    log_success "Docker 방식 설치 완료!"
    log "서버가 http://localhost:9001 에서 실행 중입니다."
    log "로그 확인: $COMPOSE_CMD logs -f"
}

# 소스코드 방식 설치
install_source() {
    log "소스코드 방식으로 설치를 시작합니다..."
    
    # Node.js 버전 확인
    if ! command -v node &> /dev/null; then
        log_error "Node.js가 설치되어 있지 않습니다."
        exit 1
    fi
    
    # 프로젝트 클론
    if [ ! -d "memento" ]; then
        log "프로젝트를 클론합니다..."
        git clone https://github.com/jee1/memento.git
        cd memento
    else
        log "기존 프로젝트 디렉토리를 사용합니다..."
        cd memento
        git pull
    fi
    
    # 의존성 설치
    log "의존성을 설치합니다..."
    npm install
    
    # 자동 설정 실행
    log "자동 설정을 실행합니다..."
    npm run setup
    
    # 개발 서버 시작
    log "개발 서버를 시작합니다..."
    npm run dev
    
    log_success "소스코드 방식 설치 완료!"
    log "서버가 http://localhost:9001 에서 실행 중입니다."
}

# 메인 함수
main() {
    echo -e "${MAGENTA}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    Memento MCP Server                       ║"
    echo "║              AI Agent 기억 보조 서버 자동 설치                ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    log "환경을 확인합니다..."
    
    # OS 확인
    OS="unknown"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
    fi
    
    log_success "운영체제: $OS"
    
    select_install_mode
}

# 스크립트 실행
main "$@"
