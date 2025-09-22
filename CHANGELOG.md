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
- 🎯 **프로젝트 초기 설정**
  - TypeScript 기반 MCP 서버 프로젝트 구조 생성
  - ESLint, Prettier, Jest 설정
  - GitHub Actions CI/CD 파이프라인 설정

- 📚 **문서화**
  - `docs/Memento-Goals.md` - 프로젝트 목표 및 시스템 설계
  - `docs/Memento-M1-DetailSpecs.md` - M1 단계 상세 설계
  - `docs/Memento-Milestones.md` - 마일스톤별 아키텍처 계획
  - `docs/Search-Ranking-Memory-Decay-Formulas.md` - 검색 랭킹 및 망각 수식

- 🛠️ **개발 도구**
  - Cursor Rules 생성 (`.cursor/rules/`)
    - `memento-project-overview.mdc` - 프로젝트 전체 개요
    - `mcp-server-development.mdc` - MCP 서버 개발 규칙
    - `mcp-client-development.mdc` - MCP 클라이언트 개발 규칙
    - `database-schema.mdc` - 데이터베이스 스키마 규칙
    - `memory-algorithms.mdc` - 기억 알고리즘 구현 규칙

- 🏗️ **아키텍처 설계**
  - 4단계 마일스톤 계획 (M1-M4)
  - M1: 개인용 SQLite 기반 MVP
  - M2: 팀 협업 SQLite 서버 모드
  - M3: 조직용 PostgreSQL + pgvector
  - M4: 엔터프라이즈 고가용성 구성

- 🧠 **기억 모델 설계**
  - 작업기억 (Working Memory) - 48시간 유지
  - 일화기억 (Episodic Memory) - 90일 유지
  - 의미기억 (Semantic Memory) - 무기한
  - 절차기억 (Procedural Memory) - 무기한

- 🔍 **검색 시스템 설계**
  - 2단계 검색 파이프라인 (ANN + BM25)
  - 복합 랭킹 공식 구현
  - MMR 다양성 제어
  - 배치 정규화 최적화

- 🧹 **망각 시스템 설계**
  - TTL 기반 자동 삭제 정책
  - 간격 반복 알고리즘
  - 수면 통합 배치 작업

### 기술 스택
- **언어**: TypeScript 5.0+
- **프레임워크**: MCP SDK
- **데이터베이스**: SQLite (M1) → PostgreSQL (M3+)
- **벡터 검색**: sqlite-vss (M1) → pgvector (M3+)
- **텍스트 검색**: FTS5 (SQLite) → tsvector (PostgreSQL)
- **컨테이너**: Docker, Docker Compose
- **오케스트레이션**: Kubernetes (M4)

### 문서
- README.md 생성
- CHANGELOG.md 생성
- 개발 가이드라인 문서화

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

## 버전 규칙

- **MAJOR**: 호환되지 않는 API 변경
- **MINOR**: 하위 호환성을 유지하는 기능 추가
- **PATCH**: 하위 호환성을 유지하는 버그 수정

## 기여 가이드

변경사항을 추가할 때는 다음 형식을 따르세요:

```markdown
### 추가됨
- 새로운 기능 설명

### 변경됨
- 기존 기능 변경사항

### 제거됨
- 제거된 기능 설명

### 수정됨
- 버그 수정 내용

### 보안
- 보안 관련 변경사항
```
