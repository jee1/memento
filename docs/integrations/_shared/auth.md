# Authentication

이 문서는 **HTTP 트랙** 사용자를 대상으로 합니다. stdio 트랙은 비서가 Memento를 자식 프로세스로 spawn하므로 인증이 필요 없습니다 ([`./transports.md`](./transports.md) 참조).

Memento HTTP 서버의 핵심 사실:

> **Programmatic HTTP는 스코프드 API 토큰(`MEMENTO_API_TOKENS`)을 사용합니다.** 최소 스코프는 `tools:invoke`(도구/MCP/agent API)와 `admin:destructive`(quality API)입니다. `ADMIN_API_KEY` 는 브라우저 대시보드 로그인 키일 뿐이며, v2.0.0(#1241)부터 programmatic 표면에는 쓰이지 않습니다. 자세한 신뢰 모델은 [`../../reference/ko/security.md`](../../reference/ko/security.md)를 참조하세요.

이 문서는 토큰을 **어떻게 만들고, 어디에 저장하고, 언제 갈아끼울지**에 대한 가이드입니다.

---

## Bearer 토큰 vs X-API-Key

코드 상 두 헤더는 **동일한 secret**을 받는 별칭입니다.

| 항목 | `Authorization: Bearer <secret>` | `X-API-Key: <secret>` |
|---|---|---|
| 적용 라우트 | 스코프에 따라 `/tools`, `/mcp`, `/api/v1/agent`, `/api/v1/quality` | 동일 |
| MCP 비서 통합 | **권장** | 가능 (비표준) |
| 브라우저 대시보드 | `/auth/session` (`ADMIN_API_KEY`) | 동일 |

**권장**: 비서 등록은 `Authorization: Bearer` + **`tools:invoke` 전용 secret**을 사용하세요.

---

## 토큰 발급

### `MEMENTO_API_TOKENS` (권장)

```bash
# 예: 도구 전용 + ops admin
export MEMENTO_API_TOKENS='[
  {"id":"agent-1","secret":"'"$(openssl rand -hex 32)"'","scopes":["tools:invoke"]},
  {"id":"ops-1","secret":"'"$(openssl rand -hex 32)"'","scopes":["admin:destructive","tools:invoke"]}
]'
```

Docker `.env` 또는 compose `environment:`에 JSON 한 줄로 넣고 컨테이너를 재시작합니다.

### `ADMIN_API_KEY` (대시보드 로그인)

브라우저 대시보드 `/auth/session` 로그인에만 씁니다. v2.0.0(#1241) 전에는 `MEMENTO_API_TOKENS` 가 없을 때 programmatic 표면도 열었지만 이제는 401 입니다. 같은 값을 계속 쓰려면 `MEMENTO_API_TOKENS` 에 그 secret 으로 토큰을 하나 만드세요.

```bash
openssl rand -hex 32
# ADMIN_API_KEY=<값>
```

Admin UI·CLI에 토큰 발급 화면/명령은 없습니다. secret은 환경변수에서만 읽습니다.

---

## 검증

```bash
# tools 스코프 — /tools OK
curl -i -H "Authorization: Bearer $TOOLS_SECRET" http://localhost:9001/tools

# tools 스코프 — quality 403
curl -i -H "Authorization: Bearer $TOOLS_SECRET" http://localhost:9001/api/v1/quality/metrics

# admin 스코프 — quality OK
curl -i -H "Authorization: Bearer $ADMIN_SECRET" http://localhost:9001/api/v1/quality/metrics
```

---

## 회전·폐기

- **스코프드 토큰**: `MEMENTO_API_TOKENS` JSON에서 해당 `id` 항목을 교체/삭제 후 재시작. 여러 키를 동시에 둘 수 있어 **한 비서만** 갈아끼우기 쉽습니다.
- **대시보드 키**: `ADMIN_API_KEY` 교체 후 재시작. 기존 브라우저 세션은 다시 로그인해야 합니다.
- **API 폐기 엔드포인트 없음** — 환경변수 + 재시작만 지원.

---

## TLS 검증

(이하 동일 — [`../../reference/ko/security.md`](../../reference/ko/security.md) 및 transports 문서 참조)

운영 외부 노출 시 TLS 필수. 로컬 루프백은 평문 HTTP로 충분합니다.

---

## 다음 단계

- [`./transports.md`](./transports.md)
- [`./troubleshooting.md`](./troubleshooting.md)
- [`../../reference/ko/security.md`](../../reference/ko/security.md)

