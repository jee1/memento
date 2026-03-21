# 저장소 가이드라인

## 프로젝트 구조 및 모듈 구성
루트는 npm workspaces로 `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`를 포함한다.

- **packages/memento-core** (`@memento/core`): 도메인·인프라·공유만 포함하는 라이브러리. 진입점: `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase`. DB 초기화·마이그레이션은 `npm run db:init` / `npm run db:migrate` (core 워크스페이스에서 실행).
- **packages/memento-server**: core를 소비하는 MCP/HTTP 서버. bin은 루트 `npm run dev`·`npm start`로 실행.
- **packages/memento-client** (`@memento/client`): 서버 연결용 클라이언트 라이브러리.
- **apps/** : 실험용 앱. 예: `experimental-example`은 `@memento/core`를 in-process로 사용(연결 방식은 각 앱 README 참고).

소스 코드는 루트 `src/` 및 각 패키지 `src/` 아래에 위치한다. 서버 MCP 진입점은 `packages/memento-server/src/server/index.ts`, HTTP 진입점은 `packages/memento-server/src/server/http-server.ts`이다. 도메인 로직은 core의 `src/domains/`에 관심사별로 묶여 있다: `memory/`, `embedding/`, `forgetting/`, `search/`, `anchor/`, `relation/`, `monitoring/` 등. 공유 타입·유틸은 core의 `src/shared/`, 영속성·캐시·스케줄러 등 인프라는 core의 `src/infrastructure/`에 둔다. DB 스키마·초기화·마이그레이션은 core의 `src/infrastructure/database/`에 두고, 빌드 시 `copy:assets`가 스키마를 `dist/database/`로, 마이그레이션 SQL을 `dist/infrastructure/...`로 복사한다. 로컬 SQLite 상태는 `data/`에 기록되며, 임시로 취급한다. 문서는 `docs/`에 있으며, **목차·분류**는 [docs/README.md](docs/README.md)를 참조한다. 빌드 산출물은 각 패키지·앱의 `dist/`에 컴파일된다(수동 편집 금지). 참고로 `packages/mcp-client/` 등 일부 legacy 디렉터리가 남아 있을 수 있으나, 현재 워크스페이스 기준 공식 경로는 위 목록을 따른다.

## 빌드·테스트·개발 명령
다른 작업 전에 한 번 `npm install`을 실행한다.

- **전체 워크스페이스**: `npm run build` → core → server → client 순서 빌드. `npm run build:packages`로 패키지만 빌드. `npm test`는 루트·패키지 테스트 실행.
- **서버**: `npm run dev`(MCP watch), `npm run dev:http`(HTTP), `npm run start`(컴파일된 서버 기동). 서버 코드는 `packages/memento-server`에 있음. `dev:http-v2` / `start:http-v2`는 현재 placeholder 스크립트이므로 구현 완료 전까지 일반 개발 명령으로 간주하지 않는다.
- **core**: `npm run build -w @memento/core`, DB 초기화는 `npm run db:init -w @memento/core`, 마이그레이션은 `npm run db:migrate -w @memento/core`.
- **client**: `npm run build -w @memento/client`, `npm run test -w @memento/client`.
- **apps**: 예시 앱은 `npm run build -w experimental-example`, `npm run start -w experimental-example` (또는 해당 앱 디렉터리에서 `npm run build && npm start`).

품질 게이트: `npm run lint`, `npm run type-check`, `npm test`(Vitest, 한 번 실행). watch 모드는 `npm run test:watch`. `npm run test:client`, `npm run test:search`, `npm run test:forgetting` 등 시나리오 스크립트는 상위 수준 워크플로를 검증한다.

## 코딩 스타일 및 네이밍 규칙
Node.js ≥ 20과 ES 모듈 기반 현대 TypeScript를 대상으로 한다. `packages/memento-server/src/server/index.ts`처럼 두 칸 들여쓰기, 후행 쉼표, 작은따옴표를 기본으로 한다. 파일명은 kebab-case(`memory-embedding-service.ts`), 클래스는 PascalCase, 함수는 camelCase. 비즈니스 로직은 core의 `src/shared/` 공유 인터페이스로 타입을 유지한다. 가능하면 커밋 전에 `npm run lint -- --fix`로 포맷한다.

## 테스트 가이드라인
Vitest로 단위·통합 테스트를 수행하며, 파일 네이밍 규칙은 다음과 같다.

- **단위 테스트** (`.spec.ts`): 테스트 대상 모듈과 같은 디렉터리(또는 해당 `__tests__/`)에 둔다.
  - 예: `src/server/http-server.spec.ts`, `src/domains/search/algorithms/` 내 `.spec.ts`
  - 모킹으로 개별 함수/클래스를 테스트한다.
- **E2E 테스트** (`test-*.ts`): `src/test/` 디렉터리에 둔다.
  - 예: `src/test/test-client.ts`
  - 실제 MCP 서버로 전체 워크플로를 테스트한다.
- **디렉터리 역할**: 루트 `tests/` — 통합 테스트·픽스처(fixtures, integration). `src/test/` — E2E·시나리오 테스트(test-*.ts 등).

`DatabaseUtils` 헬퍼로 결정론적 데이터를 사용하는 것을 권장한다. 전체 스위트는 `npm test`로 실행하고, 사용한 시나리오 스크립트(예: `npm run test:performance`)는 PR 코멘트에 적어 둔다. 테스트가 로컬 SQLite DB를 수정하면 `data/`를 정리하거나 초기화한다.

## 커밋 및 PR 가이드라인
기존 conventional commit 스타일(`feat:`, `fix:`, `chore:`)을 따르고, 간결하고 행동 지향적인 요약을 쓴다. 팀에 도움이 되면 본문에 한국어 맥락을 포함한다. 추적 이슈는 본문에서 참조한다. PR에는 의도, 테스트 근거, 스키마·설정 변경 사항을 적는다. HTTP/UI 관련 변경은 로그나 스크린샷을 첨부하고, 검색·망각·DB 모듈을 건드릴 때는 해당 도메인 담당자 리뷰를 요청한다.

## 환경 및 DB 참고
`env.example`을 `.env`로 복사한 뒤 API 키나 DB 경로를 필요에 따라 덮어쓴다. 새 환경은 `npm run db:init`(실제 진입점: `packages/memento-core/src/infrastructure/database/database/init.ts`), SQLite 스키마 변경 시에는 `npm run db:migrate`를 사용하고, PR에 마이그레이션 노트를 포함한다. **DB 설계 명세**는 `docs/architecture/ko/database-design.md`(또는 `docs/architecture/en/database-design.md`)를 참조한다. 비밀은 소스 관리에서 제외하고, `data/`·`dist/` 아래 생성 파일은 커밋하지 않는다.

## 커뮤니케이션 선호
작업 요약, 상태 업데이트, 코드 리뷰 피드백 등 모든 서면 소통은 협업자가 선호하는 언어로 제공한다. 기본적으로 한국어로 작성한다.

## Memento MCP 사용
- **작업 전**: 답변을 제공하거나 작업을 진행하기 전에 Memento MCP로 관련 기억이 있는지 조회한다. 작업 주제·키워드로 `recall`(하이브리드 검색) 또는 `memory_injection`(쿼리 기반 컨텍스트 주입)을 사용하고, 앵커가 설정되어 있으면 `search_local`로 앵커 주변 기억을 참고한다. 발견한 관련 기억을 앵커로 설정해 두면 이후 작업에 일관되게 참고할 수 있다.
- **작업 후**: 작업이 끝나면 결과를 기억으로 남긴다. `remember` 도구로 완료 기록은 `type: episodic`(태그 예: `completed`), 재사용 가능한 지식은 `type: semantic`(태그 예: `best-practice`, `knowledge`), 반복되는 절차는 `type: procedural`(태그 예: `procedure`)로 저장한다. 중복 저장을 줄이기 위해 저장 전에 관련 기억 검색으로 이미 있는지 확인하고, 구체적이고 검색 가능한 키워드를 포함해 둔다.

## Memento CLI 사용 (AI/스크립트)
- **CLI 사용 시**: 작업 전에는 `recall` 또는 `memory_injection`으로 관련 기억을 조회하고, 작업 후에는 `remember`로 결과를 저장한다. `memento` 실행 파일이 PATH에 없을 수 있으므로 로컬 설치 환경에서는 `npm exec -- memento ...` 또는 설치된 바이너리 경로를 사용한다. 설정은 **DB_PATH** 환경 변수 또는 **~/.memento/.env**에서 지정한다. 자세한 사용법은 [docs/guides/ko/memento-cli-for-ai.md](docs/guides/ko/memento-cli-for-ai.md)를 참조한다.

## Serena MCP 사용
- Codex는 가능한 한 Serena MCP 도구를 통해 코드 탐색·편집 작업을 수행한다. 전체 `read_file` 호출에 의존하기 전에 심볼 인식 명령(`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, `replace_symbol_body` 등)을 우선 사용한다.
- 같은 파일을 여러 번 다시 읽지 않는다. 이전 Serena 응답을 캐시하고, overview나 시그니처만으로는 부족할 때만 추가 상세를 요청한다.
- 편집 시에는 파일 전체를 가져오지 말고 Serena 헬퍼(`insert_after_symbol`, `insert_before_symbol`, `replace_content`, `replace_symbol_body`)로 특정 심볼이나 삽입 지점을 지정한다. 50줄 미만의 작은 파일만 전체 읽기를 허용한다.
- 토큰 사용을 줄이기 위해 Serena 검색 헬퍼(`search_for_pattern`, `find_referencing_symbols`)를 쓰고, 저장소 전체 스캔 대신 현재 작업에 직접 관련된 도구 결과만 가져온다.
