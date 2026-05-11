# 레거시 스크립트 마이그레이션 가이드

## 개요

이 문서는 레거시 스크립트(`simple-migrate.js`, `simple-update.js`)를 정식 마이그레이션 시스템으로 전환하는 과정을 설명합니다.

## 레거시 스크립트 상태

### simple-migrate.js

**상태**: 분석 스크립트 (마이그레이션이 아님)

**기능**: 임베딩 데이터 분석 및 통계 출력

**대체**: `simple-migrate-wrapper.ts` (기능 유지, logger 사용)

**사용법**:
```bash
# 권장
npx tsx scripts/simple-migrate-wrapper.ts

# 레거시 (하위 호환성 유지)
npx tsx scripts/simple-migrate.js
```

### simple-update.js

**상태**: 레거시 마이그레이션 스크립트

**기능**: 임베딩 메타데이터 업데이트 (embedding_provider, dimensions, created_by 컬럼 추가)

**대체**: `simple-update-wrapper.ts` (정식 마이그레이션 시스템 사용)

**사용법**:
```bash
# 권장 (정식 마이그레이션 시스템 사용)
npx tsx scripts/simple-update-wrapper.ts

# 레거시 (하위 호환성 유지)
npx tsx scripts/simple-update.js
```

## 정식 마이그레이션 시스템 사용

### simple-update-wrapper.ts

이 스크립트는 정식 마이그레이션 시스템(`MigrationRunner`, `MigrationDetector`)을 사용하여 실행 대기 중인 마이그레이션을 자동으로 감지하고 실행합니다.

**장점**:
- 자동 백업 생성
- 스키마 버전 관리
- 전후 검증 지원
- 자동 롤백 지원
- 로깅 및 추적

**사용 예제**:
```bash
# 저장소 루트에서 실행 (정식 마이그레이션 래퍼)
npx tsx scripts/simple-update-wrapper.ts
```

> **참고**: 래퍼 구현은 `packages/memento-core` 쪽 마이그레이션 러너를 호출합니다. 루트 `src/` 경로를 가정하는 예시는 사용하지 마세요.

## 마이그레이션 체크리스트

레거시 스크립트를 사용하는 경우 다음을 확인하세요:

- [ ] 정식 마이그레이션 시스템 사용 가능 여부 확인
- [ ] 레거시 스크립트의 기능이 정식 마이그레이션에 포함되어 있는지 확인
- [ ] 하위 호환성이 필요한 경우 레거시 스크립트 유지
- [ ] 새로운 마이그레이션은 정식 마이그레이션 시스템 사용

## 참고 자료

- [마이그레이션 시스템 사용 가이드](./migration-system-guide.md)
- [레거시 스크립트 사용 여부 확인 스크립트](../../../scripts/check-legacy-script-usage.ts)

