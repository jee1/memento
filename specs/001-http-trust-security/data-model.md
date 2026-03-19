# Data Model: 신뢰·보안 설정 (논리)

본 기능은 주로 **런타임 구성·환경**과 **기존 품질/메트릭 데이터**의 표현 안전성을 다룬다. 신규 영속 테이블은 필수 아님.

## Configuration (환경 / 배포)

| 논리 필드 | 설명 | 검증 규칙 |
|-----------|------|-----------|
| `adminApiKey` | 민감 HTTP 라우트용 공유 비밀 | 비루프백 바인딩 시 비어 있으면 안 됨(연구 결정 R-1). 최소 길이·엔트로피 권장은 구현 가이드에 문서화. |
| `corsAllowedOrigins` | 브라우저 출처 허용 목록 | 쉼표 구분 URL/오리진. 운영에서는 신뢰 도메인만. 빈 목록 = 크로스 오리진 거부(현행 http-server 정책과 정합). |
| `bindAddress` / listen 인터페이스 | 서버가 수신하는 주소 | 루프백만이면 R-1 완화 경로 허용 가능. `0.0.0.0` 등은 “공개”로 간주. |
| `insecureAdminAllowed` (가칭) | 개발용 명시적 옵션 | 프로덕션에서 기본 비활성. 설정 시에도 로그에 경고. |

## Existing domain data (품질)

| 엔터티 | 민감 필드 (HTML에 노출 가능) | 규칙 |
|--------|------------------------------|------|
| Quality threshold / metric | `metric_namespace`, `metric_key`, `context`, 측정값, 상태 문자열 | HTML 출력 시 이스케이프 + class/status allowlist |
| Measurement history | `namespace`, `context`, `measurement_type`, `status` | 동일 |

## 관계

- 구성은 **배포 단위** 1세트; DB 스키마와 FK 없음.
- 품질 데이터는 기존 SQLite 테이블; 본 기능은 **읽기·렌더링 경로**만 강화.

## 상태 전이

- 없음 (요청 단위 인증·응답).
