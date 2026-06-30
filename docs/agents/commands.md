# 명령어·환경·운영

## 설정 및 빌드

```bash
npm install          # 의존성 설치
npm run build        # 전체 빌드 (core → server → client)
npm run db:init      # SQLite 스키마 초기화
npm run db:migrate   # 보류 중인 마이그레이션 실행
```

## 개발 및 실행

```bash
npm run dev          # MCP 서버 (Watch)
npm run dev:http     # HTTP 관리 서버 (Watch)
npm run dev:http-v2  # HTTP v2 관리 서버 (Watch)
npm run start        # 컴파일된 MCP 서버
npm run start:http   # 컴파일된 HTTP 서버
```

## 테스트 및 품질

```bash
npm test             # 전체 테스트
npm run lint         # 린트
npm run type-check   # 타입 체크
npm run test:search  # 검색 시나리오 테스트
```

커밋 전 `lint`, `type-check`, `test` 통과 필수.

## Git worktree (이슈 격리)

```bash
git worktree add -b 031-feature-name ../memento-issue-123 main
# 형제 디렉터리 예: git worktree add ../memento-worktrees/032-feature-name -b 032-feature-name origin/main
cd ../memento-issue-123 && npm install
git worktree list
git worktree remove ../memento-issue-123   # 브랜치 삭제 전 필수
```

## Docker 및 DB 운영

```bash
npm run db:backup                 # 메모리 DB 백업
npm run db:restore-from-corrupt   # 손상 DB 복구
npm run db:pre-docker-deploy      # Docker 배포 전 무결성 점검
npm run docker:build              # 이미지 빌드
npm run docker:up                 # 컨테이너 기동
```

배포 절차: [docker-deploy-procedure.md](../operations/ko/docker-deploy-procedure.md)

## 환경 변수 (요약)

| 변수 | 용도 |
|------|------|
| `DB_PATH` | SQLite 경로 (프로덕션은 절대 경로; `~` 미확장) |
| `ADMIN_API_KEY` | HTTP 관리 API 키 (프로덕션 필수) |
| `MEMENTO_HTTP_BIND_HOST` | HTTP 바인드 (기본 `127.0.0.1`) |

상세: [environment-variable-governance.md](../guides/ko/environment-variable-governance.md), [env-deployment-checklist.md](../operations/env-deployment-checklist.md)
