# 🧠 Memento MCP Server

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">
  
  <h3>✨ AI Agent의 기억을 영원히 기억하세요 ✨</h3>
  
  <p><strong>사람의 기억 구조를 모사한 지능형 메모리 관리 시스템</strong></p>
  
  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)
</div>

> **🚀 혁신적인 AI Agent 기억 보조 시스템**  
> Memento는 AI Agent가 사람처럼 기억을 저장, 검색, 관리할 수 있도록 도와주는 MCP(Model Context Protocol) 서버입니다.  
> 작업기억, 일화기억, 의미기억, 절차기억을 모사하여 **진정한 장기 기억**을 구현합니다.

## 🎯 프로젝트 개요

Memento MCP Server는 AI Agent가 장기 기억을 저장하고 관리할 수 있도록 도와주는 MCP(Model Context Protocol) 서버입니다. 사람의 기억 구조(작업기억, 일화기억, 의미기억, 절차기억)를 모사하여 효율적인 기억 관리 시스템을 제공합니다.

## ✨ 주요 기능

### 🧠 핵심 메모리 관리 (MCP 클라이언트)
- **기억 저장**: 4가지 타입의 기억 저장 (working, episodic, semantic, procedural)
- **기억 검색**: 하이브리드 검색 (텍스트 + 벡터)
- **이웃 기억 탐색**: 벡터 유사도 기반 유사한 기억 자동 추천
- **기억 고정**: 중요한 기억 고정/해제
- **기억 삭제**: 소프트/하드 삭제

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
- **실시간 메트릭**: 데이터베이스, 검색, 메모리 성능 모니터링
- **실시간 알림**: 30초마다 자동 성능 체크 및 임계값 기반 알림
- **에러 로깅**: 구조화된 에러 로깅 및 통계 수집
- **데이터베이스 최적화**: 자동 인덱스 추천 및 생성
- **캐시 시스템**: LRU + TTL 기반 캐싱
- **비동기 처리**: 워커 풀 기반 병렬 처리

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

### 🥉 **Docker 방식 (프로덕션용)**
```bash
# 개발 환경
docker-compose -f docker-compose.dev.yml up -d

# 프로덕션 환경
docker-compose -f docker-compose.prod.yml up -d
```

### 🛠️ **소스코드 방식 (개발자용)**
```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

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
npm run start:http      # 또는 node dist/server/http-server.js
```

이 방식으로 `src/server/http-server.ts` 기반 MCP 서비스를 띄워 두면, 모든 에이전트는 HTTP/WebSocket 인터페이스를 통해 이 서버에만 접속하게 되고 실제 SQLite writer는 단일 프로세스로 제한됩니다. npx로도 동일하게 실행할 수 있으니, 다중 에이전트 환경에서는 이 구조를 반드시 적용해 주세요.

#### MCP 클라이언트 설정 예시 (`mcp.json`)

```json
{
  "clients": {
    "memento": {
      "command": "node",
      "args": [
        "/path/to/memento/dist/server/http-server.js"
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
- [Cursor MCP 설정 가이드](docs/cursor-mcp-setup.ko.md) - Cursor에서 MCP 서버 사용하기
- [npx 사용자 문제 해결](docs/npx-troubleshooting.md) - npx 실행 시 문제 해결

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
    query: "React Hook 사용법",
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
  args: ["dist/server/index.js"]
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
    query: "React Hook",
    filters: {
      type: ["episodic", "semantic"],
      tags: ["react"]
    },
    limit: 10
  }
});
```

## 📚 문서

- [임베딩 서비스 가이드](docs/ko/embedding-service-guide.md) - 임베딩 서비스 사용법
- [성능 벤치마크](docs/ko/embedding-performance-benchmark.md) - 성능 비교 결과
- [API 레퍼런스](docs/ko/embedding-api-reference.md) - API 상세 문서
- [설정 가이드](docs/ko/embedding-configuration.md) - 환경 설정 방법
- [Consolidation Score 테스트 가이드](docs/testing/consolidation-quality-testing.md) - Consolidation Score 검색 품질 테스트 가이드

## 📋 API 문서

### MCP Tools (핵심 5개만)

> **중요**: MCP 클라이언트는 핵심 메모리 관리 기능 5개만 노출합니다.  
> 관리 기능들은 HTTP API 엔드포인트로 분리되었습니다.

| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember` | 기억 저장 | content, type, tags, importance, source, privacy_scope |
| `recall` | 기억 검색 | query, filters, limit |
| `pin` | 기억 고정 | memory_id |
| `unpin` | 기억 고정 해제 | memory_id |
| `forget` | 기억 삭제 | memory_id, hard |

### HTTP 관리 API

| 엔드포인트 | 설명 | 메서드 |
|-----------|------|--------|
| `/admin/memory/cleanup` | 메모리 정리 | POST |
| `/admin/stats/forgetting` | 망각 통계 조회 | GET |
| `/admin/stats/performance` | 성능 통계 조회 | GET |
| `/admin/stats/errors` | 에러 통계 조회 | GET |
| `/admin/errors/resolve` | 에러 해결 | POST |
| `/admin/alerts/performance` | 성능 알림 조회 | GET |
| `/admin/database/optimize` | 데이터베이스 최적화 | POST |

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
| `PORT` | 9001 | 서버 포트 |
| `DB_PATH` | ./data/memory.db | 데이터베이스 경로 |
| `LOG_LEVEL` | info | 로그 레벨 |
| `OPENAI_API_KEY` | - | OpenAI API 키 (선택사항) |
| `CONSOLIDATION_SCORE_ENABLED` | false | Consolidation Score System 활성화 여부 |
| `CONSOLIDATION_TEST_SEED_PATH` | ./data/consolidation-seed.json | 테스트 Seed 데이터 파일 경로 |
| `CONSOLIDATION_BASELINE_PATH` | ./data/consolidation-baseline.json | Baseline 스냅샷 저장 경로 |
| `CONSOLIDATION_TEST_ITEM_COUNT` | 100 | 벤치마크 테스트 데이터 크기 |

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
npm run test:forgetting                # 망각 정책 테스트
npm run test:performance               # 성능 벤치마크
npm run test:monitoring                # 성능 모니터링 테스트
npm run test:error-logging             # 에러 로깅 테스트
npm run test:performance-alerts        # 성능 알림 테스트
npm run test:consolidation-quality     # Consolidation Score 품질 검증 테스트
npm run benchmark:consolidation-quality # Consolidation Score 벤치마크 테스트

# 테스트 감시 모드
npm run test -- --watch

# 커버리지 포함 테스트
npm run test -- --coverage
```

## 📚 개발자 가이드라인

### 저장소 가이드라인 (`AGENTS.md`)
- **프로젝트 구조**: `src/` 하위 모듈별 조직화
- **빌드/테스트 명령어**: `npm run dev`, `npm run build`, `npm run test` 등
- **코딩 스타일**: Node.js ≥ 20, TypeScript ES 모듈, 2칸 들여쓰기
- **테스트 가이드라인**: Vitest 기반, `src/test/` 또는 `*.spec.ts` 파일
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

### 경량 임베딩 성능
- **TF-IDF 벡터화**: 512차원 고정 벡터 생성
- **다국어 지원**: 한국어/영어 불용어 제거
- **로컬 처리**: OpenAI API 없이 동작
- **코사인 유사도**: 빠른 벡터 검색

## 🏗️ 아키텍처

### M1: 개인용 (현재 구현)
- **스토리지**: better-sqlite3 임베디드
- **인덱스**: FTS5 + sqlite-vss
- **인증**: 없음 (로컬 전용)
- **운영**: 로컬 실행
- **MCP 클라이언트**: 핵심 5개 도구만 노출
- **관리 기능**: HTTP API로 분리
- **추가 기능**: 경량 임베딩, 성능 모니터링, 캐시 시스템

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
A: 선택사항입니다. OpenAI API 키가 없어도 TF-IDF 기반 경량 임베딩으로 동작합니다. 더 정확한 검색을 원한다면 OpenAI API 키를 설정하세요.

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
- 개발자 가이드: [docs/developer-guide.md](docs/developer-guide.md)
- API 참조: [docs/api-reference.md](docs/api-reference.md)

## 🙏 감사의 말

- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 프로토콜
- [OpenAI](https://openai.com/) - 임베딩 서비스
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - 고성능 SQLite 드라이버
- [Express](https://expressjs.com/) - 웹 프레임워크
- [Vitest](https://vitest.dev/) - 테스트 프레임워크
- [TypeScript](https://www.typescriptlang.org/) - 개발 언어
