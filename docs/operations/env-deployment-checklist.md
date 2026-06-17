# 배포 전 환경변수 점검 체크리스트

배포(프로덕션 또는 스테이징) 직전에 아래 항목을 확인합니다.

## 보안

- [ ] `ADMIN_API_KEY`가 비어 있지 않고, ASCII-only(브라우저 대시보드 호환)인지 확인했는가?
- [ ] `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN`이 프로덕션에서 `false`(또는 미설정)인지 확인했는가?
- [ ] `MEMENTO_HTTP_BIND_HOST`가 필요 최소 범위(가능하면 루프백)인지 확인했는가?

## 서버

- [ ] `DB_PATH`가 프로덕션에서 기대한 절대 경로인지 확인했는가? (틸드 `~`는 Node에서 자동 확장되지 않음)
- [ ] `PORT` / `MCP_SERVER_PORT`가 실제 리스닝 포트와 일치하는지 확인했는가?
- [ ] `CORS_ALLOWED_ORIGINS`가 필요한 오리진만 포함하는지 확인했는가?

## 에이전트(해당 시)

- [ ] `services/agent/env.example`를 기준으로 에이전트 전용 변수가 단일 출처로 관리되는지 확인했는가?
- [ ] 루트 `MEMENTO_AGENT_*`와 `AGENT_*` 별칭을 혼용할 경우 우선순위가 문서와 일치하는지 확인했는가?

## 검증

- [ ] `npm run lint`, `npm run type-check`, `npm test`가 통과했는가?
- [ ] Docker 재배포 전 [Docker 배포 절차](ko/docker-deploy-procedure.md)에 따라 `npm run db:pre-docker-deploy`를 실행했는가?
