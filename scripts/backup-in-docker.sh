#!/bin/sh
# ~/.memento/data 는 컨테이너 사용자(uid 1001) 소유라, 호스트 사용자는 SQLite 가 WAL 모드에서
# 필요로 하는 -shm 사이드카를 그 디렉터리에 만들 수 없다 (#1001). 그래서 같은 백업 스크립트를
# 컨테이너 안에서 돌리되, 출력은 호스트 소유 백업 디렉터리로 보내 #963 의 분리를 유지한다.
#
# uid 는 이미지 기본값(1001)을 유지해야 /app/data 에 쓸 수 있고,
# gid 는 호스트 사용자의 것으로 맞춰야 호스트 백업 디렉터리에 쓸 수 있다.
set -eu

BACKUP_DIR="${MEMENTO_BACKUP_DIR:-$HOME/.memento/backups}"
CONTAINER_UID="${MEMENTO_CONTAINER_UID:-1001}"
SERVICE="${MEMENTO_COMPOSE_SERVICE:-memento-mcp-server}"

mkdir -p "$BACKUP_DIR"

exec docker compose run --rm --no-deps -T \
  --user "$CONTAINER_UID:$(id -g)" \
  -v "$BACKUP_DIR:$BACKUP_DIR" \
  -e "MEMENTO_BACKUP_DIR=$BACKUP_DIR" \
  --entrypoint node \
  "$SERVICE" scripts/backup-memory-db.mjs "$@"
