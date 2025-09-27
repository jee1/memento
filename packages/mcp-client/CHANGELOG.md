# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 성능 최적화 도구 (`PerformanceOptimizer`)
- 배치 처리 기능 (`createMemoriesBatch`)
- 캐싱 시스템 (`cachedSearch`)
- 병렬 처리 지원 (`parallelSearch`)
- 스트리밍 검색 (`streamSearch`)
- 압축 검색 (`compressedSearch`)
- 성능 벤치마킹 도구 (`runBenchmark`)
- 메모리 사용량 모니터링
- 실시간 성능 모니터링
- 상세한 API 문서
- 성능 가이드
- 문제 해결 가이드
- 마이그레이션 가이드
- 모범 사례 가이드

### Changed
- TypeScript 설정 최적화
- 빌드 프로세스 개선
- 에러 처리 강화
- 타입 정의 개선

### Fixed
- `exactOptionalPropertyTypes` 관련 타입 오류
- axios 모듈 해결 문제
- 빌드 오류 수정

## [0.1.0] - 2024-09-27

### Added
- 초기 릴리스
- `MementoClient` 클래스 - HTTP/WebSocket 통신
- `MemoryManager` 클래스 - 기억 관리
- `ContextInjector` 클래스 - 컨텍스트 주입
- 기본 CRUD 작업 (생성, 조회, 업데이트, 삭제)
- 검색 기능 (기본 검색, 태그 검색, 타입별 검색)
- 하이브리드 검색 (텍스트 + 벡터)
- 고급 검색 기능 (유사 기억, 관련 기억)
- 배치 작업 (일괄 생성, 삭제, 고정)
- 통계 조회 (기억 통계, 인기 태그)
- 이벤트 시스템 (연결, 기억 생성/수정/삭제)
- 에러 처리 (연결 오류, 인증 오류, 검증 오류)
- TypeScript 타입 정의
- JSDoc 문서화
- 예제 코드 (기본 사용법, 고급 사용법, AI Agent 통합)

### Features
- **기억 관리**: 완전한 CRUD 작업 지원
- **검색 기능**: 다양한 검색 옵션과 필터링
- **컨텍스트 주입**: AI Agent용 컨텍스트 자동 주입
- **이벤트 시스템**: 실시간 이벤트 처리
- **에러 처리**: 구체적인 에러 타입과 처리
- **타입 안전성**: 완전한 TypeScript 지원

### API
- `MementoClient`: 메인 클라이언트 클래스
- `MemoryManager`: 기억 관리 고수준 API
- `ContextInjector`: 컨텍스트 주입 전용 클래스
- `PerformanceOptimizer`: 성능 최적화 도구 (v0.2.0에서 추가 예정)

### Dependencies
- `axios`: HTTP 클라이언트
- `ws`: WebSocket 클라이언트
- `zod`: 스키마 검증

### Browser Support
- Node.js 20.0.0+
- TypeScript 5.0.0+

## [0.0.1] - 2024-09-26

### Added
- 프로젝트 초기 설정
- 기본 프로젝트 구조
- TypeScript 설정
- 빌드 시스템
- 패키지 설정

---

## 버전 관리 정책

### Major Version (X.0.0)
- 호환성을 깨뜨리는 변경사항
- API 구조 변경
- 주요 기능 제거

### Minor Version (0.X.0)
- 새로운 기능 추가
- 기존 기능 개선
- 새로운 API 추가
- 하위 호환성 유지

### Patch Version (0.0.X)
- 버그 수정
- 성능 개선
- 문서 업데이트
- 타입 정의 개선

## 마이그레이션 가이드

### v0.1.0 → v0.2.0 (예정)
- 성능 최적화 도구 도입
- 배치 처리 API 추가
- 캐싱 시스템 도입
- 병렬 처리 지원

### v0.0.1 → v0.1.0
- 초기 릴리스
- 모든 기본 기능 구현

## 지원 정책

### 현재 지원 버전
- v0.1.0 (최신)
- v0.0.1 (유지보수)

### 지원 종료 예정
- 없음

### 보안 업데이트
- 모든 지원 버전에 대해 보안 패치 제공
- 취약점 발견 시 즉시 패치 릴리스

## 기여 가이드

### 버그 리포트
- GitHub Issues 사용
- 재현 가능한 최소 예제 제공
- 환경 정보 포함

### 기능 요청
- GitHub Discussions 사용
- 사용 사례 설명
- 구현 제안 포함

### 코드 기여
- Fork 후 Pull Request
- 테스트 코드 포함
- 문서 업데이트
- CHANGELOG 업데이트

## 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일 참조

## 연락처

- GitHub: [https://github.com/your-org/memento](https://github.com/your-org/memento)
- Issues: [https://github.com/your-org/memento/issues](https://github.com/your-org/memento/issues)
- Discussions: [https://github.com/your-org/memento/discussions](https://github.com/your-org/memento/discussions)
