# Memento MCP Server

AI Agent 기억 보조 MCP 서버 - 사람의 기억 구조를 모사한 스토리지+검색+요약+망각 메커니즘

## 🎯 프로젝트 개요

Memento MCP Server는 AI Agent가 장기 기억을 저장하고 관리할 수 있도록 도와주는 MCP(Model Context Protocol) 서버입니다. 사람의 기억 구조(작업기억, 일화기억, 의미기억, 절차기억)를 모사하여 효율적인 기억 관리 시스템을 제공합니다.

## ✨ 주요 기능

### 🧠 기억 관리
- **기억 저장**: 4가지 타입의 기억 저장 (working, episodic, semantic, procedural)
- **기억 검색**: 하이브리드 검색 (텍스트 + 벡터)
- **기억 고정**: 중요한 기억 고정/해제
- **기억 삭제**: 소프트/하드 삭제

### 🔍 고급 검색
- **FTS5 텍스트 검색**: SQLite의 Full-Text Search
- **벡터 검색**: OpenAI 임베딩 기반 의미적 검색
- **하이브리드 검색**: 텍스트와 벡터 검색의 결합
- **경량 임베딩**: TF-IDF + 키워드 매칭 기반 fallback 솔루션
- **태그 기반 필터링**: 메타데이터 기반 검색

### 🧹 망각 정책
- **망각 알고리즘**: 최근성, 사용성, 중복 비율 기반 망각 점수 계산
- **간격 반복**: 중요도와 사용성 기반 리뷰 스케줄링
- **TTL 관리**: 타입별 수명 관리
- **자동 정리**: 소프트/하드 삭제 자동화

### 📊 성능 모니터링
- **실시간 메트릭**: 데이터베이스, 검색, 메모리 성능 모니터링
- **실시간 알림**: 30초마다 자동 성능 체크 및 임계값 기반 알림
- **에러 로깅**: 구조화된 에러 로깅 및 통계 수집
- **데이터베이스 최적화**: 자동 인덱스 추천 및 생성
- **캐시 시스템**: LRU + TTL 기반 캐싱
- **비동기 처리**: 워커 풀 기반 병렬 처리

## 🚀 빠른 시작

### 1. 설치

```bash
# 저장소 클론
git clone https://github.com/jee1/memento.git
cd memento

# 의존성 설치
npm install

# 환경 변수 설정
cp env.example .env
# .env 파일에서 OPENAI_API_KEY 설정 (선택사항)
# OPENAI_API_KEY가 없어도 경량 임베딩 서비스로 동작
```

### 2. 개발 서버 실행

```bash
# MCP 서버 개발 모드 (핫 리로드)
npm run dev

# HTTP/WebSocket 서버 개발 모드
npm run dev:http
```

### 3. 프로덕션 빌드

```bash
# TypeScript 컴파일 및 에셋 복사
npm run build

# MCP 서버 프로덕션 실행
npm run start

# HTTP/WebSocket 서버 프로덕션 실행
npm run start:http
```

### 4. Docker 배포

```bash
# Docker 이미지 빌드
docker build -t memento-mcp-server .

# MCP 서버 Docker 실행
docker run -p 8080:8080 -v $(pwd)/data:/app/data memento-mcp-server

# HTTP/WebSocket 서버 Docker 실행
docker run -p 8080:8080 -v $(pwd)/data:/app/data memento-mcp-server npm run start:http

# Docker Compose 실행
docker-compose up -d
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
    url: "ws://localhost:8080/mcp"
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

## 📋 API 문서

### Tools

| Tool | 설명 | 파라미터 |
|------|------|----------|
| `remember` | 기억 저장 | content, type, tags, importance, source, privacy_scope |
| `recall` | 기억 검색 | query, filters, limit |
| `pin` | 기억 고정 | memory_id |
| `unpin` | 기억 고정 해제 | memory_id |
| `forget` | 기억 삭제 | memory_id, hard |
| `hybrid_search` | 하이브리드 검색 | query, filters, limit, vectorWeight, textWeight |
| `apply_forgetting_policy` | 망각 정책 적용 | config |
| `schedule_review` | 리뷰 스케줄링 | memory_id, features |
| `get_performance_metrics` | 성능 메트릭 조회 | timeRange, includeDetails |
| `get_cache_stats` | 캐시 통계 조회 | cacheType |
| `clear_cache` | 캐시 정리 | cacheType |
| `optimize_database` | 데이터베이스 최적화 | actions, autoCreateIndexes |
| `error_stats` | 에러 통계 조회 | severity, category, hours, limit |
| `resolve_error` | 에러 해결 처리 | error_id, resolved_by, resolution |
| `performance_alerts` | 성능 알림 관리 | action, alert_id, level, type, includeResolved, hours, limit |

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
| `PORT` | 8080 | 서버 포트 |
| `DB_PATH` | ./data/memory.db | 데이터베이스 경로 |
| `LOG_LEVEL` | info | 로그 레벨 |
| `OPENAI_API_KEY` | - | OpenAI API 키 (선택사항) |

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
- **추가 기능**: 경량 임베딩, 성능 모니터링, 캐시 시스템

### M2: 팀 협업 (계획)
- **스토리지**: SQLite 서버 모드
- **인증**: API Key
- **운영**: Docker 단일 컨테이너

### M3: 조직 초입 (계획)
- **스토리지**: PostgreSQL + pgvector
- **인증**: JWT
- **운영**: Docker Compose

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

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