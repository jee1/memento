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

개발 중에는 watch 모드로 서버를 띄워 두면 코드 수정이 바로 반영됩니다. `npm run dev`는 MCP stdio 서버를, `npm run dev:http`는 HTTP 관리 서버를 watch 모드로 실행합니다. 컴파일된 바이너리를 직접 실행할 때는 `npm run start`(MCP)와 `npm run start:http`(HTTP) 중 하나를 선택합니다.

```bash
npm run dev          # MCP 서버 (Watch)
npm run dev:http     # HTTP 관리 서버 (Watch)
npm run start        # 컴파일된 MCP 서버
npm run start:http   # 컴파일된 HTTP 서버
```

### stdio와 HTTP 동시 기동 (#841)

로컬에서 MCP와 CLI·훅·대시보드를 함께 쓰려면 MCP 설치 환경에
`MEMENTO_HTTP_SIDECAR=1`을 추가합니다. 기본은 꺼짐이며, 같은 프로세스의 DB와 서비스를
공유합니다. 별도 HTTP 프로세스나 두 번째 core를 만들지 않습니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["memento-mcp-server@latest"],
      "env": {
        "MEMENTO_HTTP_SIDECAR": "1",
        "MCP_SERVER_PORT": "9001",
        "ADMIN_API_KEY": "<ASCII 키>",
        "MEMENTO_HTTP_DEFAULT_AGENT_ID": "local-agent"
      }
    }
  }
}
```

CLI와 훅을 실행하는 셸에도 **같은 `ADMIN_API_KEY`**를 설정해야 합니다.
MCP 클라이언트의 `env`는 별도 셸로 전파되지 않습니다. `MEMENTO_CONFIG_DIR`를 지정했다면
CLI·훅에도 같은 디렉터리를 지정하세요. HTTP 도구 호출은 Bearer 인증을 사용하며,
토큰이 없으면 `/tools`·`/mcp`는 loopback에서도 401을 반환하고 서버 로그에 안내됩니다.
`MEMENTO_HTTP_DEFAULT_AGENT_ID`는 owner scope의 기본 에이전트 식별자이므로,
여러 에이전트의 기억을 분리할 때는 각 클라이언트가 자신의 식별자를 보내야 합니다.

고정 포트 충돌을 피하려면 `MCP_SERVER_PORT=0`을 사용하세요. 실제 할당 포트는
`~/.memento/server.json`(또는 `MEMENTO_CONFIG_DIR/server.json`)에 기록되고 CLI·훅이 자동으로
찾습니다. 고정 포트 예시의 대시보드는 `http://127.0.0.1:9001/dashboard`에서 로그인합니다.

같은 설정의 서버가 이미 살아 있으면 그 서버를 사용하고, 같은 DB의 사이드카 기동은
lock 획득자만 시도합니다. 포트가 이미 사용 중이면 HTTP를 건너뛰며 stdio MCP는 계속
동작합니다. 다른 HTTP 기동 오류도 stdio를 종료시키지 않습니다.
MCP 연결 종료·SIGINT·SIGTERM 시 소유한 HTTP 포트와 discovery 파일을 정리합니다.
강제 종료(SIGKILL) 뒤의 stale 파일은 다음 기동 시 생존 검사로 걸러집니다.
구버전의 PID lock 파일은 자동 삭제하지 않으므로 모든 관련 프로세스를 중지한 뒤
DB 디렉터리의 `memento-mcp.lock` 파일을 제거해야 합니다. 새 lock은 디렉터리이며,
stale 회수 때 남는 `.stale-*` 잔재도 모든 관련 프로세스가 중지된 상태에서만 정리하세요.

로컬 1대에서 에이전트 1~2개를 쓰는 경우에는 사이드카가 간편합니다. 여러 에이전트나
상시 대시보드가 필요하면 systemd·pm2·Docker로 HTTP 서버를 상시 기동하세요.
사이드카는 소유한 MCP 프로세스와 함께 종료되며, 다른 stdio 프로세스가 자동으로
인계받지는 않습니다. 상시 서버와 병용할 때는 같은 DB·설정 디렉터리를 사용합니다.

## 테스트 및 품질 검증

코드를 커밋하기 전에는 `lint`, `type-check`, `test` 세 가지가 모두 통과해야 합니다. 검색 관련 변경이 있다면 `npm run test:ci:core`로 core 검색 테스트를 별도로 돌려 봅니다.

```bash
npm test             # 전체 테스트
npm run lint         # 린트
npm run type-check   # 타입 체크
npm run test:ci:core # core 검색·메모리 테스트
```

커밋 전 `lint`, `type-check`, `test` 통과는 필수입니다.

테스트 모킹 경로도 CI `lint-typecheck` 잡에서 검사합니다. 존재하지 않는 모듈을 가리키는 상대 경로 `vi.mock` 은 같은 경로의 동적 import 까지 함께 가로채기 때문에 실행 중에는 드러나지 않고 스펙이 조용히 전량 통과합니다(#821). 정적 스캔이라야 잡힙니다.

```bash
npm run check:vi-mock-paths   # 상대 경로 vi.mock 의 대상 모듈 실재 여부 검사
```

`--ci` 를 붙이면 새 위반에서 종료 코드 1로 차단합니다. 이번 범위 밖의 기존 위반은 `scripts/vi-mock-path-baseline.json` 에 사유와 후속 추적 이슈를 붙여 등재해 두었고, 항목이 해소되면 검사가 `정리 대상` 으로 보고하니 목록에서 지우면 됩니다. 범위 한계(`vi.doMock`·템플릿 리터럴)는 #826 에서 다룹니다.

## 배포 tarball 점검

루트 패키지 tarball은 워크스페이스 링크를 임시 번들로 바꿨다가 반드시 복구해야 합니다. `pack:tarball`은 성공·실패 모두 복구를 보장하며, 중단된 수동 작업 뒤에는 `restore-workspace`로 즉시 원복합니다.

```bash
npm run pack:tarball -- --dry-run
npm run restore-workspace
```

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
npm run db:backup:cleanup         # 백업 backlog 정리 preview (기본, 삭제 없음)
npm run db:backup:cleanup -- --apply # preview와 같은 선택자를 실제 삭제에 적용
npm run db:restore-from-corrupt   # 손상 DB 복구
npm run db:pre-docker-deploy      # Docker 배포 전 무결성 점검
npm run db:residue -- report      # DB 잔재 진단 (임베딩 갭·중복·dimensions=0)
npm run db:residue -- cleanup-embeddings              # dimensions=0 preview
npm run db:residue -- cleanup-embeddings --apply      # dimensions=0 삭제
npm run db:vacuum                 # DELETE 후 VACUUM (before/after/reclaimed JSON)
npm run docker:build              # 이미지 빌드
npm run docker:up                 # 컨테이너 기동
```

`db:backup`의 무인자 JSON 성공 출력은 기존 계약을 유지합니다. `db:backup:cleanup`은 기본이 preview라 파일을 지우지 않고, `-- --apply`를 명시해야 삭제합니다. Apply 전에는 MCP 서버, restore 명령, 다른 cleanup/backup 작업을 모두 중지하세요. `DB_PATH`는 프로덕션에서 절대 경로를 쓰고, 환경 변수 안의 `~`는 확장되지 않습니다. Cleanup은 non-zero operator 백업을 보존하고, 실패 보고에는 절대 DB 경로나 백업 디렉터리를 싣지 않습니다.

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

## 손상된 triple 문장 복구 (#768)

옛 템플릿(`${subject}는 ${object}를 ${predicate}합니다`)이 만든 semantic 기억은 `정의됨합니다`처럼
활용이 깨져 있습니다. subject/predicate/object 컬럼이 남아 있는 행만 새 렌더러로 다시 만들며,
**기본값은 dry-run**입니다. 적용 시 임베딩도 다시 생성합니다.

```bash
DB_PATH=./data/memory.db npm run memory:repair-triple-sentences            # dry-run
DB_PATH=./data/memory.db npm run memory:repair-triple-sentences -- --apply # 적용
```

triple 컬럼이 없는 손상 행은 복구 불가로 ID만 보고합니다. 주입 단계에서는
`memory_injection`이 이중 활용 문장을 자동으로 제외하므로, 복구 전에도 프롬프트는 오염되지 않습니다.

## 파이프라인 템플릿 semantic 격리 (#804)

triple 추출 파이프라인이 만든 템플릿 문장 semantic 기억을 `npm run memory:quarantine-065`로
기존 `forget` 도구를 통해 격리합니다.
`report`·`export-relations`는 대상 DB를 **읽기만** 하고, `rehearse`는 사본에서만 동작하며
(프로덕션 경로를 지정하면 종료 코드 12로 거부), `execute`는 12개 중단 게이트를 전부 통과해야
삭제를 시작합니다. `DB_PATH`는 절대 경로여야 합니다.

```bash
# dry-run 리포트 + 관계 내보내기 (라이브 읽기 전용)
DB_PATH=$HOME/.memento/data/memory.db npm run memory:quarantine-065 -- report
DB_PATH=$HOME/.memento/data/memory.db npm run memory:quarantine-065 -- export-relations

# 사본에서 전량 리허설 — 소요 시간 실측용
DB_PATH=/tmp/quarantine-copy-b.db npm run memory:quarantine-065 -- rehearse
```

라이브 실행(`execute` → `cleanup` → `vacuum`)은 서버 정지가 전제이며 되돌릴 수 없습니다.
백업·사본 구동 검증·리허설을 마친 뒤 전체 절차와 게이트별 종료 코드를
[specs/065-804-triple-semantic-quarantine/quickstart.md](../../specs/065-804-triple-semantic-quarantine/quickstart.md)와
[contracts/runner-cli.md](../../specs/065-804-triple-semantic-quarantine/contracts/runner-cli.md)에서 확인하세요.

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
