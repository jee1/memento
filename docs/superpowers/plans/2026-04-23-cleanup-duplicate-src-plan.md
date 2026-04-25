# 루트 src 중복 제거 및 패키지 구조 정규화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 루트 `src/` 디렉토리의 중복 코드를 제거하고, 고유 로직과 테스트를 적절한 패키지로 마이그레이션하여 모노레포 구조를 완성합니다.

**Architecture:** 루트 `src/`를 삭제하고 `packages/memento-core` 및 `packages/memento-server`를 중심 패키지로 정규화합니다. 바이너리 실행 및 빌드 로직을 패키지 내부로 위임합니다.

**Tech Stack:** TypeScript, npm workspaces, Vitest

---

### Task 1: 고유 소스 및 스크립트 마이그레이션

**Files:**
- Modify: `packages/memento-server/src/server/utils/instance-lock.ts` (생성)
- Modify: `packages/memento-server/src/scripts/check-migration-status.ts` (생성)
- Modify: `packages/memento-core/scripts/copy-assets.js` (업데이트)

- [ ] **Step 1: instance-lock.ts 이동 및 적용**
  `src/server/instance-lock.ts` 내용을 `packages/memento-server/src/server/utils/instance-lock.ts`로 복사하고, `packages/memento-server/src/server/index.ts`에서 해당 경로를 참조하도록 수정합니다.

- [ ] **Step 2: check-migration-status.ts 이동**
  `src/scripts/check-migration-status.ts`를 `packages/memento-server/src/scripts/check-migration-status.ts`로 이동하고, 내부 `import` 경로를 `@memento/core` 기반으로 수정합니다.

- [ ] **Step 3: copy-assets.js 최신화**
  루트 `src/scripts/copy-assets.js`의 최신 로직을 `packages/memento-core/scripts/copy-assets.js`에 통합합니다.

- [ ] **Step 4: Commit**
```bash
git add packages/memento-server/src/server/utils/instance-lock.ts
git add packages/memento-server/src/scripts/check-migration-status.ts
git add packages/memento-core/scripts/copy-assets.js
git commit -m "chore: migrate unique source files and scripts to packages"
```

---

### Task 2: 테스트 코드 분산 마이그레이션

**Files:**
- Modify: `packages/memento-core/src/test/`
- Modify: `packages/memento-server/src/test/`

- [ ] **Step 1: Core 계열 테스트 이동**
  `src/test/`에서 `test-embedding.ts`, `test-search.ts`, `test-forgetting.ts`, `test-vector-search-engine.ts` 등 도메인 로직 테스트들을 `packages/memento-core/src/test/`로 이동합니다. 내부 `import` 경로를 상대 경로 또는 `@memento/core`로 수정합니다.

- [ ] **Step 2: Server 계열 테스트 이동**
  `src/test/`에서 `test-client.ts`, `test-http-server-v2.ts`, `test-performance-monitoring.ts` 등 서버/API 테스트들을 `packages/memento-server/src/test/`로 이동합니다.

- [ ] **Step 3: 테스트 헬퍼 및 픽스처 이동**
  `src/test/helpers/` 내용을 `packages/memento-core/src/test/helpers/`로 이동하여 중복을 제거합니다.

- [ ] **Step 4: Commit**
```bash
git add packages/memento-core/src/test packages/memento-server/src/test
git commit -m "chore: redistribute tests into core and server packages"
```

---

### Task 3: 루트 구성 및 빌드 환경 업데이트

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: package.json 바이너리 및 스크립트 수정**
  루트 `package.json`의 `bin` 경로를 `packages/memento-server/dist/` 기반으로 변경하고, `scripts`를 `-w` 플래그를 사용하는 워크스페이스 명령으로 위임합니다.
  - `memento-mcp-server`: `./packages/memento-server/dist/server/index.js`
  - `dev`: `npm run dev -w memento-server` 등

- [ ] **Step 2: tsconfig.json 수정**
  루트 `tsconfig.json`에서 `"rootDir": "./src"`를 제거하고, `"include": ["packages/*/src/**/*"]` 등으로 범위를 조정합니다.

- [ ] **Step 3: 빌드 검증**
  루트에서 전체 빌드를 수행하여 패키지 간 의존성 및 에셋 복사 로직이 정상인지 확인합니다.
  `npm run build`

- [ ] **Step 4: Commit**
```bash
git add package.json tsconfig.json
git commit -m "chore: update root configuration to delegate tasks to packages"
```

---

### Task 4: 최종 정리 및 검증

**Files:**
- Modify: `src/` (삭제)

- [ ] **Step 1: 루트 src 삭제**
  마이그레이션이 완료된 루트 `src/` 디렉토리를 완전히 삭제합니다.
  `rm -rf src/`

- [ ] **Step 2: 전체 테스트 실행**
  루트에서 모든 패키지의 테스트를 실행하여 회귀 오류가 없는지 확인합니다.
  `npm test`

- [ ] **Step 3: Commit**
```bash
git rm -r src/
git commit -m "chore: remove duplicate root src directory"
```
