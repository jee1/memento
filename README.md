# 🧠 Memento MCP Server

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">
  
  <h3>✨ AI Agent의 기억을 영원히 기억하세요 ✨</h3>
  
  <p><strong>사람의 기억 구조를 모사한 지능형 메모리 관리 시스템</strong></p>
  
  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)
</div>

> **🚀 Memento is a memory operating system for LLM agents.**  
> Memento는 LLM이 '대화를 기억하는 척'이 아니라, 기억을 생성·분류·강화·망각하는 주체로 행동하게 만드는 MCP 기반 메모리 운영 시스템입니다.  
> 작업기억, 일화기억, 의미기억, 절차기억을 모사하여 **진정한 장기 기억**을 구현합니다.

## 🎯 프로젝트 개요

Memento MCP Server는 AI Agent가 장기 기억을 저장하고 관리할 수 있도록 도와주는 MCP(Model Context Protocol) 서버입니다. 사람의 기억 구조(작업기억, 일화기억, 의미기억, 절차기억)를 모사하여 효율적인 기억 관리 시스템을 제공합니다.

### 📦 프로젝트 구조 (모노레포)

이 저장소는 **npm workspaces** 기반 모노레포입니다.

| 경로 | 설명 |
|------|------|
| **packages/memento-core** (`@memento/core`) | 도메인·인프라·공유 라이브러리. 진입점: `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase`. DB 초기화·마이그레이션은 루트에서 `npm run db:init` / `npm run db:migrate`로 실행. |
| **packages/memento-server** | core를 사용하는 MCP/HTTP 서버. 루트 `npm run dev`, `npm start`, `npm run dev:http` 등으로 실행. |
| **packages/memento-client** (`@memento/client`) | 서버 연결용 클라이언트 라이브러리. |
| **apps/** | 실험용 앱 (예: `experimental-example`은 `@memento/core`를 in-process로 사용). |

상세 구조·빌드·테스트 명령은 [AGENTS.md](AGENTS.md)를 참조하세요.

## ✨ 주요 기능

### 🧠 핵심 메모리 관리 (MCP 클라이언트)
- **기억 저장**: 4가지 타입의 기억 저장 (working, episodic, semantic, procedural)
- **기억 검색**: 하이브리드 검색 (텍스트 + 벡터)
- **이웃 기억 탐색**: 벡터 유사도 기반 유사한 기억 자동 추천
- **기억 고정**: 중요한 기억 고정/해제
- **기억 삭제**: 소프트/하드 삭제
- **앵커 시스템**: 중요한 기억을 앵커로 설정하여 컨텍스트 관리
- **메타 메모리 통계**: 기억 검색 성공률, 신뢰도 점수 등 통계 조회
- **기억 변환**: Episodic Memory를 Semantic Memory로 자동 변환

### 🔍 고급 검색
- **FTS5 텍스트 검색**: SQLite의 Full-Text Search
- **벡터 검색**: sqlite-vec 기반 의미적 검색
- **하이브리드 검색**: 텍스트와 벡터 검색의 결합
- **다중 임베딩 제공자**: TF-IDF, MiniLM, OpenAI, Gemini 지원
- **자동 제공자 선택**: 설정 기반 최적 제공자 자동 선택
- **폴백 메커니즘**: 제공자 실패 시 자동 대체 (OpenAI → 경량 서비스)
- **태그 기반 필터링**: 메타데이터 기반 검색

### 🧹 망각 정책
- **망각 알고리즘**: 최근성, 사용성, 중복 비율 기반 망각 점수 계산
- **간격 반복**: 중요도와 사용성 기반 리뷰 스케줄링
- **TTL 관리**: 타입별 수명 관리
- **자동 정리**: 소프트/하드 삭제 자동화

### 📊 성능 모니터링 (HTTP 관리 API)
- **보안**: HTTP API는 인증이 없으며 **내부망/MCP 전용** 사용을 권장합니다. 자세한 내용은 [docs/reference/ko/security.md](docs/reference/ko/security.md)를 참고하세요.
- **실시간 메트릭**: 데이터베이스, 검색, 메모리 성능 모니터링
- **실시간 알림**: 30초마다 자동 성능 체크 및 임계값 기반 알림
- **에러 로깅**: 구조화된 에러 로깅 및 통계 수집
- **데이터베이스 최적화**: 자동 인덱스 추천 및 생성
- **캐시 시스템**: LRU + TTL 기반 캐싱
- **비동기 처리**: 워커 풀 기반 병렬 처리

### 🔗 메모리 그래프 뷰 (브라우저)

HTTP 서버 실행 후 브라우저에서 기억들의 의미적 관계를 그래프로 시각화할 수 있습니다.

```
http://localhost:9001/graph
```

![Memento Memory Graph View](docs/graph-screenshot.png)

## 🚀 빠른 시작

### 🥇 **원클릭 설치 (권장)**
```bash
# 자동 설치 스크립트 실행
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

### 🥈 **npx 방식 (개발자용) - 모든 플랫폼 지원**

#### Windows (PowerShell/CMD)
```powershell
# 즉시 실행 (설치 없이)
npx memento-mcp-server@latest dev

# MCP 서버 실행
npx memento-mcp-server@latest

# 자동 설정
npx memento-mcp-server@latest setup
```

#### Linux/macOS
```bash
# 즉시 실행 (설치 없이)
npx memento-mcp-server@latest dev

# MCP 서버 실행
npx memento-mcp-server@latest

# 자동 설정
npx memento-mcp-server@latest setup
```

> **참고**: `npm exec` 사용 시 명령어를 명시적으로 지정해야 합니다:
> ```bash
> npm exec -- memento-mcp-server@latest dev
> ```

**npx 실행 시 모드**: MCP 서버(`memento-mcp-server` / stdio), HTTP 서버(`memento-dev`), **CLI**(`memento` — recall, remember, forget, memory_injection)를 구분해 사용할 수 있습니다. **CLI를 반복 사용할 때는** 매번 npx로 실행하면 다운로드가 발생할 수 있으므로 **글로벌 설치**(`npm i -g memento-mcp-server`) 또는 로컬 설치 후 `./node_modules/.bin/memento` 사용을 권장합니다. CLI 가이드: [docs/guides/ko/memento-cli-for-ai.md](docs/guides/ko/memento-cli-for-ai.md).

### 🥉 **Docker 방식 (프로덕션용)**
```bash
# 개발 환경
docker-compose -f docker-compose.dev.yml up -d

# 프로덕션 환경
docker-compose -f docker-compose.prod.yml up -d
```

### 🛠️ **소스코드 방식 (개발자용)**

> **📦 패키지 매니저**: 이 프로젝트는 **npm**을 사용합니다. `pnpm`이나 `yarn`은 사용하지 않습니다.

```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

# 의존성 설치 (루트에서 워크스페이스 전체 설치)
npm install

# 빌드 (core → server → client 순서)
npm run build

# DB 초기화·마이그레이션 (core 워크스페이스에 위임)
npm run db:init
npm run db:migrate

# 원클릭 설치 및 실행
npm run quick-start
```

### 🔌 **다중 에이전트 운영을 위한 HTTP MCP 서버**

SQLite는 WAL 모드를 사용해도 동시에 하나의 writer만 허용합니다. 여러 AI Agent가 각각 프로세스로 `remember`/`forget`을 호출하면 `SQLITE_BUSY`가 발생할 수 있으므로, **반드시 MCP 서버 프로세스를 하나만 띄워 DB를 전담**하도록 구성하는 것을 권장합니다.

```bash
# 개발 모드 (Hot Reload)
npm run dev:http

# 빌드 후 프로덕션 실행
npm run build
npm run start:http      # 또는 node packages/memento-server/dist/server/http-server.js
```

이 방식으로 **packages/memento-server**의 HTTP MCP 서비스를 띄워 두면, 모든 에이전트는 HTTP/WebSocket 인터페이스를 통해 이 서버에만 접속하게 되고 실제 SQLite writer는 단일 프로세스로 제한됩니다. npx로도 동일하게 실행할 수 있으니, 다중 에이전트 환경에서는 이 구조를 반드시 적용해 주세요.

#### MCP 클라이언트 설정 예시 (`mcp.json`)

루트에서 `npm run build` 후 서버 실행 파일은 `packages/memento-server/dist/server/http-server.js`에 있습니다.

```json
{
  "clients": {
    "memento": {
      "command": "node",
      "args": [
        "/path/to/memento/packages/memento-server/dist/server/http-server.js"
      ],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db",
        "MCP_SERVER_PORT": "7777"
      },
      "transport": {
        "type": "http",
        "url": "http://127.0.0.1:7777"
      }
    }
  }
}
```

Cursor 등의 MCP 호스트에서는 위와 같이 `mcp.json`에 HTTP MCP 서버 정보를 등록한 뒤, 모든 AI Agent가 동일한 포트(예: 7777)로 접속하도록 맞춰 주시면 됩니다.

### 📚 **상세 설치 가이드**
- [INSTALL.md](INSTALL.md) - 전체 설치 가이드
- [Cursor MCP 설정 가이드](docs/guides/ko/cursor-mcp-setup.md) - Cursor에서 MCP 서버 사용하기
- [npx 사용자 문제 해결](docs/operations/ko/npx-troubleshooting.md) - npx 실행 시 문제 해결

## 💡 사용 예시

### 🤖 AI Agent와의 연동
```typescript
// AI Agent가 학습한 내용을 기억에 저장
await client.callTool({
  name: "remember",
  arguments: {
    content: "사용자는 React Hook을 학습했습니다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리합니다.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});

// 나중에 관련 정보를 검색
const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "React Hook은 어떻게 사용하나요?",
    limit: 5
  }
});
```

### 📚 지식 관리 시스템
```typescript
// 중요한 지식을 의미기억으로 저장
await client.callTool({
  name: "remember",
  arguments: {
    content: "TypeScript의 제네릭은 타입을 매개변수화하여 재사용 가능한 컴포넌트를 만드는 기능입니다.",
    type: "semantic",
    tags: ["typescript", "generics", "programming"],
    importance: 0.9
  }
});
```

### 🔧 절차 기억 관리
```typescript
// 작업 절차를 절차기억으로 저장
await client.callTool({
  name: "remember",
  arguments: {
    content: "Docker 컨테이너 빌드 및 배포 절차: 1) Dockerfile 작성 2) docker build 실행 3) docker run으로 테스트 4) 레지스트리에 푸시",
    type: "procedural",
    tags: ["docker", "deployment", "devops"],
    importance: 0.7
  }
});
```

## 🛠️ 사용법

### MCP 클라이언트 연결

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({
  name: "memento-client",
  version: "0.1.0"
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

// stdio 연결
await client.connect({
  command: "node",
  args: ["packages/memento-server/dist/server/index.js"]
});

// WebSocket 연결
await client.connect({
  transport: {
    type: "websocket",
    url: "ws://localhost:9001/mcp"
  }
});
```

### 기억 저장

```typescript
// 기억 저장
const result = await client.callTool({
  name: "remember",
  arguments: {
    content: "React Hook에 대해 학습했습니다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리합니다.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});
```

### 기억 검색

```typescript
// 기억 검색
const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "React Hook을 처음 배울 때 알아야 할 것들은?",
    filters: {
      type: ["episodic", "semantic"],
      tags: ["react"]
    },
    limit: 10
  }
});
```

## 📚 문서

- [임베딩 서비스 가이드](docs/guides/ko/embedding-service-guide.md) - 임베딩 서비스 사용법
- [성능 벤치마크](docs/reference/ko/embedding-performance-benchmark.md) - 성능 비교 결과
- [API 레퍼런스](docs/api/ko/embedding-api-reference.md) - API 상세 문서
- [설정 가이드](docs/guides/ko/embedding-configuration.md) - 환경 설정 방법
- [Consolidation Score 테스트 가이드](docs/_work/testing/ko/consolidation-quality-testing.md) - Consolidation Score 검색 품질 테스트 가이드

## 📋 API 문서

### MCP Tools (핵심 14개)

> **중요**: MCP 클라이언트는 핵심 메모리 관리 기능 14개를 노출합니다.  
> 관리/운영성 기능(앵커 복원, 임베딩 마이그레이션, Episodic→Semantic 변환, 메타 메모리 통계)은 HTTP API로만 제공됩니다.

#### 기본 메모리 관리 (7개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember` | 기억 저장 | content, type, tags, importance, source, privacy_scope |
| `recall` | 기억 검색 | query, filters, limit |
| `pin` | 기억 고정 | memory_id |
| `unpin` | 기억 고정 해제 | memory_id |
| `forget` | 기억 삭제 | memory_id, hard |
| `get_memory_neighbors` | 이웃 기억 탐색 | memory_id, limit |
| `memory_injection` | 컨텍스트 주입 프롬프트 생성 | query, token_budget |

#### 앵커 시스템 (4개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `set_anchor` | 앵커 설정 | memory_id, slot |
| `get_anchor` | 앵커 조회 | slot |
| `search_local` | 앵커 주변 검색 | slot, query, limit |
| `clear_anchor` | 앵커 제거 | slot |

#### 절차 기억·고급 (3개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember_procedure` | 절차 기억 저장 | content, workflow_name, skill_name, steps 등 |
| `procedural_diff` | 절차 기억 버전 간 차이 비교 | left_id, right_id |
| `procedural_rollback` | 절차 기억 이전 버전으로 복원 | current_id, target_version_id |

**HTTP 전용 (MCP에 없음)**: `restore_anchors`, `migrate_embeddings`, `convert_episodic_to_semantic`, `get_meta_memory_stats` — 아래 HTTP 관리 API 참조.

### HTTP 관리 API

> **중요**: 다음 기능들은 MCP 클라이언트에 노출되지 않으며, HTTP API로만 제공됩니다.

#### 메모리 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/memory/cleanup` | 메모리 정리 | POST |
| `/admin/memory/convert-episodic-to-semantic` | Episodic → Semantic 변환 | POST |
| `/admin/memory/meta-stats` | 메타 메모리 통계 조회 | GET |
| `/admin/stats/forgetting` | 망각 통계 조회 | GET |

#### 앵커 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/anchors/restore` | 앵커 복원 | POST |

#### 임베딩 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/embeddings/migrate` | 임베딩 마이그레이션 | POST |

#### 성능 모니터링
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/stats/performance` | 성능 통계 조회 | GET |
| `/admin/alerts/performance` | 성능 알림 조회 | GET |

#### 에러 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/stats/errors` | 에러 통계 조회 | GET |
| `/admin/errors/resolve` | 에러 해결 | POST |

#### 데이터베이스 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/database/optimize` | 데이터베이스 최적화 | POST |

**기타 HTTP admin**: 배치 상태/실행(`/admin/batch/*`), 성능 메트릭·알림(`/admin/performance/*`), 관계 추출·조회·시각화(`/admin/relations/*`) 등은 [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)를 참고하세요.

### Resources

| Resource | 설명 |
|----------|------|
| `memory/{id}` | 단일 기억 상세 정보 |
| `memory/search?query=...` | 검색 결과 캐시 |

## 🔧 설정

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `NODE_ENV` | development | 실행 환경 |
| `PORT` / `MCP_SERVER_PORT` | 3000 (코드 기본) | HTTP/MCP 서버 포트 (env.example 권장: 8080) |
| `DB_PATH` | ./data/memory.db | 데이터베이스 경로 |
| `LOG_LEVEL` | info | 로그 레벨 |
| `OPENAI_API_KEY` | - | OpenAI API 키 (선택사항) |
| `GEMINI_API_KEY` | - | Gemini API 키 (선택사항) |
| `EMBEDDING_PROVIDER` | minilm | 임베딩 제공자 (tfidf, lightweight, minilm, openai, gemini) |
| `CONSOLIDATION_SCORE_ENABLED` | false | Consolidation Score System 활성화 여부 |
| `CONSOLIDATION_TEST_SEED_PATH` | ./data/consolidation-seed.json | 테스트 Seed 데이터 파일 경로 |
| `CONSOLIDATION_BASELINE_PATH` | ./data/consolidation-baseline.json | Baseline 스냅샷 저장 경로 |
| `CONSOLIDATION_TEST_ITEM_COUNT` | 100 | 벤치마크 테스트 데이터 크기 |
| `CORS_ALLOWED_ORIGINS` | (비어 있음) | CORS 허용 오리진 (쉼표 구분, 비어 있으면 크로스 오리진 미허용) |
| `ENABLE_PII_MASKING` | true | PII 마스킹 활성화 (보안, [docs/reference/ko/security.md](docs/reference/ko/security.md) 참고) |

> **참고**: 망각 TTL, LLM/Ollama, 검색 한도 등 추가 변수는 `env.example`을 참고하세요.

### 망각 정책 설정

```bash
# 망각 임계값
FORGET_THRESHOLD=0.6
SOFT_DELETE_THRESHOLD=0.6
HARD_DELETE_THRESHOLD=0.8

# TTL 설정 (일 단위)
TTL_SOFT_WORKING=2
TTL_SOFT_EPISODIC=30
TTL_SOFT_SEMANTIC=180
TTL_SOFT_PROCEDURAL=90
```

## 🧪 테스트

```bash
# 모든 테스트 실행 (Vitest)
npm run test

# 개별 테스트 실행
npm run test:client                    # 클라이언트 테스트
npm run test:search                    # 검색 기능 테스트
npm run test:embedding                 # 임베딩 기능 테스트
npm run test:lightweight-embedding     # 경량 임베딩 테스트
npm run test:gemini-embedding         # Gemini 임베딩 테스트
npm run test:forgetting                # 망각 정책 테스트
npm run test:performance               # 성능 벤치마크
npm run test:monitoring                # 성능 모니터링 테스트
npm run test:error-logging             # 에러 로깅 테스트
npm run test:performance-alerts        # 성능 알림 테스트
npm run test:consolidation-quality     # Consolidation Score 품질 검증 테스트
npm run test:vector-search             # 벡터 검색 테스트
npm run test:memory-injection          # 메모리 주입 테스트
npm run test:batch-scheduler           # 배치 스케줄러 테스트
npm run benchmark:consolidation-quality # Consolidation Score 벤치마크 테스트
npm run test:embedding-benchmark      # 임베딩 성능 벤치마크
npm run test:embedding-integration     # 임베딩 통합 테스트

# 테스트 감시 모드
npm run test -- --watch

# 커버리지 포함 테스트
npm run test -- --coverage
```

## 📚 개발자 가이드라인

### 저장소 가이드라인 (`AGENTS.md`)
- **프로젝트 구조**: npm workspaces 모노레포 — `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`. 서버 코드는 `packages/memento-server`, 도메인·인프라는 `packages/memento-core`.
- **빌드/테스트 명령어**: `npm run build`(core→server→client), `npm run dev`·`npm start`(서버), `npm run db:init`·`npm run db:migrate`(DB), `npm test` 등. 상세는 [AGENTS.md](AGENTS.md) 참조.
- **코딩 스타일**: Node.js ≥ 20, TypeScript ES 모듈, 2칸 들여쓰기
- **테스트 가이드라인**: Vitest 기반, 각 패키지 `src/` 내 `*.spec.ts` 또는 루트 `src/test/`
- **커밋/PR 가이드라인**: Conventional Commits, 한국어 컨텍스트 포함
- **환경/데이터베이스**: `.env` 설정, `data/` 폴더 관리

## 📊 성능 지표

### 기본 성능
- **데이터베이스 성능**: 평균 쿼리 시간 0.16-0.22ms
- **검색 성능**: 0.78-4.24ms (캐시 효과로 개선)
- **메모리 사용량**: 11-15MB 힙 사용량
- **동시 연결**: 최대 1000개 연결 지원

### 고급 성능 최적화
- **캐시 히트율**: 80% 이상 (검색 결과 캐싱)
- **임베딩 캐싱**: 24시간 TTL로 비용 절약
- **비동기 처리**: 워커 풀 기반 병렬 처리
- **데이터베이스 최적화**: 자동 인덱스 추천 및 생성
- **실시간 모니터링**: 30초마다 자동 성능 체크
- **에러 로깅**: 구조화된 에러 추적 및 통계
- **성능 알림**: 임계값 기반 자동 알림 시스템

### 임베딩 제공자 성능

#### 무료 제공자 (로컬 처리)
- **TF-IDF**: 512차원, 극도로 빠른 속도 (0.82ms), 낮은 메모리 사용량 (4.48MB)
- **MiniLM**: 384차원, 균형잡힌 성능, 다국어 지원

#### 유료 제공자 (클라우드 API)
- **OpenAI**: 1536차원, 최고 성능, 높은 정확도
- **Gemini**: 768차원, 고성능, 다국어 지원

**자동 선택 및 적용 순서**:
1. **명시적 요청**: API 호출 시 특정 제공자를 지정하면 해당 제공자를 우선 사용
2. **설정 기본값**: `.env`의 `EMBEDDING_PROVIDER` 설정값 사용
3. **우선순위 자동 선택**: 사용 가능한 제공자를 다음 순서로 자동 선택
   - 1순위: **OpenAI** (유료, 최고 성능)
   - 2순위: **Gemini** (유료, 고성능)
   - 3순위: **MiniLM** (무료, 균형잡힌 성능)
   - 4순위: **TF-IDF** (무료, 빠른 속도)

**폴백 메커니즘**: 상위 제공자 실패 시 자동으로 다음 우선순위 제공자로 전환됩니다.

## 🏗️ 아키텍처

### M1: 개인용 (현재 구현)
- **스토리지**: better-sqlite3 임베디드
- **인덱스**: FTS5 + sqlite-vec
- **인증**: 없음 (로컬 전용)
- **운영**: 로컬 실행
- **MCP 클라이언트**: 핵심 14개 도구 노출
- **관리 기능**: HTTP API로 분리
- **추가 기능**: 
  - 다중 임베딩 제공자(TF-IDF, MiniLM, OpenAI, Gemini)
  - 성능 모니터링 및 알림 시스템
  - 캐시 시스템
  - 앵커 시스템 (컨텍스트 관리)
  - 관계 그래프 (의미적 관계 추출)
  - 메타 메모리 통계
  - 통합 점수 시스템 (Consolidation Score)

### M2: 팀 협업 (계획)
- **스토리지**: SQLite 서버 모드
- **인증**: API Key
- **운영**: Docker 단일 컨테이너

### M3: 조직 초입 (계획)
- **스토리지**: PostgreSQL + pgvector
- **인증**: JWT
- **운영**: Docker Compose

## ❓ 자주 묻는 질문 (FAQ)

### Q: Memento는 어떤 AI Agent와 호환되나요?
A: MCP(Model Context Protocol)를 지원하는 모든 AI Agent와 호환됩니다. Claude, GPT-4, Gemini 등과 연동 가능합니다.

### Q: 기억 데이터는 어디에 저장되나요?
A: 기본적으로 로컬 SQLite 데이터베이스(`./data/memory.db`)에 저장됩니다. Docker를 사용하는 경우 컨테이너 내부에 저장됩니다.

### Q: OpenAI API 키가 필요한가요?
A: 선택사항입니다. OpenAI API 키가 없어도 **TF-IDF** 또는 **MiniLM** 기반 임베딩으로 동작합니다. 

**제공자별 특징**:
- **OpenAI** (1순위): 최고 성능, 1536차원, 유료, 클라우드 API
- **Gemini** (2순위): 고성능, 768차원, 유료, 클라우드 API
- **MiniLM** (3순위): 균형잡힌 성능, 384차원, 완전 무료, 로컬 처리
- **TF-IDF** (4순위): 빠른 속도, 512차원, 완전 무료, 로컬 처리

**적용 순서**: API 키가 설정되어 있으면 우선순위에 따라 자동 선택되며, 상위 제공자 실패 시 자동으로 다음 제공자로 전환됩니다.

더 정확한 검색을 원한다면 OpenAI 또는 Gemini API 키를 설정하세요.

### Q: 기억 용량에 제한이 있나요?
A: SQLite 데이터베이스의 제한에 따라 달라집니다. 일반적으로 수백만 개의 기억을 저장할 수 있습니다.

### Q: 다른 사용자와 기억을 공유할 수 있나요?
A: 현재 M1 버전은 개인용입니다. M2 버전부터 팀 협업 기능이 추가될 예정입니다.

### Q: 기억이 자동으로 삭제되나요?
A: 네, 망각 정책에 따라 자동으로 삭제됩니다. 중요한 기억은 `pin` 기능으로 고정할 수 있습니다.

## 🤝 기여하기

Memento 프로젝트에 기여하고 싶으신가요? 자세한 가이드는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

### 빠른 기여 시작
1. **Fork** the Project
2. **Create** your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. **Push** to the Branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### 개발 환경 설정
```bash
# 저장소 포크 후 클론
git clone https://github.com/your-username/memento.git
cd memento

# 의존성 설치
npm install

# 개발 서버 시작
npm run dev

# 테스트 실행
npm run test
```

### 기여 방법
- 🐛 **버그 리포트**: [GitHub Issues](https://github.com/jee1/memento/issues)에서 버그를 신고하세요
- 💡 **기능 제안**: 새로운 아이디어를 제안해주세요
- 📝 **문서 개선**: 문서를 더 명확하게 만들어주세요
- 🔧 **코드 기여**: 새로운 기능이나 버그 수정을 도와주세요

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

## 📞 지원

- 이슈 리포트: [GitHub Issues](https://github.com/jee1/memento/issues)
- 문서: [Wiki](https://github.com/jee1/memento/wiki)
- 개발자 가이드: [docs/guides/ko/developer-guide.md](docs/guides/ko/developer-guide.md)
- API 참조: [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)

## 🙏 감사의 말

- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 프로토콜
- [OpenAI](https://openai.com/) - 임베딩 서비스
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - 고성능 SQLite 드라이버
- [Express](https://expressjs.com/) - 웹 프레임워크
- [Vitest](https://vitest.dev/) - 테스트 프레임워크
- [TypeScript](https://www.typescriptlang.org/) - 개발 언어
