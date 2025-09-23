# Changelog

이 파일은 Memento MCP Server 프로젝트의 모든 중요한 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)를 따르며,
이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수합니다.

## [Unreleased]

### 계획된 기능
- M1 MVP 구현 완료
- 기본 MCP Tools 구현 (remember, recall, forget, pin)
- SQLite 기반 스토리지 구현
- FTS5 + VSS 벡터 검색 구현
- 검색 랭킹 알고리즘 구현
- 망각 정책 및 간격 반복 구현

### 변경사항
- 프로젝트 초기 설정
- Cursor Rules 생성
- 문서 구조 정립

## [0.1.0] - 2025-09-22

### 추가됨

#### 🎯 프로젝트 초기 설정
- TypeScript 5.3.0 기반 MCP 서버 프로젝트 구조 생성
- ESLint, Vitest 테스트 프레임워크 설정
- tsx 개발 도구 통합
- .gitignore 파일 생성 (Node.js, TypeScript, MCP 특화)

#### 📚 문서화 시스템
- **설계 문서**:
  - `docs/Memento-Goals.md` - 프로젝트 목표 및 시스템 설계
  - `docs/Memento-M1-DetailSpecs.md` - M1 단계 상세 설계
  - `docs/Memento-Milestones.md` - 마일스톤별 아키텍처 계획
  - `docs/Search-Ranking-Memory-Decay-Formulas.md` - 검색 랭킹 및 망각 수식
- **프로젝트 문서**:
  - `README.md` - 프로젝트 개요, 설치, 사용법, 아키텍처
  - `CHANGELOG.md` - 버전별 변경사항 추적

#### 🛠️ 개발 도구 및 규칙
- **Cursor Rules** (`.cursor/rules/`):
  - `memento-project-overview.mdc` - 프로젝트 전체 개요 (항상 적용)
  - `mcp-server-development.mdc` - MCP 서버 개발 규칙 (TypeScript/JavaScript)
  - `mcp-client-development.mdc` - MCP 클라이언트 개발 규칙 (TypeScript/JavaScript)
  - `database-schema.mdc` - 데이터베이스 스키마 규칙 (SQL/TypeScript)
  - `memory-algorithms.mdc` - 기억 알고리즘 구현 규칙 (TypeScript/JavaScript)
  - `project-structure.mdc` - 프로젝트 구조 및 파일 명명 규칙 (실제 구조 반영)
  - `testing.mdc` - 테스트 작성 및 실행 규칙
  - `deployment.mdc` - 배포 및 컨테이너화 규칙
  - `implementation.mdc` - 실제 구현된 기능들에 대한 개발 규칙 (신규)

#### 🏗️ 아키텍처 설계
- **4단계 마일스톤 계획**:
  - M1: 개인용 SQLite 기반 MVP (로컬 실행)
  - M2: 팀 협업 SQLite 서버 모드 (Docker, API Key)
  - M3: 조직용 PostgreSQL + pgvector (Docker Compose, JWT)
  - M4: 엔터프라이즈 고가용성 구성 (Kubernetes, RBAC + SSO)
- **시스템 아키텍처**: Mermaid 다이어그램으로 시각화
- **프로젝트 구조**: 모듈화된 디렉토리 구조 설계

#### 🧠 기억 모델 설계
- **작업기억 (Working Memory)**: 현재 처리 중인 정보 (48시간 유지)
- **일화기억 (Episodic Memory)**: 사건과 경험 (90일 유지)
- **의미기억 (Semantic Memory)**: 지식과 사실 (무기한)
- **절차기억 (Procedural Memory)**: 방법과 절차 (무기한)

#### 🔍 검색 시스템 설계
- **2단계 검색 파이프라인**: ANN (벡터) + BM25 (키워드)
- **복합 랭킹 공식**: S = α×relevance + β×recency + γ×importance + δ×usage - ε×duplication_penalty
- **MMR 다양성 제어**: 중복 제거 및 결과 다양성 확보
- **배치 정규화**: 성능 최적화 및 안정성 향상

#### 🧹 망각 시스템 설계
- **TTL 기반 자동 삭제 정책**: 타입별 수명 관리
- **간격 반복 알고리즘**: 중요도 기반 주기적 리뷰
- **수면 통합 배치 작업**: 야간 기억 통합 및 요약

#### 🚀 실제 구현 완료 (M1 MVP)
- **MCP 서버 구현** (`src/server/index.ts` - 521줄):
  - remember, recall, forget, pin/unpin Tools 구현
  - Zod 스키마 기반 입력 검증
  - 구조화된 에러 처리 및 로깅
  - MCP 프로토콜 완전 준수
  - 하이브리드 검색 엔진 통합
  - 임베딩 서비스 통합

- **검색 엔진 구현** (`src/algorithms/search-engine.ts` - 233줄):
  - FTS5 텍스트 검색 통합
  - 검색 랭킹 알고리즘 구현
  - 고급 필터링 시스템 (타입, 태그, 시간, 고정 여부)
  - 성능 최적화된 인덱스 활용

- **하이브리드 검색 엔진 구현** (`src/algorithms/hybrid-search-engine.ts` - 200줄):
  - FTS5 텍스트 검색 + 벡터 검색 결합
  - 가중치 조정 시스템 (벡터 60%, 텍스트 40%)
  - 하이브리드 점수 계산 및 정규화
  - 고성능 하이브리드 검색 결과 제공

- **데이터베이스 시스템** (`src/database/init.ts` - 102줄):
  - SQLite 데이터베이스 초기화
  - 완전한 스키마 생성 (7개 테이블)
  - FTS5 및 일반 인덱스 설정
  - 안전한 연결 관리

- **임베딩 서비스 구현** (`src/services/embedding-service.ts` - 196줄):
  - OpenAI API 연동 (`text-embedding-3-small` 모델)
  - 텍스트를 1536차원 벡터로 변환
  - 코사인 유사도 기반 검색
  - 에러 처리 및 재시도 로직

- **메모리 임베딩 서비스 구현** (`src/services/memory-embedding-service.ts` - 237줄):
  - 메모리와 임베딩을 데이터베이스에 저장
  - 벡터 검색 및 유사도 계산
  - 자동 임베딩 생성 및 관리
  - 성능 최적화된 벡터 검색

- **클라이언트 구현** (`src/client/index.ts`):
  - MCP 프로토콜 기반 클라이언트
  - 서버 연결 및 통신 관리
  - 에러 처리 및 재시도 로직

- **망각 시스템 구현** (`src/algorithms/forgetting-algorithm.ts` - 244줄):
  - Memento-Goals.md의 망각 공식 구현
  - 최근성, 사용성, 중복 비율, 중요도, 고정 여부를 종합한 망각 점수 계산
  - U1-U5 계수를 사용한 가중치 시스템
  - 망각 결정 로직 및 특징 계산 함수

- **간격 반복 알고리즘 구현** (`src/algorithms/spaced-repetition.ts` - 239줄):
  - 중요도와 사용성 기반 리뷰 간격 계산
  - 시간 경과에 따른 리콜 확률 계산
  - 피드백에 따른 동적 간격 조정
  - 간격 반복 스케줄링 시스템

- **망각 정책 서비스 구현** (`src/services/forgetting-policy-service.ts` - 335줄):
  - 망각 알고리즘과 간격 반복 통합
  - TTL 기반 정책 (타입별 수명 관리)
  - 소프트/하드 삭제 단계적 정책
  - 배치 처리 및 메모리 관리

- **HTTP 서버 구현** (`src/server/http-server.ts` - 551줄):
  - WebSocket 지원 실시간 통신 서버
  - CORS 설정으로 웹 클라이언트 지원
  - MCP 프로토콜과의 콘솔 로그 충돌 해결
  - Express + WebSocket 통합 아키텍처

- **성능 최적화 시스템** (1,608줄):
  - **비동기 처리 최적화** (`src/services/async-optimizer.ts` - 447줄):
    - 워커 풀 관리 및 병렬 처리
    - 우선순위 기반 작업 큐 시스템
    - 배치 처리 및 재시도 로직
    - 성능 최적화된 비동기 작업 처리
  - **캐시 서비스** (`src/services/cache-service.ts` - 352줄):
    - LRU 캐시 구현 및 TTL 관리
    - 검색 결과 캐싱 및 임베딩 캐싱
    - 캐시 통계 수집 및 성능 모니터링
    - 메모리 효율적인 캐시 관리
  - **데이터베이스 최적화** (`src/services/database-optimizer.ts` - 442줄):
    - 자동 인덱스 추천 및 생성
    - 쿼리 성능 분석 및 최적화
    - 데이터베이스 성능 튜닝
    - 통계 수집 및 성능 개선
  - **성능 모니터링** (`src/services/performance-monitor.ts` - 367줄):
    - 실시간 메트릭 수집 및 분석
    - 임계값 모니터링 및 알림
    - 성능 리포트 생성 및 트렌드 분석
    - 시스템 상태 모니터링

- **테스트 시스템** (1,290줄):
  - `test-client.ts` (152줄): 클라이언트 통합 테스트
  - `test-search.ts` (152줄): 검색 기능 상세 테스트
  - `test-embedding.ts` (154줄): 임베딩 기능 테스트
  - `test-forgetting.ts` (163줄): 망각 정책 테스트
  - `test-performance-monitoring.ts` (172줄): 성능 모니터링 기능 테스트
  - `test/performance-benchmark.ts` (497줄): 종합 성능 벤치마크 테스트
  - Vitest 설정 및 모던 테스트 환경

- **빌드 시스템**:
  - TypeScript 컴파일 및 소스맵 생성
  - 에셋 복사 자동화 (schema.sql)
  - 개발/프로덕션 환경 분리

### 기술 스택

#### 핵심 기술
- **언어**: TypeScript 5.3.0
- **런타임**: Node.js 20.10.0+
- **프레임워크**: MCP SDK 0.5.0 (Model Context Protocol)

#### 데이터베이스
- **M1 (구현 완료)**: SQLite 5.1.6 + FTS5 + 완전한 스키마
- **M3+ (계획)**: PostgreSQL + pgvector + tsvector

#### 개발 도구
- **테스트**: Vitest 1.0.0 (구현 완료)
- **린팅**: ESLint 8.54.0, @typescript-eslint
- **빌드**: TypeScript 5.3.0, tsx 4.6.0
- **컨테이너**: Docker, Docker Compose

#### 배포 및 운영
- **M2**: Docker 단일 컨테이너
- **M3**: Docker Compose (서버 + DB)
- **M4**: Kubernetes, Helm Charts

### 프로젝트 구조

```
memento/
├── src/                    # 소스 코드
│   ├── algorithms/        # 검색 및 망각 알고리즘
│   │   ├── search-engine.ts        # 검색 엔진 (233줄)
│   │   ├── hybrid-search-engine.ts # 하이브리드 검색 엔진 (200줄)
│   │   ├── search-ranking.ts       # 검색 랭킹 알고리즘
│   │   ├── forgetting-algorithm.ts # 망각 알고리즘 (244줄)
│   │   └── spaced-repetition.ts    # 간격 반복 알고리즘 (239줄)
│   ├── client/            # MCP 클라이언트
│   │   └── index.ts       # 클라이언트 구현
│   ├── config/            # 설정 관리
│   │   └── index.ts       # 설정 파일
│   ├── database/          # 데이터베이스 관련
│   │   ├── init.ts        # 데이터베이스 초기화 (102줄)
│   │   └── schema.sql     # SQLite 스키마
│   ├── server/            # MCP 서버
│   │   ├── index.ts       # 서버 메인 (521줄)
│   │   └── http-server.ts # HTTP/WebSocket 서버 (551줄)
│   ├── types/             # TypeScript 타입 정의
│   │   └── index.ts       # 공통 타입 정의
│   ├── utils/             # 유틸리티 함수
│   │   └── database.ts    # 데이터베이스 유틸리티
│   ├── services/          # 서비스 레이어 (신규)
│   │   ├── embedding-service.ts        # OpenAI 임베딩 서비스 (196줄)
│   │   ├── memory-embedding-service.ts # 메모리 임베딩 서비스 (237줄)
│   │   ├── forgetting-policy-service.ts # 망각 정책 서비스 (335줄)
│   │   ├── async-optimizer.ts          # 비동기 처리 최적화 (447줄)
│   │   ├── cache-service.ts            # 캐시 서비스 (352줄)
│   │   ├── database-optimizer.ts       # 데이터베이스 최적화 (442줄)
│   │   └── performance-monitor.ts      # 성능 모니터링 (367줄)
│   ├── test/              # 테스트 디렉토리 (신규)
│   │   └── performance-benchmark.ts # 성능 벤치마크 (497줄)
│   ├── test-client.ts     # 클라이언트 테스트 (152줄)
│   ├── test-search.ts     # 검색 테스트 (152줄)
│   ├── test-embedding.ts  # 임베딩 테스트 (154줄)
│   ├── test-forgetting.ts # 망각 정책 테스트 (163줄)
│   └── test-performance-monitoring.ts # 성능 모니터링 테스트 (172줄)
├── dist/                  # 빌드 결과물
├── data/                  # 데이터 파일
│   ├── memory.db         # SQLite 데이터베이스
│   ├── memory.db-shm     # SQLite 공유 메모리
│   └── memory.db-wal     # SQLite WAL 파일
├── docs/                 # 문서
├── .cursor/rules/        # Cursor 개발 규칙 (12개)
├── package.json          # 프로젝트 설정
├── tsconfig.json         # TypeScript 설정
├── vitest.config.ts      # Vitest 설정
└── env.example           # 환경 변수 예시
```

### 문서화

#### 사용자 문서
- README.md - 프로젝트 개요, 설치, 사용법
- 설치 및 설정 가이드 (계획됨)
- 사용자 매뉴얼 (계획됨)
- API 참조 (계획됨)

#### 개발자 문서
- 개발 환경 설정 가이드 (계획됨)
- 아키텍처 문서 (계획됨)
- 기여 가이드 (계획됨)
- 테스트 가이드 (계획됨)

#### 기술 문서
- 프로젝트 목표 및 설계 문서
- 마일스톤별 아키텍처 계획
- 검색 랭킹 및 망각 수식

## [0.2.0] - 계획됨

### 계획된 기능
- 🚀 **M1 MVP 구현**
  - MCP 서버 기본 구조 구현
  - SQLite 데이터베이스 스키마 생성
  - 기본 Tools 구현 (remember, recall, forget, pin)
  - FTS5 + VSS 검색 엔진 구현

- 🔧 **개발 도구**
  - 단위 테스트 작성
  - 통합 테스트 구현
  - 성능 벤치마크 도구
  - 로깅 및 모니터링 설정

## [0.3.0] - 계획됨

### 계획된 기능
- 🧠 **고급 기능**
  - 검색 랭킹 알고리즘 구현
  - 망각 정책 자동화
  - 간격 반복 스케줄러
  - 기억 간 관계 생성 (link)

- 📊 **성능 최적화**
  - 검색 성능 튜닝
  - 메모리 사용량 최적화
  - 배치 작업 최적화

## [1.0.0] - 계획됨

### 계획된 기능
- 🎯 **M1 완성**
  - 모든 핵심 기능 구현 완료
  - 안정성 및 성능 검증
  - 문서화 완료
  - 프로덕션 준비 완료

## [2.0.0] - 계획됨

### 계획된 기능
- 👥 **M2 팀 협업**
  - SQLite 서버 모드 전환
  - API Key 인증 구현
  - Docker 컨테이너 배포
  - 팀 단위 권한 관리

## [3.0.0] - 계획됨

### 계획된 기능
- 🏢 **M3 조직 초입**
  - PostgreSQL + pgvector 마이그레이션
  - JWT 인증 시스템
  - Docker Compose 배포
  - 사용자별 권한 관리

## [4.0.0] - 계획됨

### 계획된 기능
- 🌐 **M4 엔터프라이즈**
  - 고가용성 PostgreSQL 클러스터
  - RBAC + SSO/LDAP 연동
  - Kubernetes 배포
  - 기업 보안 정책 준수

---

## 🔗 링크

- [Unreleased]: https://github.com/your-org/memento/compare/v0.1.0...HEAD
- [0.1.0]: https://github.com/your-org/memento/releases/tag/v0.1.0

## 📋 버전 규칙

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수합니다.

- **MAJOR (X.0.0)**: 호환되지 않는 API 변경
- **MINOR (X.Y.0)**: 하위 호환성을 유지하는 기능 추가
- **PATCH (X.Y.Z)**: 하위 호환성을 유지하는 버그 수정

## 📝 기여 가이드

변경사항을 추가할 때는 다음 형식을 따르세요:

### 카테고리

- **추가됨**: 새로운 기능
- **변경됨**: 기존 기능의 변경사항
- **제거됨**: 이번 릴리스에서 제거된 기능
- **수정됨**: 버그 수정
- **보안**: 보안 관련 변경사항
- **문서**: 문서 변경사항

### 형식 예시

```markdown
### 추가됨
- 새로운 MCP Tool: `summarize_thread`
- Docker Compose 개발 환경 설정

### 변경됨
- 검색 랭킹 알고리즘 성능 개선
- API 응답 형식 표준화

### 수정됨
- 메모리 누수 문제 해결
- 검색 결과 중복 제거 로직 수정

### 보안
- JWT 토큰 검증 강화
- SQL 인젝션 방지 로직 추가
```

### 날짜 형식

- **YYYY-MM-DD**: ISO 8601 형식 사용
