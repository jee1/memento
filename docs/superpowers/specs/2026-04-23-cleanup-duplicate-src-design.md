# 설계: 루트 src 중복 제거 및 패키지 구조 정규화

---
date: 2026-04-23
topic: cleanup-duplicate-src
status: approved
---

## 1. 개요 (Overview)
현재 Memento 프로젝트는 루트 `src/`와 `packages/memento-core/src/`, `packages/memento-server/src/` 간에 대규모 코드 중복이 존재합니다. 이는 DRY(Don't Repeat Yourself) 원칙을 위반하며 유지보수 리스크를 가중시킵니다. 본 설계는 루트 `src/`를 제거하고 모든 기능을 패키지 기반으로 정규화하는 것을 목표로 합니다.

## 2. 구성 요소 마이그레이션 계획

### 2.1 고유 소스 코드 이동
루트 `src/`에만 존재하는 고유 로직을 적절한 패키지로 이동합니다.
- `src/server/instance-lock.ts` → `packages/memento-server/src/server/utils/instance-lock.ts`
- `src/scripts/check-migration-status.ts` → `packages/memento-server/src/scripts/check-migration-status.ts`
- `src/scripts/copy-assets.js` → `packages/memento-core/scripts/copy-assets.js` (통합 및 최신화)

### 2.2 테스트 코드 분산 배치
루트 `src/test/`의 테스트들을 성격에 따라 재배치합니다.
- **`packages/memento-core/src/test/`**:
  - 임베딩, 검색 엔진, 망각 알고리즘 등 도메인/알고리즘 관련 테스트.
- **`packages/memento-server/src/test/`**:
  - MCP 서버, HTTP API, 클라이언트 연결 등 인프라 및 통합 테스트.

## 3. 루트 구성 및 빌드 환경 업데이트

### 3.1 package.json 수정
- `bin` 경로: `./dist/server/index.js` 대신 `packages/memento-server/dist/server/index.js`를 참조하도록 수정.
- `scripts`: 루트의 직접적인 빌드/실행 명령을 워크스페이스 명령(`-w memento-server` 등)으로 위임.
- `main` 필드 제거 또는 `packages/memento-server`로 위임.

### 3.2 tsconfig.json 수정
- `rootDir: "./src"` 제거.
- 루트는 개별 패키지의 소스를 컴파일하지 않고, 워크스페이스 단위로 관리되도록 설정.

## 4. 실행 및 검증 절차 (Verification)
1. 고유 파일 마이그레이션 완료 확인.
2. 루트 `src/` 디렉토리 완전 삭제.
3. 루트에서 `npm run build` 실행하여 패키지 간 빌드 순서 및 성공 확인.
4. 루트에서 `npm test`를 실행하여 모든 테스트가 정상 통과하는지 검증.

## 5. 보안 및 품질 고려사항
- `instance-lock.ts` 이동 시 서버 중복 실행 방지 기능이 깨지지 않도록 `memento-server` 부트스트랩 로직에서 정확히 참조해야 함.
- PII 마스킹 등 보안 유틸리티가 `memento-core` 패키지를 통해 모든 구성 요소에서 올바르게 호출되는지 확인.
