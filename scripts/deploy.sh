#!/usr/bin/env bash
# deploy.sh — 원격 서버 Docker 배포 스크립트 (CI/CD 없음)
#
# 사용법:
#   bash scripts/deploy.sh
#   bash scripts/deploy.sh --branch feature/my-branch  # 특정 브랜치 배포
#
# 롤백 방법:
#   bash scripts/rollback.sh
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
SERVICE="memento-prod"
IMAGE="memento-prod:latest"
ROLLBACK_IMAGE="memento-prod:rollback"
HEALTH_PORT="${PORT:-8080}"
HEALTH_URL="http://localhost:${HEALTH_PORT}/health"
MAX_WAIT=90
BRANCH="${2:-main}"

# --branch 옵션 파싱
for arg in "$@"; do
  case $arg in
    --branch=*) BRANCH="${arg#*=}" ;;
    --branch)   shift; BRANCH="${1:-main}" ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

# docker compose v2 플러그인 우선, 없으면 v1 standalone 사용
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null 2>&1; then
  DC="docker-compose"
else
  err "docker compose 또는 docker-compose를 찾을 수 없습니다."
  exit 1
fi

# 프로젝트 루트 기준으로 실행
cd "$(dirname "$0")/.."

log "=== Memento 배포 시작 ==="
log "브랜치: $BRANCH | 헬스체크 URL: $HEALTH_URL"

# 1. 현재 이미지를 rollback 태그로 보존
if docker image inspect "$IMAGE" &>/dev/null 2>&1; then
  log "현재 이미지를 rollback 태그로 보존..."
  docker tag "$IMAGE" "$ROLLBACK_IMAGE"
  log "보존 완료: $ROLLBACK_IMAGE"
else
  log "기존 이미지 없음 — 최초 배포로 진행"
fi

# 2. git pull
log "코드 업데이트 (git pull origin $BRANCH)..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# 3. 빌드 & 실행 (memento-prod 서비스만 재빌드, redis/nginx는 그대로)
# ARM(라즈베리파이 등)에서는 MiniLM 워밍업을 건너뜀 — 최초 런타임에 자동 수행됨
BUILD_ARGS=""
if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "armv7l" ]; then
  log "ARM 아키텍처 감지 — SKIP_TRANSFORMERS_WARMUP=1 적용"
  BUILD_ARGS="--build-arg SKIP_TRANSFORMERS_WARMUP=1"
fi
log "Docker 빌드 시작..."
$DC -f "$COMPOSE_FILE" build $BUILD_ARGS "$SERVICE"

log "컨테이너 교체..."
$DC -f "$COMPOSE_FILE" up -d "$SERVICE"

# nginx, redis는 아직 실행 중이 아니면 함께 시작
$DC -f "$COMPOSE_FILE" up -d

# 4. 헬스체크 대기
log "헬스체크 대기 (최대 ${MAX_WAIT}초)..."
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    log "=== 배포 성공! (${i}초 소요) ==="
    log "서비스 상태:"
    $DC -f "$COMPOSE_FILE" ps
    exit 0
  fi
  printf "."
  sleep 1
done
echo ""

# 5. 헬스체크 실패 → 자동 롤백
err "헬스체크 실패 (${MAX_WAIT}초 초과)"
log "컨테이너 로그 (마지막 30줄):"
$DC -f "$COMPOSE_FILE" logs --tail=30 "$SERVICE" || true

if docker image inspect "$ROLLBACK_IMAGE" &>/dev/null 2>&1; then
  log "자동 롤백 실행..."
  docker tag "$ROLLBACK_IMAGE" "$IMAGE"
  $DC -f "$COMPOSE_FILE" up -d "$SERVICE"
  log "롤백 완료. 수동 확인: docker-compose -f $COMPOSE_FILE logs $SERVICE"
else
  err "롤백 이미지 없음. 수동 복구 필요."
  err "  docker-compose -f $COMPOSE_FILE logs $SERVICE"
fi
exit 1
