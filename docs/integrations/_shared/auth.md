# Authentication

이 문서는 **HTTP 트랙** 사용자를 대상으로 합니다. stdio 트랙은 비서가 Memento를 자식 프로세스로 spawn하므로 인증이 필요 없습니다 ([`./transports.md`](./transports.md) 참조).

Memento HTTP 서버의 핵심 사실 한 가지를 먼저 짚고 시작합니다.

> **현재 구현은 단일 공유 비밀(`ADMIN_API_KEY`) 모델입니다.** 사용자별·비서별로 다른 토큰을 발급하는 메커니즘은 아직 없습니다. 이 비밀 하나가 `Authorization: Bearer …`와 `X-API-Key: …` 양쪽 헤더로 동일하게 받아들여지며, 모든 비서가 같은 값을 공유합니다. 자세한 신뢰 모델은 [`../../reference/ko/security.md`](../../reference/ko/security.md)를 참조하세요.

이 문서는 그 단일 비밀을 **어떻게 만들고, 어디에 저장하고, 언제 갈아끼울지**에 대한 가이드입니다.

---

## Bearer 토큰 vs X-API-Key

코드 상 두 헤더는 **동일한 비밀(`ADMIN_API_KEY`)을 받는 별칭**입니다. 다른 권한·다른 토큰이 아니라, 클라이언트가 어느 헤더로 보내느냐의 차이일 뿐입니다.

| 항목 | `Authorization: Bearer <key>` | `X-API-Key: <key>` |
|---|---|---|
| 받는 비밀 | `ADMIN_API_KEY` | `ADMIN_API_KEY` (동일 값) |
| 적용 라우트 | `/mcp`, `/messages`, `/tools/*`, `/api/v1/quality/*` | 동일 |
| MCP 비서 통합 | **권장** (대부분 MCP HTTP 클라이언트의 표준) | 가능하지만 비표준 |
| `curl`/스크립트 | 가능 | 가능 |
| 브라우저 대시보드 | 사용하지 않음 (`/auth/session`로 쿠키 발급) | 사용하지 않음 |

**권장**: 비서 등록은 `Authorization: Bearer`를 사용하세요. `transports.md`의 등록 스니펫과 일치하고, 대부분의 MCP HTTP 구현이 `headers.Authorization` 키로 토큰을 주입합니다. `X-API-Key`는 임시 디버깅이나 사용자 정의 스크립트에서 편할 때만 쓰세요.

---

## 토큰 발급

### 현재 구현의 한계

- Admin UI에 **"토큰 발급" 페이지는 존재하지 않습니다**. `/admin` 대시보드는 telemetry·graph·relations 조회용이며, 토큰 목록 화면이 없습니다.
- 토큰 발급/관리 **CLI 서브커맨드는 없습니다**. `memento` CLI는 `recall|remember|forget|memory_injection`만 지원하고, `memento-setup` 스크립트도 `ADMIN_API_KEY`를 다루지 않습니다.
- 토큰은 SQLite에 저장되지 않습니다. 환경변수 한 슬롯에서 직접 읽습니다.

따라서 "발급"은 **운영자가 임의의 강력한 랜덤 문자열을 만들고, 서버 환경변수에 넣는 것**을 의미합니다.

### 발급 절차

```bash
# 1) 32바이트(=64 hex 문자) 랜덤 비밀 생성
openssl rand -hex 32
# 예시 출력: 7c2b9e1a... (실제로는 64자)
```

다른 옵션도 동등합니다.

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**최소 길이 권장**: 32바이트(256비트). 추측 공격에 충분히 안전한 엔트로피.

### 서버에 적용

#### Docker compose (권장)

`docker-compose.prod.yml`이 읽는 `.env` 파일(또는 `docker-compose.override.yml`의 `environment:`)에 추가:

```bash
ADMIN_API_KEY=7c2b9e1a...  # openssl로 생성한 값
```

그리고 컨테이너를 재시작합니다.

```bash
docker compose -f docker-compose.prod.yml up -d
```

#### 베어메탈/직접 실행

서버 프로세스의 환경에 `ADMIN_API_KEY=…`를 export한 뒤 `npm run start:http`로 띄웁니다. systemd unit이라면 `Environment=` 또는 `EnvironmentFile=` 지시자를 사용하세요.

### 발급 검증

```bash
curl -i -H "Authorization: Bearer 7c2b9e1a..." http://localhost:9001/health
```

`200 OK`가 나오면 서버가 살아 있습니다. (`/health`는 인증을 요구하지 않으므로 더 정확한 검증은 `/mcp` 또는 `/api/v1/quality/*`로 하세요.)

```bash
# 잘못된 토큰
curl -i -H "Authorization: Bearer wrong" http://localhost:9001/api/v1/quality/snapshot
# → 401 Unauthorized
```

---

## 비서별 secret 저장 위치

토큰은 **서버에 한 번**, **각 비서 설정에 한 번씩** 들어갑니다. 비서 측 저장은 가능한 한 평문 파일을 피하고 비밀 저장소를 쓰세요. 정확한 경로·키 이름은 비서별 가이드에서 다루며, 여기서는 위치만 정리합니다.

| 비서 | 권장 저장 위치 | 비고 |
|---|---|---|
| **OpenClaw** | OS 환경변수 (`MEMENTO_TOKEN`) 또는 OS keychain | 데스크톱 클라이언트. 평문 config에 직접 넣지 마세요. |
| **NanoClaw** | 컨테이너에 마운트되는 `.env.local` | git ignore 필수. 컨테이너 secret 매니저(예: Docker secrets)도 가능. |
| **ZeroClaw** | OS keychain (macOS Keychain / Windows Credential Manager / libsecret) 또는 HashiCorp Vault | 무인 24/7 봇이므로 disk persistence 필요 시 Vault 권장. |
| 임의 MCP 클라이언트 | 환경변수 → `${MEMENTO_TOKEN}` 형태로 config에서 참조 | config JSON에 토큰을 하드코딩하지 마세요. |

`transports.md`의 등록 스니펫이 `${MEMENTO_TOKEN}`을 참조하는 형태인 이유가 이것입니다. 비서 config 파일을 git에 올리거나 백업하더라도 비밀이 새지 않게 하세요.

---

## 회전

`ADMIN_API_KEY`는 **단일 슬롯**이므로 "이전 키와 새 키가 동시에 유효한 회전"은 지원하지 않습니다. 회전 동안 **모든 비서를 새 키로 같이 갈아야** 인증 단절이 없습니다.

권장 절차:

1. 회전 시간을 정합니다(비서 수가 많으면 짧은 점검창을 알리세요).
2. 새 비밀을 생성합니다.
   ```bash
   NEW_KEY=$(openssl rand -hex 32)
   echo "$NEW_KEY"
   ```
3. 서버 환경(`.env` 또는 compose env)의 `ADMIN_API_KEY`를 새 값으로 교체합니다.
4. 서버를 재시작합니다.
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```
   재시작 직후 기존 토큰을 가진 비서들은 401을 받기 시작합니다.
5. 각 비서의 secret store(위 표 참조)에서 토큰을 새 값으로 갱신하고 비서를 재시작·재로드합니다.
6. 검증: 비서가 한 차례 `recall` 또는 `remember`를 호출해 200을 받는지 확인합니다.

> **팁**: 비서 수가 늘면 회전 비용이 선형으로 커집니다. 다중 토큰 모델은 향후 작업 항목입니다 (현재 미구현).

---

## 폐기

단일 슬롯 모델이므로 폐기 = 회전과 같은 동작입니다.

- **하나의 비서만 폐기하고 싶을 때**: 현재 모델로는 **불가능**합니다. 모든 비서가 같은 비밀을 공유하므로, 한 비서를 차단하려면 회전을 돌리고 *그 비서를 빼고 다시 배포*해야 합니다.
- **전체 폐기**: 서버의 `ADMIN_API_KEY`를 비우거나(`ADMIN_API_KEY=`) 새 값으로 교체한 뒤 재시작합니다. 빈 값으로 두면 programmatic 라우트는 모든 요청에 `401 Unauthorized: Programmatic API is disabled: ADMIN_API_KEY is not configured.` 응답을 줍니다.
- **API를 통한 폐기 엔드포인트는 없습니다**. 환경변수 + 재시작이 유일한 메커니즘입니다.

폐기가 필요한 흔한 시나리오는 비서 호스트(노트북·VPS) 분실입니다. 이 경우 즉시 회전을 돌리고 분실한 디바이스 외 모든 비서에 새 키를 배포하세요.

---

## TLS 검증

### 운영 (외부 노출)

집 밖에서 비서가 접속한다면 TLS는 필수입니다. compose 파일 안의 nginx에 Let's Encrypt 인증서를 마운트하거나, Caddy/Cloudflare Tunnel을 reverse proxy로 두세요. 이 경우 비서의 base URL은 `https://memory.example.com/mcp`가 되며, 비서는 시스템 신뢰 저장소로 인증서를 검증합니다. 추가 설정 없이 동작합니다.

### 개발 (로컬·자체 서명)

루프백/내부망에서만 접속한다면 일반적으로 평문 HTTP로 충분합니다 ([`../../reference/ko/security.md`](../../reference/ko/security.md)는 `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지하라고 권합니다).

자체 서명 인증서를 쓰는 경우:

- 인증서를 OS 신뢰 저장소에 추가하는 것이 **항상 우선** 옵션입니다. 비서 측에서 검증을 끄지 마세요.
- 부득이 검증을 끄는 경우, 끄는 위치는 **비서 클라이언트 한 군데**여야 하며, **로컬 개발 한정**으로 옵트인하세요. Memento 서버 자체는 검증 비활성 모드를 별도로 노출하지 않습니다.
- 운영 환경에 `NODE_TLS_REJECT_UNAUTHORIZED=0` 같은 전역 비활성화 플래그를 두지 마세요. 토큰이 평문으로 새어 나갈 위험을 만듭니다.

---

## 다음 단계

- [`./transports.md`](./transports.md) — HTTP 서버 셋업·엔드포인트·트랙 마이그레이션
- [`./troubleshooting.md`](./troubleshooting.md) — 401, 토큰 누락, 헤더 잘림 등 트러블슈팅
- [`../README.md`](../README.md) — 비서별 통합 가이드 허브 (OpenClaw / NanoClaw / ZeroClaw)
- [`../../reference/ko/security.md`](../../reference/ko/security.md) — HTTP 신뢰 모델·CORS·바인드 호스트 권장
