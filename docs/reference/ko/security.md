# 보안 참고 (Security Notes)

HTTP 관리 서버를 열면 **브라우저 세션**, **스코프드 API 토큰**, **레거시 단일 키**가 서로 다른 경로를 보호합니다. 대시보드·그래프는 쿠키 세션으로, programmatic MCP·quality API는 Bearer 토큰으로 나뉘므로, 배포 전에 어떤 표면을 어디에 노출할지 먼저 정한 뒤 아래 설정을 맞추면 됩니다.

## Production dependency audit (#756)

- **CI gate**: `.github/workflows/security-check.yml`가 `node scripts/check-production-audit-fixable.mjs`를 실행합니다. 내부에서 `npm audit --omit=dev`를 돌리며, **fixable High/Moderate/Critical이 1건이라도 있으면 실패**합니다.
- **정책**: wanted 범위(minor/patch) 안에서만 해소합니다. `npm audit fix --force`·`overrides`로 ML 스택을 끌어올리지 않습니다 (`AGENTS.md` deps wanted-only).
- **Upstream-blocked (accepted risk, no force-override)** — 2026-08-15 재측정:

| Package path | Advisory / notes | Why blocked | Tracking |
|--------------|------------------|-------------|----------|
| `adm-zip` ← `onnxruntime-node` ← `@huggingface/transformers` | [GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85) (High) — crafted ZIP → large allocation | Upstream `onnxruntime-node` pins vulnerable `adm-zip`; no non-force fix in our lockfile | Re-check on `@huggingface/transformers` / `onnxruntime-node` upgrades; issue #756 |
| `sharp` ← `@huggingface/transformers` | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) (High) — libvips CVEs; requires `sharp>=0.35` | Parent still depends on `sharp<0.35`; force override risk for native/ABI | Same; prefer upstream bump over override |

- **Exploitability note**: MiniLM / local embedding 경로에서만 해당 transitive가 로드됩니다. ZIP/이미지 입력을 신뢰하지 않는 운영에서는 노출면이 제한적입니다. 새 fixable High/Moderate가 생기면 CI가 막습니다.

## HTTP API 인증·인가

- **현재 상태**: HTTP 서버는 **분리된 신뢰 모델**을 사용합니다.
  - `/auth/session` — 쿠키 기반 브라우저 세션 시작
  - `/admin/*`, `/api/*` — **브라우저 세션이 필요합니다**
  - `/tools/*`, `/mcp`, `/messages`, `/api/v1/agent` — **`tools:invoke` 스코프** 토큰 (`Authorization: Bearer` 또는 `X-API-Key`)
  - `/api/v1/quality/*`, `/api/v1/maintenance/*`, `/api/v1/audit/*` — **`admin:destructive` 스코프** 토큰 (programmatic 관리 API)
- **스코프드 토큰 (`MEMENTO_API_TOKENS`)**: JSON 배열로 여러 키를 설정합니다. 예:
  ```json
  [
    { "id": "agent-tools", "secret": "<hex>", "scopes": ["tools:invoke"] },
    { "id": "ops-admin", "secret": "<hex>", "scopes": ["admin:destructive", "tools:invoke"] }
  ]
  ```
  `tools:invoke`만 있는 토큰은 quality API에 **403 Forbidden** 됩니다.
- **Legacy `ADMIN_API_KEY`**: `MEMENTO_API_TOKENS`가 없을 때만 synthetic `legacy-admin` 토큰(양쪽 스코프)으로 동작하며, 기동 시 deprecation 경고가 1회 기록됩니다. 신규 배포는 `MEMENTO_API_TOKENS`로 이전하세요.
- **권장 사용**: 특별한 이유가 없다면 HTTP 서버는 **루프백 또는 내부망**에만 두세요. 브라우저 대시보드/그래프는 서버와 동일 출처에서 열어 세션 쿠키가 다른 오리진으로 퍼지지 않게 유지하세요.
- **운영 환경**: programmatic 접근에는 스코프드 토큰을 사용하고, 의도적으로 노출하는 경우가 아니면 `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지하세요.
- **브라우저 비밀 처리**: 서버는 브라우저 자산에 API secret을 전달하지 않습니다. 운영자는 `/auth/session`으로 로그인하고(legacy `ADMIN_API_KEY` 또는 admin 스코프 secret), 서버는 HTTP-only 세션 쿠키로 교환합니다. **`/dashboard`가 권장 진입점**이며, **`/graph`를 직접 열어도 같은 세션 모델로 로그인/재인증**할 수 있습니다. **브라우저 세션이 생긴 뒤에만 그래프 화면이 열립니다.** 두 정적 페이지 모두 secret을 JavaScript로 부트스트랩하지 않습니다.
- **CORS**: `CORS_ALLOWED_ORIGINS` 환경 변수로 허용 오리진을 제한할 수 있습니다. 비어 있으면 크로스 오리진 요청을 허용하지 않습니다.

## 다중 에이전트 owner scope (HTTP)

- **`/tools/recall`·`/tools/memory_injection`**: 기본 `MEMENTO_OWNER_SCOPE_MODE=strict` — `owner_id` 미지정 시 `X-Memento-Agent-Id` 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID`로 자동 필터. 식별자가 없으면 **400**.
- **레거시 opt-out**: `owner_id = NULL` 데이터를 HTTP recall에서 전역 조회하려면 `MEMENTO_OWNER_SCOPE_MODE=warn`(경고만) 또는 `off`(강제 없음)로 완화하세요. 상세: [`docs/guides/ko/multi-agent-usage.md`](../../guides/ko/multi-agent-usage.md).

## HTTP programmatic 감사 로그 (JSONL + hash chain)

- **범위**: `/tools/*`, `/api/v1/agent/*`, `/api/v1/quality/*`, `/api/v1/maintenance/*`, `/api/v1/audit/*`, 보호된 MCP HTTP 경로(`/mcp`, `/messages`)의 programmatic 호출을 JSONL과 SQLite hash chain에 기록합니다. MCP stdio tool dispatch도 SQLite chain에 기록합니다.
- **기본 경로**: `MEMENTO_HTTP_AUDIT_LOG_PATH` 미설정 시 DB 파일과 같은 디렉터리의 `http-audit.jsonl` (`{dirname(DB_PATH)}/http-audit.jsonl`).
- **JSONL 필드 계약**: `{ ts, key_id, route, tool, owner_id, agent_id, latency_ms, status }`. SQLite `audit_log`는 `transport`, `action`, `target_uri`, evidence/coverage 상태, `previous_hash`, `current_hash`를 추가합니다. raw credential·argument·output·memory content는 기록하지 않습니다.
- **key_id**: `req.programmaticAuth.keyId`(향후 #662 API 키 테이블) 우선, 없으면 Bearer/X-API-Key 자격 증명 SHA-256 접두(12자), 비표준 `Authorization`은 `legacy-key`, 브라우저 세션 쿠키는 `session`, 그 외 `anonymous`.
- **정책**: JSONL은 `MEMENTO_HTTP_AUDIT_MODE=best-effort`로 유지합니다. SQLite chain은 `MEMENTO_AUDIT_MODE=best-effort`가 기본이며, `strict`에서는 actor/table coverage를 확보하지 못한 `delete`·`admin`을 실행 전에 거절합니다. `auth_denied`는 이미 401/403으로 거절된 상태로, 가능한 경우 불완전 record를 남깁니다.
- **owner_id / agent_id**: 요청 body의 `owner_id`·`agent_id`, 헤더 `X-Memento-Agent-Id`·`X-Agent-Id`, ToolContext(`agentId`)에서 best-effort 추출합니다.
- **조회·보존**: `/api/v1/audit/entries`, `/api/v1/audit/export`는 `admin:destructive` scope가 필요합니다. append-only chain에는 자동 purge가 없으므로 DB backup과 verified export archive를 사용합니다. 자세한 evidence/retention 정책은 [해시 체인 감사 로그](./audit-log.md)를 보세요.

## HTTP rate limit

- **버킷**: `/tools/*`와 `/admin/*`는 **별도** 한도입니다 (`express-rate-limit`, 15분 고정 창).
- **기본값**: tools 100회/15분, admin 30회/15분.
- **환경 변수**: `MEMENTO_HTTP_RATE_LIMIT_TOOLS`, `MEMENTO_HTTP_RATE_LIMIT_ADMIN` (정수, 창당 최대 요청 수). `MEMENTO_HTTP_RATE_LIMIT_DISABLED=1` 또는 `NODE_ENV=test`면 비활성화.
- **429 응답**: 초과 시 `429 Too Many Requests`와 `Retry-After`(초) 헤더를 반환합니다.

## 파일 기반 시크릿 (File-based secrets)

운영 환경에서 API 키·토큰을 **환경 변수에 평문으로 두지 않는** 것을 권장합니다.

- **`.env`**: 로컬 개발 전용. Git에 커밋하지 말 것. `.gitignore`에 `.env`가 포함되어 있는지 확인하세요.
- **파일 마운트**: Docker·systemd에서 `secrets/openai_api_key` 같은 파일을 읽고, 컨테이너/프로세스 시작 스크립트가 `export OPENAI_API_KEY="$(cat /run/secrets/openai_api_key)"` 형태로 주입합니다.
- **권한**: 시크릿 파일은 `chmod 600`, 소유자는 서비스 계정만. 로그·stderr에 값이 출력되지 않도록 스크립트를 검토하세요.
- **`MEMENTO_API_TOKENS`**: JSON 배열 전체를 파일로 두고 `MEMENTO_API_TOKENS_FILE=/run/secrets/memento_api_tokens.json`처럼 래퍼 스크립트에서 읽어 env에 설정할 수 있습니다 (공식 env 키는 `MEMENTO_API_TOKENS` — 파일 경로 env는 배포 스크립트 관례).

## Docker secrets

Docker Swarm 또는 Compose secrets로 민감 값을 이미지·compose YAML에 넣지 않습니다.

- **예시**: `docker-compose.prod.secrets.example.yml` — `secrets:` 블록과 `file:` 기반 external secret 정의 (평문 API 키 없음).
- **컨테이너 내 경로**: `/run/secrets/<name>`에 마운트. `start-container.sh` 또는 entrypoint에서 해당 파일을 읽어 `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MEMENTO_API_TOKENS` 등에 주입합니다.
- **볼륨과 분리**: DB 데이터 볼륨(`~/.memento/data`)과 시크릿 마운트를 혼동하지 마세요. 백업·복제 시 시크릿 파일이 포함되지 않게 합니다.

## 유출 방지 체크리스트 (Leak prevention)

| 항목 | 확인 |
|------|------|
| `.env`, `*.pem`, `*api*key*`가 git에 없음 | `git status`, `.gitignore` |
| HTTP audit JSONL에 Bearer 전체가 아닌 `key_id` 해시만 기록 | `http-audit.jsonl` 샘플 검토 |
| `TELEMETRY_STORE_QUERY_PLAINTEXT` 기본 false (recall 쿼리 전문 미저장) | env 확인 |
| 브라우저 대시보드에 API secret 미노출 | `/dashboard` 네트워크 탭 |
| `MEMENTO_HTTP_BIND_HOST` 의도적 노출 시 스코프드 토큰 필수 | 배포 체크리스트 |
| CI 로그에 `ADMIN_API_KEY` 마스킹 | workflow `secrets.*` 사용 |
| DB 백업·export에 시크릿 경로 미포함 | `npm run db:backup` 산출물 검토 |

## SQLCipher / 볼륨 암호화 (선택, 비공식)

Memento는 **공식적으로 SQLCipher 또는 디스크 암호화를 내장하지 않습니다.** 아래는 운영자가 인프라 레벨에서 적용할 때의 참고 메모입니다.

- **SQLCipher**: `better-sqlite3`를 SQLCipher 빌드로 교체하는 것은 **지원되지 않는** 커스텀 빌드 경로입니다. 시도 시 마이그레이션·네이티브 재빌드·호환성을 직접 검증해야 합니다.
- **볼륨 암호화**: LUKS, cloud provider disk encryption, encrypted NFS 등으로 `DB_PATH` 디렉터리가 위치한 볼륨을 암호화하는 방식이 일반적입니다.
- **백업**: 암호화 볼륨의 키 관리(KMS, 오프라인 키)와 `db:backup` 산출물 보관 정책을 함께 문서화하세요.
