# 개발자 가이드

## 개요

이 가이드는 Memento MCP Server의 개발 환경 설정, 아키텍처 이해, 기여 방법을 설명합니다.

## 목차

1. [개발 환경 설정](#개발-환경-설정)
2. [프로젝트 구조](#프로젝트-구조)
3. [아키텍처 이해](#아키텍처-이해)
4. [개발 워크플로우](#개발-워크플로우)
5. [테스트 작성](#테스트-작성)
6. [기여 방법](#기여-방법)

## 개발 환경 설정

### 필수 요구사항

- **Node.js**: 20.0.0 이상 (package.json 기준)
- **npm**: 10.0.0 이상

### 저장소 가이드라인 (`AGENTS.md`)

프로젝트에는 개발자 가이드라인이 포함되어 있습니다:

- **프로젝트 구조**: `src/` 하위 모듈별 조직화
- **빌드/테스트 명령어**: `npm run dev`, `npm run build`, `npm run test` 등
- **코딩 스타일**: Node.js ≥ 20, TypeScript ES 모듈, 2칸 들여쓰기
- **테스트 가이드라인**: Vitest 기반, `src/test/` 또는 `*.spec.ts` 파일
- **커밋/PR 가이드라인**: Conventional Commits, 한국어 컨텍스트 포함
- **환경/데이터베이스**: `.env` 설정, `data/` 폴더 관리
- **TypeScript**: 5.3.0 (실제 구현 기준)
- **Git**: 2.30.0 이상

### 개발 도구

- **IDE**: VS Code (권장)
- **확장 프로그램**:
  - TypeScript and JavaScript Language Features
  - ESLint
  - Prettier
  - Vitest (실제 사용)
  - GitLens

### 환경 설정

#### 1. 저장소 클론

```bash
git clone https://github.com/your-org/memento.git
cd memento
```

#### 2. 의존성 설치

```bash
# 모든 의존성 설치 (package.json 기준)
npm install

# 실제 사용된 의존성들:
# - @modelcontextprotocol/sdk: ^1.18.2
# - better-sqlite3: ^12.4.1
# - express: ^5.1.0
# - cors: ^2.8.5
# - ws: ^8.18.3
# - zod: ^3.22.4
# - uuid: ^9.0.1
# - openai: ^4.20.1
# - @google/genai: ^1.21.0
# - sqlite-vec: ^0.1.6
# - dotenv: ^16.3.1
# - vitest: ^1.0.0 (테스트)
# - tsx: ^4.6.0 (개발)
```

#### 3. 환경 변수 설정

```bash
# 환경 변수 파일 복사
cp .env.example .env

# 환경 변수 편집
# .env 파일을 편집하여 필요한 설정을 입력하세요
```

#### 4. 데이터베이스 초기화

```bash
# better-sqlite3 데이터베이스 초기화
npm run db:init

# 데이터베이스 마이그레이션
npm run db:migrate
```

#### 5. 개발 서버 시작

```bash
# MCP 서버 개발 모드 (핫 리로드)
npm run dev

# HTTP/WebSocket 서버 개발 모드
npm run dev:http

# 별도 터미널에서 테스트 실행
npm run test -- --watch
```

### VS Code 설정

#### .vscode/settings.json

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "vitest.commandLine": "npm run test",
  "vitest.autoRun": "watch"
}
```

#### .vscode/launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug MCP Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/server/index.ts",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["--run"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

## 프로젝트 구조

### 도메인 기반 아키텍처

Memento는 비즈니스 도메인별로 코드를 구성하는 도메인 기반 아키텍처를 사용합니다.

```
src/domains/
├── memory/                           # 메모리 도메인
│   ├── services/                     # 메모리 서비스
│   ├── tools/                        # 메모리 MCP 도구
│   └── ...
├── search/                           # 검색 도메인
│   ├── algorithms/                  # 검색 알고리즘
│   └── ...
├── anchor/                           # 앵커 시스템 도메인
│   ├── services/                     # 앵커 서비스
│   ├── tools/                        # 앵커 MCP 도구
│   └── ...
├── monitoring/                       # 모니터링 도메인
│   ├── services/                     # 모니터링 서비스
│   ├── tools/                        # 모니터링 MCP 도구
│   └── ...
└── forgetting/                       # 망각 도메인
    ├── services/                     # 망각 서비스
    └── ...
```

**서비스 레이어의 역할**:
- **외부 API 연동**: OpenAI API, 데이터베이스 연동
- **비즈니스 로직**: 임베딩 생성, 벡터 검색, 유사도 계산
- **에러 처리**: API 호출 실패, 재시도 로직
- **캐싱**: 임베딩 결과 캐싱, 성능 최적화
- **Fallback 솔루션**: 경량 하이브리드 임베딩 서비스로 OpenAI API 대체
- **성능 최적화**: 비동기 처리, 캐시 관리, 데이터베이스 최적화
- **모니터링**: 실시간 성능 메트릭 수집 및 분석

### 하이브리드 검색 엔진 (`src/algorithms/hybrid-search-engine.ts`)

기존 검색 엔진에 하이브리드 검색 기능이 추가되었습니다.

```
src/algorithms/
├── search-engine.ts        # 기본 검색 엔진 (233줄)
├── hybrid-search-engine.ts # 하이브리드 검색 엔진 (200줄)
└── search-ranking.ts       # 검색 랭킹 알고리즘
```

**하이브리드 검색의 특징**:
- **FTS5 + 벡터 검색**: 텍스트 검색과 벡터 검색 결합
- **가중치 조정**: 벡터 60%, 텍스트 40% (기본값)
- **점수 정규화**: 0-1 범위로 점수 정규화
- **결과 결합**: 두 검색 결과를 통합한 최종 점수

### 전체 프로젝트 구조

```
memento/
├── src/                          # 소스 코드
│   ├── server/                   # MCP 서버
│   │   ├── index.ts             # 서버 진입점 (521줄)
│   │   ├── tools/               # MCP Tools 구현
│   │   │   ├── remember.ts      # remember 도구
│   │   │   ├── recall.ts        # recall 도구
│   │   │   ├── pin.ts           # pin/unpin 도구
│   │   │   ├── forget.ts        # forget 도구
│   │   │   ├── summarize-thread.ts
│   │   │   ├── link.ts          # link 도구
│   │   │   ├── export.ts        # export 도구
│   │   │   ├── feedback.ts      # feedback 도구
│   │   │   └── index.ts         # 도구 내보내기
│   │   ├── resources/           # MCP Resources 구현
│   │   │   ├── memory.ts        # memory/{id} 리소스
│   │   │   ├── search.ts        # memory/search 리소스
│   │   │   └── index.ts
│   │   ├── prompts/             # MCP Prompts 구현
│   │   │   ├── memory-injection.ts
│   │   │   └── index.ts
│   │   ├── database/            # 데이터베이스 관련
│   │   │   ├── sqlite.ts        # SQLite 구현
│   │   │   ├── postgres.ts      # PostgreSQL 구현
│   │   │   ├── migrations/      # 마이그레이션
│   │   │   └── index.ts
│   │   └── middleware/          # 미들웨어
│   │       ├── auth.ts          # 인증 미들웨어
│   │       ├── logging.ts       # 로깅 미들웨어
│   │       └── error.ts         # 에러 처리 미들웨어
│   ├── client/                  # MCP 클라이언트
│   │   ├── index.ts             # 클라이언트 진입점
│   │   ├── memory-manager.ts    # 메모리 관리자
│   │   ├── mcp-client.ts        # MCP 클라이언트 래퍼
│   │   └── types.ts             # 클라이언트 타입
│   ├── algorithms/              # 검색 및 망각 알고리즘
│   │   ├── search-ranking.ts    # 검색 랭킹 알고리즘
│   │   ├── forgetting.ts        # 망각 알고리즘
│   │   ├── spaced-review.ts     # 간격 반복 알고리즘
│   │   └── index.ts
│   └── shared/                  # 공통 유틸리티
│       ├── types.ts             # 공통 타입 정의
│       ├── utils.ts             # 유틸리티 함수
│       ├── constants.ts         # 상수 정의
│       └── validation.ts        # 검증 함수
├── src/                         # 소스 코드
│   ├── algorithms/             # 알고리즘 모듈
│   │   ├── search-engine.ts
│   │   ├── search-engine.spec.ts    # 단위 테스트
│   │   ├── forgetting-algorithm.ts
│   │   └── forgetting-algorithm.spec.ts  # 단위 테스트
│   ├── services/               # 서비스 모듈
│   │   ├── embedding-service.ts
│   │   └── forgetting-policy-service.spec.ts  # 단위 테스트
│   ├── test/                   # E2E 테스트
│   │   ├── test-client.ts      # 클라이언트 E2E 테스트
│   │   ├── test-search.ts      # 검색 E2E 테스트
│   │   └── test-embedding.ts   # 임베딩 E2E 테스트
│   └── fixtures/               # 테스트 데이터 (필요시)
│       └── test-data.json      # 샘플 테스트 데이터
├── docs/                       # 문서
├── scripts/                    # 빌드 및 배포 스크립트
│   ├── build.js               # 빌드 스크립트
│   ├── deploy.js              # 배포 스크립트
│   └── db-migrate.js          # 데이터베이스 마이그레이션
├── docker/                     # Docker 관련 파일
│   ├── Dockerfile             # M1 Dockerfile
│   ├── Dockerfile.m3          # M3 Dockerfile
│   ├── docker-compose.dev.yml # 개발 환경
│   ├── docker-compose.team.yml # 팀 환경
│   └── docker-compose.org.yml # 조직 환경
├── .cursor/rules/              # Cursor 개발 규칙
├── .github/                    # GitHub Actions
│   └── workflows/
│       ├── ci.yml             # CI 파이프라인
│       ├── test.yml           # 테스트 파이프라인
│       └── deploy.yml         # 배포 파이프라인
├── package.json               # 프로젝트 설정
├── tsconfig.json              # TypeScript 설정
├── jest.config.js             # Jest 설정
├── .eslintrc.js               # ESLint 설정
├── .prettierrc                # Prettier 설정
└── README.md                  # 프로젝트 문서
```

## 아키텍처 이해

### 전체 아키텍처

```mermaid
graph TB
    subgraph "AI Agent Layer"
        A[Claude Desktop] --> B[MCP Client]
        C[ChatGPT] --> B
        D[Cursor] --> B
    end
    
    subgraph "MCP Protocol Layer"
        B --> E[MCP Memory Server]
    end
    
    subgraph "Memory Management Layer"
        E --> F[Memory Manager]
        E --> G[Search Engine]
        E --> H[Forgetting Policy]
    end
    
    subgraph "Storage Layer"
        F --> I[SQLite M1]
        F --> J[PostgreSQL M3+]
        G --> K[Vector Search]
        G --> L[Text Search]
    end
```

### 핵심 컴포넌트

#### 1. MCP 서버 (`src/server/`)

MCP 프로토콜을 구현하는 핵심 서버입니다.

**주요 파일**:
- `index.ts`: 서버 진입점, MCP 서버 초기화
- `tools/`: MCP Tools 구현
- `resources/`: MCP Resources 구현
- `prompts/`: MCP Prompts 구현

**예시 코드**:
```typescript
// src/server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server';
import { rememberTool } from './tools/remember';
import { recallTool } from './tools/recall';

const server = new Server({
  name: 'memento-memory-server',
  version: '0.1.0'
});

// Tools 등록
server.tool('remember', rememberTool);
server.tool('recall', recallTool);

// 서버 시작
server.start();
```

#### 2. 검색 엔진 (`src/algorithms/`)

기억 검색을 위한 알고리즘을 구현합니다.

**주요 파일**:
- `search-ranking.ts`: 검색 랭킹 알고리즘
- `forgetting.ts`: 망각 알고리즘
- `spaced-review.ts`: 간격 반복 알고리즘

**예시 코드**:
```typescript
// src/algorithms/search-ranking.ts
export class SearchRanking {
  calculateFinalScore(features: SearchFeatures): number {
    return this.ALPHA * features.relevance +
           this.BETA * features.recency +
           this.GAMMA * features.importance +
           this.DELTA * features.usage -
           this.EPSILON * features.duplication_penalty;
  }
}
```

#### 3. 데이터베이스 레이어 (`src/server/database/`)

데이터 저장 및 검색을 담당합니다.

**주요 파일**:
- `sqlite.ts`: SQLite 구현 (M1)
- `postgres.ts`: PostgreSQL 구현 (M3+)
- `migrations/`: 데이터베이스 마이그레이션

### 데이터 플로우

#### 1. 기억 저장 플로우

```
AI Agent → MCP Client → MCP Server → Memory Manager → Database
```

#### 2. 기억 검색 플로우

```
AI Agent → MCP Client → MCP Server → Search Engine → Database → Ranking → Results
```

## 개발 워크플로우

### 1. 기능 개발

#### 브랜치 생성

```bash
# 기능 브랜치 생성
git checkout -b feature/new-tool

# 또는 버그 수정 브랜치
git checkout -b fix/memory-leak
```

#### 개발 진행

```bash
# 개발 서버 시작
npm run dev

# 테스트 실행 (별도 터미널)
npm run test:watch

# 코드 포맷팅
npm run format

# 린트 검사
npm run lint
```

### ESLint 설정 및 규칙

#### no-console 규칙

Memento 프로젝트는 `no-console` 규칙을 **error** 레벨로 설정하여 `console.log`, `console.error` 등의 직접 사용을 금지합니다.

**규칙 목적**:
- **MCP 프로토콜 준수**: MCP 서버는 stdio 전송 시 stdout에 오직 JSON-RPC 메시지만 출력해야 합니다
- **로깅 시스템 통일**: 모든 로그는 중앙화된 로깅 시스템(`src/shared/utils/logger.ts`)을 통해 출력되어야 합니다
- **PII 마스킹**: 중앙화된 로깅 시스템은 자동으로 PII(개인 식별 정보)를 마스킹합니다
- **MCP 스펙 준수**: MCP Logger를 통해 `notifications/message` 형식으로 로그를 전송합니다

**예외 처리**:

다음 파일/디렉토리는 `no-console` 규칙 예외가 적용됩니다:

1. **`src/server/index.ts`**:
   - **이유**: MCP 프로토콜 준수를 위해 console 메서드를 오버라이드합니다
   - **설명**: 초기화 전 에러는 stderr에 직접 출력하고, 초기화 후에는 MCP Logger를 사용합니다
   - **설정 위치**: `.eslintrc.json`의 `overrides` 섹션

2. **테스트 파일** (`**/*.spec.ts`, `**/test-*.ts`, `src/test/**`):
   - **이유**: 테스트 코드에서 디버깅 및 출력이 필요합니다
   - **설정 위치**: `.eslintrc.json`의 `overrides` 섹션

3. **스크립트 파일** (`scripts/**`):
   - **이유**: 스크립트 실행 시 직접 출력이 필요합니다
   - **설정 위치**: `.eslintrc.json`의 `overrides` 섹션

**규칙 위반 시 대응 방법**:

1. **일반 코드에서 console 사용이 필요한 경우**:
   ```typescript
   // ❌ 잘못된 방법
   console.log('User logged in:', userId);
   console.error('Database error:', error);
   
   // ✅ 올바른 방법
   import { logger } from '../shared/utils/logger.js';
   
   logger.info('User logged in', { userId });
   logger.error('Database error', { error: error.message });
   ```

2. **MCP 서버 코드에서 로깅이 필요한 경우**:
   ```typescript
   // ✅ MCP Logger 사용
   import { mcpLogger } from './mcp-logger.js';
   
   mcpLogger.info('Server initialized', { component: 'server' });
   mcpLogger.error('Initialization failed', { error: error.message });
   ```

3. **예외가 필요한 경우**:
   - 예외는 최소한으로 유지해야 합니다

### 도메인별 로깅 패턴 통일

**목적**: 모든 도메인에서 일관된 로깅 패턴을 사용하여 로그 분석 및 디버깅을 용이하게 합니다.

#### 기본 원칙

1. **구조화된 로깅**: 모든 로그는 메시지와 메타데이터 객체를 포함해야 합니다
2. **적절한 로그 레벨 사용**: 상황에 맞는 로그 레벨 선택
3. **PII 자동 마스킹**: logger는 자동으로 PII를 마스킹하므로 안전하게 사용 가능
4. **컨텍스트 포함**: 디버깅에 필요한 컨텍스트 정보를 메타데이터에 포함

#### 로그 레벨 가이드라인

- **`logger.debug()`**: 개발 및 디버깅 목적, 상세한 실행 흐름 추적
  ```typescript
  logger.debug('검색 단계', { searchId, step, data });
  ```

- **`logger.info()`**: 일반적인 정보성 메시지, 중요한 작업 시작/완료
  ```typescript
  logger.info('Memory Injection 시작', { query, token_budget });
  logger.info('벡터 인덱스 재구성 완료');
  ```

- **`logger.warn()`**: 잠재적인 문제나 경고 상황, 복구 가능한 오류
  ```typescript
  logger.warn('데이터베이스가 설정되지 않아 인접 기억 갱신을 건너뜁니다');
  logger.warn('임베딩 삭제 실패', { id, error: error.message });
  ```

- **`logger.error()`**: 오류나 예외 상황, 복구 불가능한 오류
  ```typescript
  logger.error('메모리 조회 실패', {
    memoryId,
    error: error instanceof Error ? error.message : String(error)
  });
  logger.error('벡터 검색 실패', {
    memoryId,
    error: error.message
  });
  ```

#### 도메인별 로깅 패턴

##### 1. Memory 도메인 (`src/domains/memory/`)

**서비스 파일**:
```typescript
// ✅ 올바른 패턴
logger.error('메모리 조회 실패', {
  memoryId,
  error: error instanceof Error ? error.message : String(error)
});

logger.warn('높은 중요도의 기억 삭제', {
  memoryId: memory.id,
  importance: memory.importance
});
```

**Tool 파일**:
```typescript
// ✅ 올바른 패턴
logger.info('WAL 체크포인트 완료');
logger.warn('고정 로그 기록 실패', {
  error: maskedError.message
});
```

##### 2. Search 도메인 (`src/domains/search/`)

**알고리즘 파일**:
```typescript
// ✅ 올바른 패턴
logger.debug('하이브리드 검색 단계', {
  searchId,
  step,
  data
});

logger.warn('저장된 임베딩 provider 감지 실패', {
  error: maskedError.message
});
```

**팩토리 파일**:
```typescript
// ✅ 올바른 패턴
logger.info('검색 시작', { query });
logger.info('검색 완료', {
  searchId,
  resultCount: result.total_count,
  duration: queryTime
});
```

##### 3. Monitoring 도메인 (`src/domains/monitoring/`)

**성능 모니터링**:
```typescript
// ✅ 올바른 패턴
logger.info('성능 알림', {
  level: alert.level,
  metric: alert.metric,
  id: alert.id,
  value: alert.value,
  threshold: alert.threshold
});

logger.error('에러 로깅', {
  severity: error.severity,
  category: error.category,
  id: error.id,
  message: error.message
});
```

#### 메타데이터 구조화 가이드라인

1. **에러 로깅 시 필수 필드**:
   ```typescript
   logger.error('작업 실패', {
     error: error instanceof Error ? error.message : String(error),
     // 추가 컨텍스트
     operation: 'operation_name',
     resourceId: 'resource_id'
   });
   ```

2. **성능 로깅 시 필수 필드**:
   ```typescript
   logger.info('작업 완료', {
     duration: queryTime,
     resultCount: results.length,
     // 추가 메트릭
   });
   ```

3. **경고 로깅 시 필수 필드**:
   ```typescript
   logger.warn('경고 상황', {
     reason: 'reason_description',
     // 복구 가능한 경우 복구 정보 포함
     fallback: 'fallback_action'
   });
   ```

#### 금지 사항

1. **❌ 이모지나 특수 문자 사용 금지**:
   ```typescript
   // ❌ 잘못된 방법
   logger.error('❌ 메모리 조회 실패:', error);
   logger.warn('⚠️ 데이터베이스가 설정되지 않았습니다');
   
   // ✅ 올바른 방법
   logger.error('메모리 조회 실패', { error: error.message });
   logger.warn('데이터베이스가 설정되지 않았습니다');
   ```

2. **❌ 문자열 연결 대신 메타데이터 사용**:
   ```typescript
   // ❌ 잘못된 방법
   logger.info(`Memory Injection 시작: "${query}" (토큰 예산: ${token_budget})`);
   
   // ✅ 올바른 방법
   logger.info('Memory Injection 시작', { query, token_budget });
   ```

3. **❌ console.log 직접 사용 금지**:
   ```typescript
   // ❌ 잘못된 방법
   console.log('작업 시작');
   console.error('작업 실패:', error);
   
   // ✅ 올바른 방법
   logger.info('작업 시작');
   logger.error('작업 실패', { error: error.message });
   ```

#### 검증 방법

1. **ESLint 검증**: `npm run lint`로 `no-console` 규칙 위반 확인
2. **스크립트 검증**: `npx tsx scripts/count-console-logs.ts --core-only`로 핵심 모듈 console.* 사용 확인
3. **CI 검증**: CI 파이프라인에서 자동으로 console.* 사용 검증

#### 참고 자료

- **Logger 인터페이스**: `src/shared/utils/logger.ts`
- **MCP Logger**: `src/server/mcp-logger.ts`
- **PII 마스킹**: `src/shared/utils/pii-masker.ts`
- **MCP 스펙**: https://spec.modelcontextprotocol.io/specification/server/#logging
   - 새로운 예외 추가 시 PR에서 명확한 이유를 설명해야 합니다
   - 예외 추가는 `.eslintrc.json`의 `overrides` 섹션에 추가합니다

**ESLint 설정 파일 구조**:

```json
{
  "rules": {
    "no-console": "error"  // 기본 규칙: error 레벨
  },
  "overrides": [
    {
      "files": ["src/server/index.ts"],
      "rules": {
        "no-console": "off"  // 예외: MCP 프로토콜 준수
      }
    },
    {
      "files": ["**/*.spec.ts", "**/test-*.ts", "scripts/**", "src/test/**"],
      "rules": {
        "no-console": "off"  // 예외: 테스트 및 스크립트
      }
    }
  ]
}
```

**CI/CD 검증**:

- CI 파이프라인(`.github/workflows/ci.yml`)에서 `npm run lint` 실행
- `no-console` 규칙 위반 시 빌드 실패
- 규칙 위반 개수 추적을 위한 스냅샷 체크 (향후 추가 예정)

#### 커밋

```bash
# 변경사항 스테이징
git add .

# 커밋 (컨벤셔널 커밋 형식)
git commit -m "feat: add new summarize_thread tool"

# 푸시
git push origin feature/new-tool
```

### 2. 테스트 작성

#### 단위 테스트

```typescript
// tests/unit/tools/remember.test.ts
import { RememberTool } from '@/server/tools/remember';
import { MockDatabase } from '@/tests/mocks/database.mock';

describe('RememberTool', () => {
  let rememberTool: RememberTool;
  let mockDatabase: MockDatabase;

  beforeEach(() => {
    mockDatabase = new MockDatabase();
    rememberTool = new RememberTool(mockDatabase);
  });

  it('should create memory with valid parameters', async () => {
    // Given
    const params = {
      content: 'Test memory',
      type: 'episodic',
      importance: 0.8
    };

    // When
    const result = await rememberTool.execute(params);

    // Then
    expect(result.memory_id).toBeDefined();
    expect(mockDatabase.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Test memory',
        type: 'episodic',
        importance: 0.8
      })
    );
  });
});
```

#### 통합 테스트

```typescript
// tests/integration/mcp-server.test.ts
import { MCPClient } from '@modelcontextprotocol/sdk';
import { MCPServer } from '@/server';

describe('MCP Server Integration', () => {
  let server: MCPServer;
  let client: MCPClient;

  beforeAll(async () => {
    server = new MCPServer();
    await server.start();
    
    client = new MCPClient({
      name: 'test-client',
      version: '1.0.0'
    });
    await client.connect({
      command: 'node',
      args: ['dist/server/index.js']
    });
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it('should handle remember and recall workflow', async () => {
    // Remember
    const rememberResult = await client.callTool('remember', {
      content: 'Integration test memory'
    });

    expect(rememberResult.memory_id).toBeDefined();

    // Recall
    const recallResult = await client.callTool('recall', {
      query: 'integration test'
    });

    expect(recallResult.items).toHaveLength(1);
    expect(recallResult.items[0].content).toContain('Integration test memory');
  });
});
```

### 3. 코드 리뷰

#### Pull Request 생성

1. GitHub에서 Pull Request 생성
2. 변경사항 설명 작성
3. 관련 이슈 연결
4. 리뷰어 지정

#### 리뷰 체크리스트

- [ ] 코드가 프로젝트 스타일 가이드를 따르는가?
- [ ] 테스트가 충분히 작성되었는가?
- [ ] 문서가 업데이트되었는가?
- [ ] 성능에 영향을 주는가?
- [ ] 보안 취약점이 없는가?

## 테스트 작성

### 테스트 전략

#### 1. 단위 테스트 (Unit Tests) - `.spec.ts`

- **목적**: 개별 함수/클래스의 동작 검증
- **범위**: 모든 public 메서드
- **도구**: Vitest
- **위치**: 각 모듈 폴더 내부
- **예시**: 
  - `src/algorithms/search-engine.spec.ts`
  - `src/services/forgetting-policy-service.spec.ts`
  - `src/utils/database.spec.ts`

#### 2. E2E 테스트 (End-to-End Tests) - `test-*.ts`

- **목적**: 전체 워크플로우 검증
- **범위**: 실제 MCP 서버와의 통신
- **도구**: tsx + MCP 클라이언트
- **위치**: `src/test/` 폴더
- **예시**:
  - `src/test/test-client.ts`
  - `src/test/test-search.ts`
  - `src/test/test-embedding.ts`

### 4. 에러 로깅 테스트

- **목적**: 에러 로깅 시스템의 정상 동작 검증
- **범위**: ErrorLoggingService, 에러 통계, 에러 해결
- **도구**: tsx + 직접 서비스 테스트
- **위치**: `src/test-error-logging.ts`

### 5. 성능 알림 테스트

- **목적**: 성능 알림 시스템의 정상 동작 검증
- **범위**: PerformanceAlertService, 실시간 모니터링, 알림 관리
- **도구**: tsx + 직접 서비스 테스트
- **위치**: `src/test-performance-alerts.ts`

### 6. Consolidation Score 품질 테스트

- **목적**: Consolidation Score가 검색 랭킹에 올바르게 반영되는지 검증
- **범위**: 검색 랭킹 알고리즘, 하이브리드 검색 엔진, 품질 지표
- **도구**: Vitest (단위/통합) + tsx (E2E/벤치마크)
- **위치**:
  - 단위 테스트: `src/algorithms/search-ranking.spec.ts`, `src/algorithms/search-result-combiner-consolidation.spec.ts`
  - 통합 테스트: `src/algorithms/hybrid-search-engine-consolidation.spec.ts`
  - E2E 테스트: `src/test/test-consolidation-search-quality.ts`
  - 벤치마크: `src/test/consolidation-search-quality-benchmark.ts`
- **명령어**:
  - `npm run test:consolidation-quality` - E2E 품질 검증
  - `npm run benchmark:consolidation-quality` - Baseline 비교 벤치마크
- **문서**: [Consolidation Score 테스트 가이드](../testing/consolidation-quality-testing.md)

### 테스트 작성 가이드

#### 1. 테스트 구조 (AAA 패턴)

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something when condition', async () => {
      // Arrange (준비)
      const input = createTestInput();
      const expected = createExpectedOutput();
      
      // Act (실행)
      const result = await component.method(input);
      
      // Assert (검증)
      expect(result).toEqual(expected);
    });
  });
});
```

#### 2. Mock 사용

```typescript
// Mock 객체 생성
const mockDatabase = {
  createMemory: jest.fn(),
  getMemory: jest.fn(),
  searchMemories: jest.fn()
};

// Mock 설정
mockDatabase.createMemory.mockResolvedValue('memory-123');

// Mock 검증
expect(mockDatabase.createMemory).toHaveBeenCalledWith(expectedParams);
```

#### 3. 테스트 데이터 관리

```typescript
// tests/fixtures/memories.json
{
  "episodic": [
    {
      "id": "memory-1",
      "content": "Test episodic memory",
      "type": "episodic",
      "importance": 0.8
    }
  ],
  "semantic": [
    {
      "id": "memory-2",
      "content": "Test semantic memory",
      "type": "semantic",
      "importance": 0.9
    }
  ]
}
```

### 테스트 실행

```bash
# 모든 테스트 실행 (Vitest)
npm test

# 특정 테스트 실행
npm run test:client
npm run test:search
npm run test:embedding
npm run test:lightweight-embedding
npm run test:forgetting
npm run test:performance
npm run test:monitoring
npm run test:error-logging
npm run test:performance-alerts

# 커버리지 포함 테스트
npm run test -- --coverage

# 감시 모드
npm run test -- --watch
```

## 기여 방법

### 1. 이슈 생성

#### 버그 리포트

```markdown
**버그 설명**
간단명료한 버그 설명

**재현 단계**
1. '...'로 이동
2. '...' 클릭
3. '...' 입력
4. 오류 발생

**예상 동작**
어떤 일이 일어나야 하는지

**실제 동작**
실제로 일어난 일

**환경**
- OS: [예: Windows 10]
- Node.js: [예: 20.0.0]
- Memento: [예: 0.1.0]
```

#### 기능 요청

```markdown
**기능 설명**
원하는 기능에 대한 간단명료한 설명

**사용 사례**
이 기능이 왜 필요한지, 어떤 문제를 해결하는지

**제안하는 해결책**
구체적인 구현 방안 (있는 경우)

**대안**
고려한 다른 해결책들
```

### 2. 코드 기여

#### 1단계: 저장소 포크

1. GitHub에서 저장소 포크
2. 로컬에 클론

```bash
git clone https://github.com/your-username/memento.git
cd memento
```

#### 2단계: 개발 환경 설정

```bash
# 원본 저장소 추가
git remote add upstream https://github.com/your-org/memento.git

# 의존성 설치
npm install

# 개발 서버 시작
npm run dev
```

#### 3단계: 기능 개발

```bash
# 새 브랜치 생성
git checkout -b feature/your-feature

# 개발 진행
# ... 코드 작성 ...

# 테스트 작성
npm run test

# 커밋
git add .
git commit -m "feat: add your feature"
```

#### 4단계: Pull Request 생성

1. 변경사항 푸시
```bash
git push origin feature/your-feature
```

2. GitHub에서 Pull Request 생성
3. 템플릿에 따라 설명 작성
4. 리뷰어 지정

### 3. 문서 기여

#### 문서 작성 가이드

- **언어**: 한국어 (기술 용어는 영어 병기)
- **형식**: Markdown
- **구조**: 명확한 목차와 섹션 구분
- **예시**: 실제 사용 가능한 코드 예시

#### 문서 업데이트

1. 관련 문서 파일 수정
2. 변경사항 설명
3. 리뷰 요청

### 4. 커밋 메시지 규칙

#### 컨벤셔널 커밋 형식

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### 타입

- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드 프로세스 또는 보조 도구 변경

#### 예시

```bash
feat(tools): add summarize_thread tool
fix(database): resolve memory leak in SQLite connection
docs(api): update remember tool documentation
test(integration): add MCP server integration tests
```

## 에러 로깅 및 성능 모니터링 개발 가이드

### 에러 로깅 시스템

#### 1. 에러 로깅 서비스 사용

```typescript
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../services/error-logging-service.js';

// 에러 로깅 서비스 초기화
const errorLoggingService = new ErrorLoggingService();

// 에러 로깅
try {
  // 위험한 작업 수행
  await riskyOperation();
} catch (error) {
  errorLoggingService.logError(
    error instanceof Error ? error : new Error(String(error)),
    ErrorSeverity.HIGH,
    ErrorCategory.TOOL_EXECUTION,
    {
      operation: 'risky_operation',
      userId: 'user123',
      timestamp: new Date().toISOString()
    }
  );
}
```

#### 2. 에러 통계 조회

```typescript
// 기본 에러 통계
const stats = await errorLoggingService.getErrorStats();

// 필터링된 에러 통계
const highErrors = await errorLoggingService.getErrorStats({
  severity: ErrorSeverity.HIGH,
  hours: 24
});

// 데이터베이스 관련 에러만 조회
const dbErrors = await errorLoggingService.getErrorStats({
  category: ErrorCategory.DATABASE,
  limit: 10
});
```

#### 3. 에러 해결 처리

```typescript
// 에러 해결
const resolved = await errorLoggingService.resolveError(
  'error-123',
  'admin',
  '데이터베이스 연결 문제 해결됨'
);
```

### 성능 알림 시스템

#### 1. 성능 알림 서비스 사용

```typescript
import { PerformanceAlertService, AlertLevel, AlertType } from '../services/performance-alert-service.js';

// 성능 알림 서비스 초기화
const alertService = new PerformanceAlertService('./logs');

// 알림 생성
const alert = alertService.createAlert(
  AlertLevel.WARNING,
  AlertType.RESPONSE_TIME,
  '평균 응답시간',
  150,
  100,
  '🟡 응답시간이 임계값을 초과했습니다',
  { component: 'search_engine', operation: 'search' }
);

// 알림 해결
const resolvedAlert = alertService.resolveAlert(
  alert.id,
  'admin',
  '성능 최적화 완료'
);
```

#### 2. 실시간 모니터링 설정

```typescript
import { PerformanceMonitoringIntegration } from '../services/performance-monitoring-integration.js';

// 모니터링 통합 서비스 초기화
const monitoringIntegration = new PerformanceMonitoringIntegration(
  db,
  alertService,
  {
    enableRealTimeMonitoring: true,
    monitoringInterval: 30000, // 30초마다 체크
    alertThresholds: {
      responseTime: { warning: 100, critical: 500 },
      memoryUsage: { warning: 100, critical: 200 },
      errorRate: { warning: 5, critical: 10 },
      throughput: { warning: 10, critical: 5 }
    }
  }
);

// 실시간 모니터링 시작
monitoringIntegration.startRealTimeMonitoring();
```

### 테스트 작성

#### 1. 에러 로깅 테스트

```typescript
// src/test-error-logging.ts
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from './services/error-logging-service.js';

async function testErrorLogging() {
  const errorService = new ErrorLoggingService();
  
  // 에러 로깅 테스트
  errorService.logError(
    new Error('Test error'),
    ErrorSeverity.HIGH,
    ErrorCategory.SYSTEM,
    { test: true }
  );
  
  // 통계 조회 테스트
  const stats = errorService.getErrorStats();
  console.log('Error stats:', stats);
  
  // 에러 해결 테스트
  const errors = errorService.searchErrors({ limit: 1 });
  if (errors.length > 0) {
    const resolved = errorService.resolveError(
      errors[0].id,
      'test_user',
      'Test resolution'
    );
    console.log('Error resolved:', resolved);
  }
}
```

#### 2. 성능 알림 테스트

```typescript
// src/test-performance-alerts.ts
import { PerformanceAlertService, AlertLevel, AlertType } from './services/performance-alert-service.js';

async function testPerformanceAlerts() {
  const alertService = new PerformanceAlertService('./logs');
  
  // 알림 생성 테스트
  const alert = alertService.createAlert(
    AlertLevel.WARNING,
    AlertType.MEMORY_USAGE,
    '메모리 사용량',
    150,
    100,
    '🟡 메모리 사용량 초과'
  );
  
  // 알림 통계 조회
  const stats = alertService.getStats();
  console.log('Alert stats:', stats);
  
  // 알림 해결 테스트
  const resolved = alertService.resolveAlert(
    alert.id,
    'test_user',
    'Test resolution'
  );
  console.log('Alert resolved:', resolved);
}
```

## 추가 리소스

- [API 참조 문서](api-reference.md)
- [사용자 매뉴얼](user-manual.md)
- [아키텍처 문서](architecture.md)
- [테스트 가이드](testing-guide.md)
- [Cursor Rules](../.cursor/rules/)
- [GitHub 저장소](https://github.com/your-org/memento)
- [커뮤니티 포럼](https://github.com/your-org/memento/discussions)
