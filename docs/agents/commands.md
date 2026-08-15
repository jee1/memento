# 명령어·환경·운영

## 처음 시작하기 — 설정 및 빌드

저장소를 처음 클론했거나 의존성이 맞지 않을 때는 아래 순서로 초기화합니다. `npm install`로 의존성을 설치한 뒤 `npm run build`로 core → server → client 순서로 전체 빌드를 돌립니다. SQLite 스키마가 아직 없으면 `npm run db:init`으로 초기화하고, 보류 중인 마이그레이션은 `npm run db:migrate`로 적용합니다.

```bash
npm install          # 의존성 설치
npm run build        # 전체 빌드 (core → server → client)
npm run db:init      # SQLite 스키마 초기화
npm run db:migrate   # 보류 중인 마이그레이션 실행
```

## 개발 서버 실행

개발 중에는 watch 모드로 서버를 띄워 두면 코드 수정이 바로 반영됩니다. `npm run dev`는 MCP stdio 서버를, `npm run dev:http`는 HTTP 관리 서버를 watch 모드로 실행합니다. v2 HTTP 서버가 필요하면 `npm run dev:http-v2`를 씁니다. 컴파일된 바이너리를 직접 실행할 때는 `npm run start`(MCP)와 `npm run start:http`(HTTP) 중 하나를 선택합니다.

```bash
npm run dev          # MCP 서버 (Watch)
npm run dev:http     # HTTP 관리 서버 (Watch)
npm run dev:http-v2  # HTTP v2 관리 서버 (Watch)
npm run start        # 컴파일된 MCP 서버
npm run start:http   # 컴파일된 HTTP 서버
```

## 테스트 및 품질 검증

코드를 커밋하기 전에는 `lint`, `type-check`, `test` 세 가지가 모두 통과해야 합니다. 검색 관련 변경이 있다면 `npm run test:search`로 검색 시나리오를 별도로 돌려 봅니다.

```bash
npm test             # 전체 테스트
npm run lint         # 린트
npm run type-check   # 타입 체크
npm run test:search  # 검색 시나리오 테스트
```

커밋 전 `lint`, `type-check`, `test` 통과는 필수입니다.

## Git worktree — 이슈 격리 작업

여러 이슈를 동시에 작업할 때는 git worktree로 각각을 독립된 디렉터리에서 처리합니다. 브랜치 이름은 `NNN-feature-name` 형식을 쓰고, worktree 경로는 형제 디렉터리(`../memento-worktrees/`)에 두는 것이 권장됩니다. worktree를 만든 뒤에는 반드시 그 경로에서 `npm install`을 실행해 의존성을 맞춰야 합니다. 작업이 끝나면 브랜치를 삭제하기 **전에** 먼저 `git worktree remove`로 연결을 끊어야 합니다. 순서가 바뀌면 로컬 브랜치 삭제에 실패합니다.

```bash
git worktree add -b 031-feature-name ../memento-issue-123 main
# 형제 디렉터리 예: git worktree add ../memento-worktrees/032-feature-name -b 032-feature-name origin/main
cd ../memento-issue-123 && npm install
git worktree list
git worktree remove ../memento-issue-123   # 브랜치 삭제 전 필수
```

## Docker 및 DB 운영

DB 백업과 복구, Docker 배포는 자주 쓰는 운영 명령입니다. Docker 배포 전에는 **반드시** `npm run db:pre-docker-deploy`로 DB 무결성을 먼저 점검하세요. 이 단계를 건너뛰면 손상된 DB가 컨테이너로 올라갈 수 있습니다.

```bash
npm run db:backup                 # 메모리 DB 백업
npm run db:restore-from-corrupt   # 손상 DB 복구
npm run db:pre-docker-deploy      # Docker 배포 전 무결성 점검
npm run docker:build              # 이미지 빌드
npm run docker:up                 # 컨테이너 기동
```

전체 배포 절차는 [docker-deploy-procedure.md](../operations/ko/docker-deploy-procedure.md)에 정리되어 있습니다.

## 핵심 환경 변수

자주 사용하는 환경 변수 세 가지를 정리합니다. `DB_PATH`는 SQLite 파일 경로로, 프로덕션에서는 반드시 절대 경로를 써야 합니다(`~`는 확장되지 않음). `ADMIN_API_KEY`는 HTTP 관리 API의 인증 키로, 프로덕션에서는 필수입니다. `MEMENTO_HTTP_BIND_HOST`는 HTTP 서버의 바인드 주소로 기본값은 `127.0.0.1`입니다.

| 변수 | 용도 |
|------|------|
| `DB_PATH` | SQLite 경로 (프로덕션은 절대 경로; `~` 미확장) |
| `ADMIN_API_KEY` | HTTP 관리 API 키 (프로덕션 필수) |
| `MEMENTO_HTTP_BIND_HOST` | HTTP 바인드 (기본 `127.0.0.1`) |

### remember near-duplicate (#730)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MEMENTO_REMEMBER_DEDUP_THRESHOLD` | `0.85` | 유사도 임계값 `(0, 1]`; invalid → `0.85` + stderr |
| `MEMENTO_REMEMBER_DEDUP_MODE` | `warn` | `warn`(저장+경고) \| `strict`(거절) \| `off`(검색 스킵) |

에이전트 습관(warn → `update_mode=incremental` 재호출): [agent-workflow.md](./agent-workflow.md#remember-near-duplicate-write-path-730)

전체 환경 변수 목록과 거버넌스 정책은 [environment-variable-governance.md](../guides/ko/environment-variable-governance.md)에서, 배포 체크리스트는 [env-deployment-checklist.md](../operations/env-deployment-checklist.md)에서 확인하세요.

## Introspection 치유 (#728)

`meta_memory_introspection` 스캔이 찾은 저신뢰·고실패 메모리를 re-embed/demote/soft-delete/review로
분류·처리합니다. **먼저 dry-run으로 분류 결과를 확인한 뒤 apply(`dry_run: false`)를 실행하세요.**

```bash
# dry-run (기본값, DB 변경 없음)
curl -X POST http://localhost:9001/admin/introspection/heal \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{}'

# apply
curl -X POST http://localhost:9001/admin/introspection/heal \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"dry_run": false}'
```

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `INTROSPECTION_HEAL_DEMOTE_FACTOR` | `0.8` | demote 시 importance 곱셈 계수 |
| `INTROSPECTION_HEAL_MIN_IMPORTANCE` | `0.1` | demote 하한선 |
| `INTROSPECTION_HEAL_SOFT_DELETE_IMPORTANCE_THRESHOLD` | `0.3` | soft-delete 판단 importance 상한 |

soft-delete는 기존 `ForgettingPolicyService`와 동일한 가역적 메커니즘을 재사용합니다
(`SOFT_DELETE_GRACE_PERIOD_DAYS` 유예 기간 후 물리 삭제). pinned 메모리는 자동 조치 대상에서
완전히 제외되고 review로 분류됩니다.
