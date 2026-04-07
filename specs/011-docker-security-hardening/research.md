# Research: 011-docker-security-hardening

**Date**: 2026-04-05  
**Branch**: `011-docker-security-hardening`

---

## Q1. `docker-compose.base.yml`의 env var default 문법 — MEMENTO_ALLOW_INSECURE_HTTP_ADMIN을 opt-in으로 만드는 방법

### 현재 상태

`docker-compose.base.yml` 24번째 줄:

```yaml
MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"
```

이 값은 hardcoded `"true"`로, env var override 없이 항상 활성화된다.

### Docker Compose env var default 문법

| 문법 | 의미 |
|------|------|
| `VAR: "value"` | 항상 `"value"` (hardcoded, 오버라이드 불가) |
| `VAR: ${VAR:-default}` | 환경변수가 없거나 비어 있으면 `default` 사용 |
| `VAR: ${VAR-default}` | 환경변수가 없을 때만 `default` 사용 (빈 문자열은 그대로) |
| `VAR: ${VAR}` | 환경변수 값 그대로 (없으면 빈 문자열) |

### 수정 방법

옵션 A — 해당 줄을 **완전히 제거**: 환경변수가 주입되지 않으면 기본값은 코드 레벨에서 처리 (권장)

```yaml
# 이 줄 삭제:
# MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"
```

옵션 B — opt-in 문법으로 변경:

```yaml
MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: ${MEMENTO_ALLOW_INSECURE_HTTP_ADMIN:-false}
```

**채택**: 옵션 A (FR-001, 스펙 clarification 일치). 해당 줄 제거 + 주석으로 escape hatch 존재 안내 추가.

### 코드 레벨 기본값 확인 필요

`@memento/core`의 `mementoConfig.allowInsecureHttpAdmin` 기본값이 `false`인지 확인 필요 (다음 섹션 참조).

---

## Q2. ADMIN_API_KEY 미설정 시 admin auth 처리 — 현재 구현과 수정 방향

### 현재 구현 (`admin-auth.middleware.ts`)

```typescript
// 파일: packages/memento-server/src/server/middleware/admin-auth.middleware.ts

export function createAdminAuthMiddleware() {
  const expectedKey = mementoConfig.adminApiKey;

  return (req, res, next) => {
    if (!expectedKey || expectedKey === '') {
      next();  // ← FAIL-OPEN: 키 없으면 통과
      return;
    }
    // ... 키 검증 로직
  };
}
```

**문제**: line 15의 `next()` 호출은 fail-open 동작. `ADMIN_API_KEY`가 없거나 비어 있으면 모든 admin 요청을 인증 없이 허용한다.

### 스펙 요구사항 (clarification 반영)

- **FR-002 (updated)**: `ADMIN_API_KEY`가 absent/empty/whitespace → 모든 admin 요청에 401 반환
- whitespace-only 값도 "unconfigured"로 취급 (spec edge case 참조)
- `expectedKey.trim() === ''` 체크 필요

### 수정 방향

```typescript
return (req, res, next) => {
  // trim()으로 whitespace-only 키도 "미설정"으로 처리
  if (!expectedKey || expectedKey.trim() === '') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin API is disabled: ADMIN_API_KEY is not configured.',
      timestamp: new Date().toISOString()
    });
    return;
  }
  // ... 기존 키 검증 로직 유지
};
```

### 연관 — 시작 시 경고 로그 (FR-003)

`http-server.ts`의 `startServer()` 함수 내에서 `ADMIN_API_KEY` 미설정 시 warning 로그 추가 필요.  
현재 `getMementoHttpSecurityStartupViolationMessage`는 non-loopback 바인딩 + 키 미설정 조합만 처리함.  
loopback 바인딩이어도 키 미설정 시 별도 warning을 emit해야 함 (FR-003 updated).

---

## Q3. helmet.js 존재 여부 및 대안

### package.json 확인 결과

`packages/memento-server/package.json` dependencies:
- `cors`, `express`, `ws`, `uuid`, `zod`, `dotenv`, `better-sqlite3` 
- **helmet.js 없음**

`packages/memento-server/package.json` devDependencies:
- 테스트/타입 패키지들만 존재

### 결론: helmet.js 신규 설치 필요

스펙 clarification: "Helmet.js v7+ defaults is acceptable and preferred"

```bash
npm install helmet --workspace=packages/memento-server
```

### 필요한 보안 헤더 (OWASP minimum set + Helmet defaults)

| 헤더 | 값 | 스펙 요구 |
|------|----|-----------|
| `X-Frame-Options` | `DENY` | FR-005 필수 |
| `X-Content-Type-Options` | `nosniff` | FR-005 필수 |
| `Content-Security-Policy` | `default-src 'self'` | FR-005 필수 |
| `Referrer-Policy` | `no-referrer` | FR-005 필수 |
| `X-DNS-Prefetch-Control` | `off` | Helmet default (bonus) |
| `X-Download-Options` | `noopen` | Helmet default (bonus) |
| `X-Permitted-Cross-Domain-Policies` | `none` | Helmet default (bonus) |

### 적용 위치 (FR-006)

`http-server.ts`에서 cors/body-parser 등록 **이전** 또는 **직후**에 global middleware로 등록:

```typescript
import helmet from 'helmet';
// ...
app.use(helmet());  // CORS, routes 등록 전에 위치
```

---

## Q4. admin-auth.middleware.ts 현재 로직 전체 분석

### 파일 위치

`packages/memento-server/src/server/middleware/admin-auth.middleware.ts` (37줄)

### 현재 동작 흐름

1. 모듈 로드 시 `mementoConfig.adminApiKey` 캡처
2. 요청마다:
   - `expectedKey`가 없거나 빈 문자열 → `next()` (fail-open ← **버그**)
   - `Authorization: Bearer <key>` 또는 `X-API-Key: <key>` 헤더 추출
   - 키 일치 → `next()`
   - 불일치 → 401 JSON 응답

### 수정 범위

- Line 15: `next()` → 401 응답으로 변경 (fail-closed)
- whitespace trim 추가
- 에러 메시지를 "Admin API disabled: no API key configured" 형태로 명확화
- 기존 41 응답 로직 (키 설정 시 불일치 케이스) 유지

---

## 추가 리서치: 영향받는 파일 목록

| 파일 | 변경 유형 | 이유 |
|------|-----------|------|
| `docker-compose.base.yml` | 줄 삭제 | FR-001: hardcoded insecure bypass 제거 |
| `docker-compose.yml` | `user: root` 줄 삭제 | FR-004: non-root 실행 |
| `packages/memento-server/src/server/middleware/admin-auth.middleware.ts` | 로직 수정 | FR-002: fail-closed |
| `packages/memento-server/src/server/http-server.ts` | helmet import + app.use(helmet()) | FR-005/FR-006 |
| `packages/memento-server/package.json` | helmet 의존성 추가 | FR-005 구현 |

---

## 미확인 사항 (Phase 1 Design에서 해결)

1. `mementoConfig.allowInsecureHttpAdmin` 기본값 코드 확인 (`@memento/core/src/shared/config.ts` 또는 유사 파일)
2. helmet import 시 TypeScript 타입 패키지 필요 여부 (`@types/helmet` — helmet v7+는 자체 타입 포함하여 불필요할 수 있음)
3. 기존 admin-auth 미들웨어 테스트 파일 존재 여부 (TDD: 실패 테스트 먼저 작성)
