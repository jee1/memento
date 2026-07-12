# 🧠 Memento

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">

  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)
</div>

---

LLM은 대화가 끝나면 모든 것을 잊는다. 이름도, 결정도, 지난 주에 함께 디버깅했던 맥락도. 이건 기술적 한계가 아니라 **기억 인프라의 부재**다.

Memento는 그 인프라다. 기억을 저장하는 데이터베이스가 아니라, 기억이 생성·분류·강화·망각되는 **MCP 기반 기억 운영 체제**.

## 기억은 단순하지 않다

심리학과 신경과학이 수십 년에 걸쳐 밝혀낸 것이 있다. 인간의 기억은 한 종류가 아니다.

**작업기억(Working Memory)** 은 지금 이 순간 처리 중인 정보다. 몇 초 안에 사라지지만, 그 순간만큼은 모든 판단의 기반이 된다. **일화기억(Episodic Memory)** 은 경험의 흔적이다. "그날 오후 React Hook을 처음 배웠을 때"처럼 시간과 맥락이 붙어 있는 기억. **의미기억(Semantic Memory)** 은 경험에서 증류된 지식이다. 수백 번의 디버깅을 거쳐 쌓인 "TypeScript 제네릭은 이렇게 동작한다"는 이해. 그리고 **절차기억(Procedural Memory)** 은 손에 밴 절차다. Docker 배포 순서, PR 체크리스트, 팀의 코딩 컨벤션.

현재 대부분의 LLM은 이 네 가지를 매 대화마다 잃는다. Memento는 이 네 가지를 모두 영속화한다 — `remember` 호출 시 `type` 파라미터로 `working`, `episodic`, `semantic`, `procedural` 중 하나를 지정하면 된다.

## 살아있는 기억

단순한 저장소가 아니다. Memento의 기억은 살아있다.

중요하게 쓰인 기억은 강화된다. 오래되고 쓸모없어진 기억은 망각 알고리즘에 의해 정리된다. 비슷한 기억들은 벡터 유사도로 서로 연결되어 그래프를 형성한다. 반복 사용하는 절차는 버전 관리되어 `procedural_diff`와 `procedural_rollback`으로 진화를 추적한다. 핵심 맥락은 앵커(Anchor)로 고정되어 새 대화에서도 즉시 복원된다.

AI가 "기억하는 척"하는 것이 아니라, 기억을 생성·분류·강화·망각하는 주체로 행동하게 만드는 것 — 그것이 Memento의 목표다.

### 📦 모노레포 구조

이 저장소는 **npm workspaces** 모노레포입니다. `@memento/core`가 도메인·DB·MCP 도구를 담고, `memento-server`가 stdio/HTTP로 이를 노출합니다. 앱이나 스크립트에서 REST로 붙을 때는 `@memento/client`, OpenClaw 같은 외부 비서에는 `@memento/assistant`, 에이전트 세션·프로버넌스 계약에는 `@memento/agent-integration`을 씁니다. 실험 코드는 `apps/` 아래에 두었습니다.

| 경로 | 설명 |
|------|------|
| **packages/memento-core** (`@memento/core`) | 도메인·인프라·공유 라이브러리. 진입점: `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase`. DB 초기화·마이그레이션은 루트에서 `npm run db:init` / `npm run db:migrate`로 실행. |
| **packages/memento-server** | core를 사용하는 MCP/HTTP 서버. 루트 `npm run dev`, `npm start`, `npm run dev:http` 등으로 실행. |
| **packages/memento-client** (`@memento/client`) | 서버 연결용 클라이언트 라이브러리. |
| **packages/memento-assistant** (`@memento/assistant`) | 외부 AI 비서용 recall/remember SDK. |
| **packages/memento-agent-integration** (`@memento/agent-integration`) | 에이전트 통합 계약·어댑터. |
| **apps/** | 실험용 앱 (예: `experimental-example`은 `@memento/core`를 in-process로 사용). |

상세 구조·빌드·테스트 명령은 [AGENTS.md](AGENTS.md)를 참조하세요.

## 🚀 빠른 시작

> **📦 패키지 매니저**: 이 프로젝트는 **npm**을 사용합니다. `pnpm`이나 `yarn`은 지원하지 않습니다.

### 원클릭 설치 (권장)
```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

### npx 방식 (개발자용)

#### Windows (PowerShell/CMD)
```powershell
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest
npx memento-mcp-server@latest setup
```

#### Linux/macOS
```bash
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest
npx memento-mcp-server@latest setup
```

> **참고**: `npm exec` 사용 시 명령어를 명시적으로 지정해야 합니다:
> ```bash
> npm exec -- memento-mcp-server@latest dev
> ```

**반복 사용 시 주의**: 매번 npx로 실행하면 다운로드가 발생할 수 있으므로 반복 사용에는 **글로벌 설치**(`npm i -g memento-mcp-server`) 또는 로컬 설치 후 `./node_modules/.bin/memento` 사용을 권장합니다. 모드 구분: MCP 서버(`memento-mcp-server` / stdio), HTTP 서버(`memento-dev`), CLI(`memento` — recall, remember, forget, memory_injection). CLI 가이드: [docs/guides/ko/memento-cli-for-ai.md](docs/guides/ko/memento-cli-for-ai.md).

### Docker 방식 (프로덕션용)
```bash
docker-compose -f docker-compose.dev.yml up -d   # 개발
docker-compose -f docker-compose.prod.yml up -d  # 프로덕션
```

**Log Issue Monitor**: 운영 로그와 Docker diagnostics를 주기적으로 검사해 반복 오류를 GitHub Issue로 묶어 관리하려면 `docker-compose.issue-monitor.yml` 오버레이를 사용합니다. 자세한 절차: [Log Issue Monitor 운영 가이드](docs/operations/ko/log-issue-monitor.md).

### 소스코드 방식 (개발자용)

```bash
git clone https://github.com/jee1/memento.git
cd memento
npm install
npm run build
npm run db:init
npm run db:migrate
npm run quick-start
```

### 다중 에이전트 운영을 위한 HTTP MCP 서버

SQLite는 WAL 모드를 사용해도 동시에 하나의 writer만 허용합니다. 여러 AI Agent가 각각 프로세스로 `remember`/`forget`을 호출하면 `SQLITE_BUSY`가 발생할 수 있으므로, **반드시 MCP 서버 프로세스를 하나만 띄워 DB를 전담**하도록 구성하는 것을 권장합니다.

```bash
npm run dev:http                          # 개발 모드 (Hot Reload)
npm run build && npm run start:http       # 프로덕션
```

이 방식으로 `packages/memento-server`의 HTTP MCP 서비스를 띄워 두면, 모든 에이전트는 HTTP/WebSocket 인터페이스를 통해 이 서버에만 접속하고 SQLite writer는 단일 프로세스로 제한됩니다.

#### MCP 클라이언트 설정 예시 (`mcp.json`)

루트에서 `npm run build` 후 서버 실행 파일은 `packages/memento-server/dist/server/http-server.js`에 있습니다.

```json
{
  "clients": {
    "memento": {
      "command": "node",
      "args": ["/path/to/memento/packages/memento-server/dist/server/http-server.js"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db",
        "MCP_SERVER_PORT": "9001"
      },
      "transport": {
        "type": "http",
        "url": "http://127.0.0.1:9001/mcp"
      }
    }
  }
}
```

### 상세 설치 가이드
- [INSTALL.md](INSTALL.md) — 전체 설치 가이드
- [Cursor MCP 설정 가이드](docs/guides/ko/cursor-mcp-setup.md)
- [npx 사용자 문제 해결](docs/operations/ko/npx-troubleshooting.md)

## 🔗 외부 AI 비서와 함께 쓰기

OpenClaw / NanoClaw / ZeroClaw 같은 개인 AI 비서가 Memento를 공유 장기 기억 백엔드로 사용할 수 있습니다. 가이드: [docs/integrations/](./docs/integrations/README.md)

`@memento/assistant` SDK를 사용하면 자동 recall/remember를 코드 두 줄로 붙일 수 있습니다 — [SDK quickstart](./docs/integrations/_shared/sdk-quickstart.md)

## 💡 사용 예시

### AI Agent와의 연동
```typescript
// 일화기억으로 학습 내용 저장
await client.callTool({
  name: "remember",
  arguments: {
    content: "사용자는 React Hook을 학습했습니다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리합니다.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});

// 나중에 관련 기억 검색
const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "React Hook은 어떻게 사용하나요?",
    limit: 5
  }
});
```

### 의미기억으로 지식 관리
```typescript
// 경험에서 증류된 지식을 의미기억으로 저장
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

### 절차기억으로 워크플로 보존
```typescript
// 반복 작업 절차를 절차기억으로 저장 (버전 관리됨)
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

세 가지 접근 방식으로 Memento에 연결할 수 있습니다.

- **mcp.json 설정**: Claude Desktop, Cursor, Claude Code 등 MCP 호스트에 Memento를 등록하는 방식 (코드 불필요)
- **MCP 프로토콜** (`@modelcontextprotocol/sdk`): 커스텀 에이전트 코드에서 MCP 프로토콜로 직접 연결하는 방식
- **HTTP API 클라이언트** (`@memento/client`): TypeScript/JavaScript 코드에서 Memento 서버의 REST API를 프로그래밍 방식으로 사용하는 방식

### 0. mcp.json 설정 (Claude Desktop · Cursor · Claude Code)

MCP 호스트 앱에서 Memento를 사용하려면 설정 파일에 서버 정보를 등록합니다.

#### stdio 모드 (단일 에이전트 / 소스 실행)

`npm run build` 후 아래처럼 등록합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/path/to/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

> **파일 위치**:
> - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
> - Cursor: `.cursor/mcp.json` (프로젝트) 또는 `~/.cursor/mcp.json` (전역)
> - Claude Code: `.claude/mcp.json` (프로젝트) 또는 `~/.claude/mcp.json` (전역)

#### HTTP MCP 모드 (다중 에이전트 공유 서버)

```bash
npm run build && npm run start:http   # 기본 포트: 9001 (env.example·Docker와 동일)
```

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://127.0.0.1:9001/mcp"
    }
  }
}
```

> **npx로 실행하는 경우** (소스 빌드 없이):
> ```json
> {
>   "mcpServers": {
>     "memento": {
>       "command": "npx",
>       "args": ["memento-mcp-server@latest"],
>       "env": {
>         "DB_PATH": "/absolute/path/to/data/memory.db"
>       }
>     }
>   }
> }
> ```

### 1. MCP 프로토콜 연결 (`@modelcontextprotocol/sdk`)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({
  name: "my-agent",
  version: "0.1.0"
}, {
  capabilities: { tools: {}, resources: {}, prompts: {} }
});

// stdio 연결 (단일 프로세스)
await client.connect({
  command: "node",
  args: ["packages/memento-server/dist/server/index.js"]
});

// HTTP MCP 연결 (다중 에이전트 공유 서버)
await client.connect({
  transport: {
    type: "http",
    url: "http://127.0.0.1:9001/mcp"
  }
});
```

```typescript
const result = await client.callTool({
  name: "remember",
  arguments: {
    content: "React Hook에 대해 학습했습니다.",
    type: "episodic",
    tags: ["react", "hooks"],
    importance: 0.8
  }
});

const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "React Hook을 처음 배울 때 알아야 할 것들은?",
    filters: { type: ["episodic", "semantic"], tags: ["react"] },
    limit: 10
  }
});
```

### 2. HTTP API 클라이언트 (`@memento/client`)

`@memento/client`는 MCP 프로토콜이 아닌 **HTTP REST API 래퍼**입니다. TypeScript/JavaScript 애플리케이션에서 `/tools/*` 엔드포인트를 직접 호출할 때 사용합니다.

```typescript
import { MementoClient } from "@memento/client";

const client = new MementoClient({
  serverUrl: "http://localhost:9001",
  apiKey: "your-api-key"
});

await client.connect();

const result = await client.remember({
  content: "React Hook에 대해 학습했습니다.",
  type: "episodic",
  tags: ["react", "hooks"],
  importance: 0.8
});

const results = await client.recall(
  "React Hook을 처음 배울 때 알아야 할 것들은?",
  { type: ["episodic", "semantic"], tags: ["react"] },
  10
);

await client.pin(result.memory_id);
await client.forget(result.memory_id);
```

## 🧠 기능

### 🧠 핵심 메모리 관리 (MCP 클라이언트)

- **기억 저장**: `working`, `episodic`, `semantic`, `procedural` 4가지 타입
- **기억 검색**: 하이브리드 검색 (텍스트 FTS5 + 벡터)
- **이웃 기억 탐색**: 벡터 유사도 기반 자동 추천
- **기억 고정**: 중요 기억 pin/unpin
- **기억 삭제**: 소프트/하드 삭제
- **앵커 시스템**: 핵심 기억을 앵커로 고정해 다음 대화에서 즉시 컨텍스트 복원
> **참고**: 앵커 복원, 임베딩 마이그레이션, Episodic → Semantic 변환, 메타 메모리 통계는 MCP 도구가 아니라 HTTP 관리 API로만 제공됩니다.

### 🔍 하이브리드 검색

텍스트와 의미(벡터)를 함께 검색한다. 키워드가 정확히 기억나지 않아도, 개념이 비슷하면 찾아낸다.

- **FTS5 텍스트 검색**: SQLite Full-Text Search
- **벡터 검색**: sqlite-vec 기반 의미적 유사도 검색
- **하이브리드 검색**: 두 검색의 결합 (Consolidation Score로 가중치 조정)
- **다중 임베딩 제공자**: TF-IDF, MiniLM, OpenAI, Gemini 지원
- **자동 제공자 선택**: 설정 기반 최적 제공자 자동 선택, 실패 시 자동 폴백
- **태그 기반 필터링**: 메타데이터 기반 검색

### 🧹 망각 정책

기억 시스템이 진짜 유용하려면, 망각도 설계해야 한다. 쌓이기만 하는 기억은 잡음이 된다.

- **망각 알고리즘**: 최근성·사용성·중복 비율 기반 망각 점수 계산
- **간격 반복**: 중요도와 사용성 기반 리뷰 스케줄링
- **TTL 관리**: 타입별 수명 관리 (working 48시간, episodic 90일, semantic·procedural 무기한)
- **자동 정리**: 소프트/하드 삭제 자동화

### 📊 성능 모니터링 (HTTP 관리 API)

> **보안**: HTTP 서버는 브라우저 세션과 헤더 기반 신뢰 경계를 분리합니다. `/auth/session`은 쿠키 기반 브라우저 세션을 시작하고, `/admin`과 `/api`는 브라우저 세션이 필요하며, `/api/v1/quality`, `/api/v1/maintenance`, `/tools`, `/mcp`는 `Authorization: Bearer` 또는 `X-API-Key`가 필요합니다. 자세한 내용: [docs/reference/ko/security.md](docs/reference/ko/security.md)

- **실시간 메트릭**: 데이터베이스, 검색, 메모리 성능 모니터링
- **실시간 알림**: 30초마다 자동 성능 체크 및 임계값 기반 알림
- **에러 로깅**: 구조화된 에러 로깅 및 통계 수집
- **데이터베이스 최적화**: 자동 인덱스 추천 및 생성
- **캐시 시스템**: LRU + TTL 기반 캐싱
- **비동기 처리**: 워커 풀 기반 병렬 처리

### 🔗 메모리 그래프 뷰 (브라우저)

HTTP 서버 실행 후 브라우저에서 기억들의 의미적 관계를 그래프로 시각화할 수 있습니다. 전체 관리 흐름은 `/dashboard`에서 여는 편이 가장 안전하며, `/graph`를 직접 열어도 동일한 `/auth/session` 기반 재인증 패널로 세션을 시작하거나 복구할 수 있습니다.

```
http://localhost:9001/dashboard
http://localhost:9001/graph
```

![Memento Memory Graph View](docs/graph-screenshot.png)

## 📚 문서

전체 문서 목록·KO/EN 매핑: [docs/README.md](docs/README.md)

- [임베딩 서비스 가이드](docs/guides/ko/embedding-service-guide.md)
- [성능 벤치마크](docs/reference/ko/embedding-performance-benchmark.md)
- [API 레퍼런스](docs/api/ko/api-reference.md)
- [설정 가이드](docs/guides/ko/embedding-configuration.md)
- [Consolidation Score 테스트 가이드](docs/_work/testing/ko/consolidation-quality-testing.md)

## 📋 API 문서

### MCP Tools (핵심 22개)

> **중요**: MCP 클라이언트는 핵심 메모리·관계·텔레메트리 도구 22개를 노출합니다. 관리/운영성 기능(앵커 복원, 임베딩 마이그레이션, Episodic→Semantic 변환, 메타 메모리 통계)은 HTTP API로만 제공됩니다.

#### 기본 메모리 관리 (8개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember` | 기억 저장 | content, type, tags, importance, source, privacy_scope |
| `recall` | 기억 검색 | query, filters, limit |
| `feedback` | recall 결과 helpful/not_helpful 피드백 | memory_id, helpful |
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

#### 절차 기억 (3개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember_procedure` | 절차 기억 저장 | content, workflow_name, skill_name, steps 등 |
| `procedural_diff` | 절차 기억 버전 간 차이 비교 | left_id, right_id |
| `procedural_rollback` | 절차 기억 이전 버전으로 복원 | current_id, target_version_id |

#### 관계·지식 그래프 (4개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `extract_triples` | 본문에서 SPO 트리플 추출 | content 또는 messages |
| `add_relation` | 기억 간 관계 추가 | source_id, target_id, relation_type |
| `get_relations` | 관계 조회 | memory_id 등 |
| `remove_relation` | 관계 삭제 | relation_id |

#### 품질·내보내기 (3개)
| Tool | 설명 | 파라미터 |
|------|------|----------|
| `get_introspection_summary` | 저신뢰·고실패 기억 요약 | — |
| `get_telemetry_summary` | 검색·메모리 품질 텔레메트리 | period |
| `export_memories` | 기억 내보내기 | filters 등 |

**HTTP 전용 (MCP에 없음)**: `restore_anchors`, `migrate_embeddings`, `convert_episodic_to_semantic`, `get_meta_memory_stats` — 아래 HTTP 관리 API 참조.

### HTTP 관리 API

> **중요**: 다음 기능들은 MCP 클라이언트에 노출되지 않으며, HTTP API로만 제공됩니다.

#### 메모리 관리
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/memory/cleanup` | 메모리 정리 | POST |
| `/admin/memory/convert-episodic-to-semantic` | Episodic → Semantic 변환 | POST |
| `/admin/memory/meta-stats` | 메타 메모리 통계 조회 | GET |
| `/admin/memory/review-candidates` | 기억 리뷰 후보 목록 | GET |
| `/admin/memory/items/:memory_id` | 단일 기억 프리뷰(JSON, 대시보드 등) | GET |
| `/admin/memory/review-candidates/:id/review` | 기억 리뷰 후보 처리 | POST |
| `/admin/memory/review-candidates/:id/dismiss` | 기억 리뷰 후보 기각 | POST |
| `/admin/stats/forgetting` | 망각 통계 조회 | GET |

#### 개인 지식 Agent
| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/api/v1/agent/personal:run` | 한 턴 실행, 지식 후보 반환(저장 없음) | POST |
| `/api/v1/agent/personal:persist-approved` | 승인된 후보만 `remember`로 저장 | POST |

사용 절차: [개인 지식 에이전트 HTTP 서버 런타임 사용법](docs/guides/ko/personal-knowledge-agent-mvp.md#http-서버-런타임-사용법)

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

**기타 HTTP admin**: 배치 상태/실행(`/admin/batch/*`, `jobType`에 `memory_review_candidates` 포함), 성능 메트릭·알림(`/admin/performance/*`), 관계 추출·조회·시각화(`/admin/relations/*`) 등은 [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)를 참고하세요.

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
| `PORT` / `MCP_SERVER_PORT` | 9001 (http-server fallback) | HTTP/MCP 서버 포트 (`env.example`·Docker 권장: 9001) |
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
| `ENABLE_PII_MASKING` | true | PII 마스킹 활성화 ([docs/reference/ko/security.md](docs/reference/ko/security.md) 참고) |
| `MEMORY_REVIEW_IMPORTANCE_THRESHOLD` | `0.7` | 기억 리뷰 후보 최소 importance (0~1) |
| `MEMORY_REVIEW_STALE_DAYS` | `14` | 기억 리뷰 후보 최소 stale 일수 (정수 ≥ 1) |
| `MEMORY_REVIEW_MAX_CANDIDATES` | `50` | 기억 리뷰 후보 최대 개수 (정수 ≥ 1) |
| `MEMORY_REVIEW_MAX_BACKLOG` | `500` | pending 후보가 이 수 이상이면 신규 선정을 건너뜀 (`0`: 비활성화) |
| `MEMORY_REVIEW_CANDIDATE_TTL_DAYS` | `30` | 이 일수보다 오래된 pending 후보를 배치 실행 전에 만료 (`0`: 비활성화) |
| `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS` | `86400000` | 배치 스케줄 간격(ms), 최소 `60000` |
| `MEMORY_REVIEW_CANDIDATE_DUE_DAYS` | `14` | 배치가 `due_at`에 더하는 일 수 (1~366) |

> **참고**: 망각 TTL, LLM/Ollama, 검색 한도 등 추가 변수는 `env.example`을 참고하세요.

### 망각 정책 설정

```bash
FORGET_THRESHOLD=0.6
SOFT_DELETE_THRESHOLD=0.6
HARD_DELETE_THRESHOLD=0.8

TTL_SOFT_WORKING=2
TTL_SOFT_EPISODIC=30
TTL_SOFT_SEMANTIC=180
TTL_SOFT_PROCEDURAL=90
```

## 🧪 테스트

```bash
npm run test

npm run test:client
npm run test:search
npm run test:embedding
npm run test:lightweight-embedding
npm run test:gemini-embedding
npm run test:forgetting
npm run test:performance
npm run test:monitoring
npm run test:error-logging
npm run test:performance-alerts
npm run test:consolidation-quality
npm run test:vector-search
npm run test:memory-injection
npm run test:batch-scheduler
npm run benchmark:consolidation-quality
npm run test:embedding-benchmark

npm run test -- --watch
npm run test -- --coverage
```

## 📚 개발자 가이드라인

- **프로젝트 구조**: npm workspaces 모노레포 — `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`. 상세: [AGENTS.md](AGENTS.md)
- **빌드/테스트**: `npm run build`(core→server→client), `npm run dev`·`npm start`(서버), `npm run db:init`·`npm run db:migrate`(DB), `npm test`
- **코딩 스타일**: Node.js ≥ 24, TypeScript ES 모듈, 2칸 들여쓰기
- **테스트**: Vitest 기반. 단위·스펙은 `packages/*/src/**/*.spec.ts`, 워크스페이스 수준 통합 스펙은 루트 `tests/`
- **커밋/PR**: Conventional Commits, 한국어 컨텍스트 포함

## 📊 성능 지표

### 기본 성능
- **데이터베이스**: 평균 쿼리 시간 0.16-0.22ms
- **검색**: 0.78-4.24ms (캐시 효과로 개선)
- **메모리 사용량**: 11-15MB 힙
- **동시 연결**: 최대 1000개

### 임베딩 제공자 비교

#### 무료 제공자 (로컬 처리)
- **TF-IDF**: 512차원, 극도로 빠름 (0.82ms), 낮은 메모리 (4.48MB)
- **MiniLM**: 384차원, 균형잡힌 성능, 다국어 지원

#### 유료 제공자 (클라우드 API)
- **OpenAI**: 1536차원, 최고 성능, 높은 정확도
- **Gemini**: 768차원, 고성능, 다국어 지원

**자동 선택 순서**: 명시적 요청 → `.env`의 `EMBEDDING_PROVIDER` → OpenAI(1) → Gemini(2) → MiniLM(3) → TF-IDF(4). 상위 제공자 실패 시 자동 폴백.

## 🏗️ 아키텍처 여정

Memento는 개인용 로컬 서버로 시작해, 팀 협업을 거쳐, 조직 규모의 메모리 플랫폼으로 성장하도록 설계되어 있다.

**M1: 개인용 (현재)** — 지금 사용할 수 있는 형태다. SQLite 임베디드, FTS5 + sqlite-vec 인덱스, 로컬 실행. **인증**: 브라우저 세션 + 헤더 기반 분리 신뢰 모델(`/auth/session` 쿠키 세션, `/admin`·`/api` 브라우저 세션 요구, `/tools`·`/mcp`는 Bearer/API-Key 요구). 22개 MCP 도구, 관리 기능은 HTTP API로 분리.

**M2: 팀 협업 (계획)** — SQLite 서버 모드, API Key 인증, Docker 단일 컨테이너. 여러 팀원이 하나의 기억 백엔드를 공유한다.

**M3: 조직 (계획)** — PostgreSQL + pgvector, JWT 인증, Docker Compose. 수백 명의 에이전트가 조직의 기억을 공유한다.

## ❓ 자주 묻는 질문

### Q: Memento는 어떤 AI Agent와 호환되나요?
A: MCP(Model Context Protocol)를 지원하는 모든 AI Agent와 호환됩니다. Claude, GPT-4, Gemini 등과 연동 가능합니다.

### Q: 기억 데이터는 어디에 저장되나요?
A: 기본적으로 로컬 SQLite 데이터베이스(`./data/memory.db`)에 저장됩니다.

### Q: OpenAI API 키가 필요한가요?
A: 선택사항입니다. API 키 없이도 **TF-IDF** 또는 **MiniLM** 기반 임베딩으로 동작합니다. 더 정확한 검색을 원한다면 OpenAI 또는 Gemini API 키를 설정하세요.

### Q: 기억 용량에 제한이 있나요?
A: SQLite 데이터베이스 제한에 따라 달라집니다. 일반적으로 수백만 개의 기억을 저장할 수 있습니다.

### Q: 다른 사용자와 기억을 공유할 수 있나요?
A: 현재 M1은 개인용입니다. M2부터 팀 협업 기능이 추가될 예정입니다.

### Q: 기억이 자동으로 삭제되나요?
A: 망각 정책에 따라 자동으로 삭제됩니다. 중요한 기억은 `pin` 기능으로 고정할 수 있습니다.

## 🤝 기여하기

Memento 프로젝트에 기여하고 싶으신가요? 자세한 가이드: [CONTRIBUTING.md](CONTRIBUTING.md)

### 빠른 기여 시작
1. **Fork** the Project
2. **Create** your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. **Push** to the Branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### 개발 환경 설정
```bash
git clone https://github.com/your-username/memento.git
cd memento
npm install
npm run dev
npm run test
```

### 기여 방법
- 버그 리포트: [GitHub Issues](https://github.com/jee1/memento/issues)
- 기능 제안: 새로운 아이디어를 제안해주세요
- 문서 개선: 문서를 더 명확하게 만들어주세요
- 코드 기여: 새로운 기능이나 버그 수정을 도와주세요

## 📄 라이선스

MIT 라이선스. 자세한 내용은 `LICENSE` 파일을 참조하세요.

## 📞 지원

- 이슈 리포트: [GitHub Issues](https://github.com/jee1/memento/issues)
- 문서: [Wiki](https://github.com/jee1/memento/wiki)
- 개발자 가이드: [docs/guides/ko/developer-guide.md](docs/guides/ko/developer-guide.md)
- API 참조: [docs/api/ko/api-reference.md](docs/api/ko/api-reference.md)

## 🙏 감사의 말

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenAI](https://openai.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Express](https://expressjs.com/)
- [Vitest](https://vitest.dev/)
- [TypeScript](https://www.typescriptlang.org/)
