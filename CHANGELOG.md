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
- TypeScript 5.0+ 기반 MCP 서버 프로젝트 구조 생성
- ESLint, Prettier, Jest 테스트 프레임워크 설정
- GitHub Actions CI/CD 파이프라인 구성
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
  - `project-structure.mdc` - 프로젝트 구조 및 파일 명명 규칙
  - `testing.mdc` - 테스트 작성 및 실행 규칙
  - `deployment.mdc` - 배포 및 컨테이너화 규칙

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

### 기술 스택

#### 핵심 기술
- **언어**: TypeScript 5.0+
- **런타임**: Node.js 20+
- **프레임워크**: MCP SDK (Model Context Protocol)

#### 데이터베이스
- **M1**: SQLite + FTS5 + sqlite-vss
- **M3+**: PostgreSQL + pgvector + tsvector

#### 개발 도구
- **테스트**: Jest, @types/jest
- **린팅**: ESLint, Prettier
- **빌드**: TypeScript Compiler
- **컨테이너**: Docker, Docker Compose

#### 배포 및 운영
- **M2**: Docker 단일 컨테이너
- **M3**: Docker Compose (서버 + DB)
- **M4**: Kubernetes, Helm Charts

### 프로젝트 구조

```
memento/
├── src/                    # 소스 코드
│   ├── server/            # MCP 서버
│   ├── client/            # MCP 클라이언트
│   ├── algorithms/        # 검색 및 망각 알고리즘
│   └── shared/            # 공통 유틸리티
├── tests/                 # 테스트 코드
├── docs/                 # 문서
├── scripts/              # 빌드 및 배포 스크립트
├── docker/               # Docker 관련 파일
└── .cursor/rules/        # Cursor 개발 규칙
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
