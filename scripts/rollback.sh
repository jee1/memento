#!/usr/bin/env bash
# rollback.sh — 이전 버전으로 수동 롤백
#
# 사용법:
#   bash scripts/rollback.sh
#
# deploy.sh가 최소 한 번 성공적으로 실행되어야 rollback 이미지가 존재합니다.
set -euo pipefail

COMPOSE_FILE="docker/docker-compose.prod.yml"
SERVICE="memento-prod"
IMAGE="memento-prod:latest"
ROLLBACK_IMAGE="memento-prod:rollback"
HEALTH_PORT="${PORT:-8080}"
HEALTH_URL="http://localhost:${HEALTH_PORT}/health"
MAX_WAIT=60

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

cd "$(dirname "$0")/.."
ENV_FILE_ARGS=()
if [[ -f .env ]]; then
  ENV_FILE_ARGS=(--env-file .env)
fi

log "=== Memento 롤백 시작 ==="

# rollback 이미지 존재 확인
if ! docker image inspect "$ROLLBACK_IMAGE" &>/dev/null 2>&1; then
  err "롤백 이미지($ROLLBACK_IMAGE)가 없습니다."
  err "deploy.sh가 최소 한 번 실행되어야 롤백 이미지가 생성됩니다."
  exit 1
fi

ROLLBACK_ID=$(docker inspect --format='{{.Id}}' "$ROLLBACK_IMAGE" | cut -c1-12)
log "롤백 대상 이미지: $ROLLBACK_IMAGE ($ROLLBACK_ID)"

# 현재 이미지를 임시 보존 (롤백 후 다시 복구 가능하도록)
if docker image inspect "$IMAGE" &>/dev/null 2>&1; then
  docker tag "$IMAGE" "memento-prod:before-rollback"
  log "현재 이미지를 memento-prod:before-rollback으로 보존"
fi

# rollback 이미지를 latest로 교체
docker tag "$ROLLBACK_IMAGE" "$IMAGE"

# 컨테이너 재시작
log "컨테이너 재시작..."
$DC -p "${COMPOSE_PROJECT_NAME:-memento}" "${ENV_FILE_ARGS[@]}" -f "$COMPOSE_FILE" up -d "$SERVICE"

# 헬스체크 대기
log "헬스체크 대기 (최대 ${MAX_WAIT}초)..."
for i in $(seq 1 $MAX_WAIT); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    log "=== 롤백 성공! (${i}초 소요) ==="
    log "현재 실행 중인 이미지: $ROLLBACK_ID"
    $DC -p "${COMPOSE_PROJECT_NAME:-memento}" "${ENV_FILE_ARGS[@]}" -f "$COMPOSE_FILE" ps
    exit 0
  fi
  printf "."
  sleep 1
done
echo ""

err "롤백 후 헬스체크도 실패했습니다."
err "수동 확인:"
err "  $DC -p \"${COMPOSE_PROJECT_NAME:-memento}\" -f $COMPOSE_FILE logs $SERVICE"
err "  $DC -p \"${COMPOSE_PROJECT_NAME:-memento}\" -f $COMPOSE_FILE ps"
exit 1
