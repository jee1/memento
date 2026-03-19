# Quickstart: 신뢰·보안 구성 (운영자)

**목표**: 문서만 보고 **15분 이내**에 원격에서 안전하게 관리·품질 API를 쓸 수 있는 상태로 만든다.

## 0. 키 오설정·잠금 복구

- `ADMIN_API_KEY`를 잃거나 잘못 넣어 모든 요청이 401이면: 배포 환경에서 키를 올바르게 재설정한다.
- 긴급히 로컬에서만 확인해야 하면: (미설정 시 기본이 이미 `127.0.0.1`이면 생략 가능) `MEMENTO_HTTP_BIND_HOST=127.0.0.1` 로 바인딩을 제한하고, **절대 원격에 노출하지 않는다.**
- (비권장) 개발 전용으로만 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true` — `env.example` 주석 필독.

## 1. 위험 확인 (2분)

- 서버가 **루프백이 아닌 주소**(예: `0.0.0.0`)에서 Listen 하는가?
- **인터넷 또는 사내망**에서 해당 포트에 도달 가능한가?

→ 둘 중 하나라도 예이면 아래는 **필수**다.

## 2. 관리 키 설정 (5분)

1. 강한 무작위 문자열을 생성한다(예: `openssl rand -hex 32`).
2. 배포 환경에 `ADMIN_API_KEY=<secret>` 설정.
3. `.env`는 저장소에 커밋하지 않는다. `env.example`의 플레이스홀더를 참고한다.

## 3. CORS 허용 목록 (5분)

1. 브라우저에서 API를 호출할 **프론트엔드 오리진**만 나열한다.  
   예: `CORS_ALLOWED_ORIGINS=https://ops.example.com,http://localhost:5173`
2. 브라우저를 쓰지 않으면(서버-투-서버만) 빈 목록으로 둘 수 있다(크로스 오리진 브라우저 호출은 거부).

## 4. 동작 확인 (3분)

- 자격 없이: `curl -i http://<host>:<port>/admin/...` → **401** 기대.
- 자격 포함: `curl -i -H "Authorization: Bearer <secret>" http://<host>:<port>/admin/...` → 기대하는 2xx/4xx(업무 로직).

## 5. 로컬 개발 (완화)

- `127.0.0.1`에만 바인딩하고 키를 아직 쓰지 않는 경우: 구현된 **문서화된 개발 모드** 규칙을 따른다(공개 바인딩과 혼동 금지).

## 6. 품질 HTML

- 악성으로 의심되는 `namespace`/`key`를 넣은 뒤 `format=html` 리포트를 열어, 스크립트 실행이 없는지 확인한다(회귀 테스트 스위트 참고).

## 관련 문서

- [spec.md](./spec.md) — 요구사항 출처  
- [plan.md](./plan.md) — 구현 단계  
- [contracts/http-security.md](./contracts/http-security.md) — 클라이언트 계약  
