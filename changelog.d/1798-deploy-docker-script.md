Changed
- 운영 Docker 배포를 `npm run deploy:docker` 한 명령으로 묶었다. 떠 있는 서버에 recall 을 한 번 불러 토큰과 포트를 확인한 뒤 build, 정지, 백업과 integrity_check, 기동, `/health`, 첫 recall 을 차례로 돌고 단계가 실패하면 멈춘다. 백업이 실패하면 새 이미지로 바꾸지 않고 정지했던 컨테이너를 다시 띄운다. 끝에 끊긴 시간(정지부터 `/health` 200, 첫 recall 성공까지)과 `memory_item`, `quick_check`, 버전을 한 줄로 찍는다 (#1798)
- `npm run db:pre-docker-deploy` 는 호스트가 DB 디렉터리와 `-shm` 에 쓸 수 없으면 실패할 호스트 백업을 건너뛰고 바로 컨테이너 안에서 백업한다. 운영에서 정지 구간이 1.1~1.6초 줄어든다 (#1798)
