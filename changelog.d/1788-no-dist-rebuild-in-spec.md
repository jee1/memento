Fixed
- 로컬 병렬 테스트에서 backup-memory-db, deploy-docker 시험이 가끔 실패하던 원인을 없앤다. cli-ac5-ac6 시험이 실행 도중 core, server `dist` 를 다시 빌드해, 다른 워커의 자식 프로세스가 반쯤 쓰인 `dist` 를 읽었다. 시험 안의 재빌드를 지우고, 시험이 `dist` 를 다시 쓰지 못하게 계약 시험을 더한다 (#1788)
