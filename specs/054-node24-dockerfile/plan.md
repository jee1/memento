# Implementation Plan: Dockerfile Node 24

## Approach

1. Dockerfile `FROM` 두 줄만 major bump (alpine builder / slim production 유지).
2. `docker build --build-arg SKIP_TRANSFORMERS_WARMUP=1`로 빌드 검증 (warmup은 선택).
3. 컨테이너에서 `node -v` + `/health` 스모크.
4. `docs/operations/ko/docker-deploy-procedure.md`에 베이스 이미지 Node 24 한 줄.

## Risks

- alpine↔slim libc로 sharp/sqlite 바이너리 선택 실패 → 빌드 로그 확인.
- `useradd -u 1001`과 베이스 이미지 기본 유저 충돌 가능성 → 빌드 실패 시 uid 조정.

## Test Strategy

Docker 빌드·런타임 스모크가 주 검증. 앱 단위 테스트는 이 PR 범위 밖.
