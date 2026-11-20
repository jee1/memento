Changed
- `npm run deploy:docker` 의 정지 구간에는 복사만 남긴다. 원본 `integrity_check` 는 서버가 도는 동안 읽기 전용으로, 사본 `integrity_check` 는 새 서버 기동과 나란히 한다. 백업 컨테이너는 정지 전에 띄워 두고 `docker exec` 로 쓴다. 오래된 백업 정리는 사본 검사를 통과한 뒤로 미룬다. 256MB DB 시험에서 정지 구간 중앙값이 9.45초에서 4.65초로 줄었다. 정지 전 검사와 정지 사이 몇 초 동안 생긴 손상은 기동 전에 못 잡는다. 사본 검사가 실패하면 직전 백업 경로를 찍고 종료 코드 1 로 끝난다 (#1802)
- `npm run deploy:docker` 의 실패 안내: `/health` 가 끝내 안 되면 「새 컨테이너가 응답하지 않는다」는 안내와 로그 명령을 찍는다. 새 서버를 띄운 뒤의 모든 실패에는 옛 이미지로 되돌리는 명령을 붙인다. 검사를 통과하지 못한 사본은 이름 뒤에 `.unverified` 를 붙여 정리와 직전 백업 선택에서 뺀다. 복사 실패 뒤 옛 컨테이너를 다시 띄우면 `/health` 200 을 기다린 뒤 끝난다 (#1802)
- `scripts/backup-memory-db.mjs --skip-integrity-check`: 사본 검사를 호출자에게 넘긴다. 이 스크립트는 `@memento/core` 전체 대신 backup-manager 모듈만 읽는다 (#1802)
