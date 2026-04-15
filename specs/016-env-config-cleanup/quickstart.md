# Quickstart: Environment Config Cleanup

## 1) 템플릿 동기화 확인

1. 루트 `env.example`를 열고 `MEMENTO_BASE_URL`, `MEMENTO_AGENT_*`, 임베딩/LLM 기본값이 기대와 일치하는지 확인한다.
2. `docs/guides/ko/environment-variable-governance.md`의 단일 출처 정책과 충돌이 없는지 확인한다.

## 2) 에이전트 설정 파일 역할 확인

1. `services/agent/env.example`(템플릿)과 로컬 `.env`(비추적)를 구분한다.
2. `services/agent/README.md`의 복사 절차(`cp env.example .env`)로 온보딩할 수 있는지 확인한다.

## 3) 보안 변수 점검

1. `ADMIN_API_KEY` 등 민감 변수에 `[REQUIRED in production]` 표기가 있는지 확인한다.
2. insecure 관련 옵션에는 위험 경고가 포함되어 있는지 확인한다.

## 4) 회귀 점검

1. 로컬 실행 환경에서 기존 `.env`를 유지한 상태로 동작이 깨지지 않는지 확인한다.
2. `memento` CLI는 `packages/memento-server/src/cli/env-loader.ts` 탐색 순서로 `.env`를 로드한다. HTTP 서버는 프로세스 환경에 따라 다를 수 있으므로 `docs/guides/ko/environment-variable-governance.md`의 실행 경로별 규칙을 확인한다.

## 5) 배포 전

1. `docs/operations/env-deployment-checklist.md` 항목을 완료한다.
