# Troubleshooting

외부 비서(OpenClaw / NanoClaw / ZeroClaw 등)에 베어 MCP로 Memento를 연동했을 때 자주 부딪히는 이슈와 진단·복구 절차를 모아 둔 문서입니다. 트랜스포트와 인증의 일반 개념은 [`./transports.md`](./transports.md), [`./auth.md`](./auth.md)에서 먼저 다룹니다.

각 섹션은 **증상 → 1차 진단 명령 → 흔한 원인과 처방** 순서로 정리되어 있습니다. 위에서부터 차례로 좁혀 나가세요.

---

## MCP가 응답하지 않음 / 연결 실패

### 증상

- 비서가 도구 호출(`recall`/`remember`)에서 timeout·"server not responding"·"transport closed"를 뱉음.
- stdio 트랙: 비서 시작 시 `memento-mcp-server` 자식 프로세스가 즉시 죽음.
- HTTP 트랙: `/mcp` 호출이 `ECONNREFUSED` 또는 504로 실패.

### 1차 진단

stdio 트랙이라면 비서가 spawn한 자식 프로세스 로그를 먼저 보세요. 로그 위치는 비서마다 다릅니다.

- [OpenClaw 가이드](../openclaw.md) — 데스크톱 앱의 MCP 서버 로그 위치
- [NanoClaw 가이드](../nanoclaw.md) — 컨테이너 stdout/`docker logs`
- [ZeroClaw 가이드](../zeroclaw.md) — 무인 봇 호스트의 systemd journal 또는 PM2 로그

HTTP 트랙은 서버가 살아있는지부터 확인합니다.

```bash
curl -i http://localhost:9001/health
```

`200 OK`와 `{"status":"healthy",...}` 응답이 나오면 서버 자체는 살아있다는 뜻입니다. 응답이 없거나 `connection refused`라면 서버 프로세스가 죽었거나 다른 포트에 바인딩되어 있습니다.

> 참고: 현재 `memento` CLI는 `recall|remember|forget|memory_injection` 4개 서브커맨드만 제공합니다. `npx memento-mcp-server health-check` 같은 별도 서브커맨드는 없으므로 health 점검은 위 `curl` 한 줄로 갈음하세요.

### 흔한 원인과 처방

| 원인 | 확인 방법 | 처방 |
|---|---|---|
| stdio: `npx` 첫 다운로드 지연 | 비서 로그에 `npm warn exec` 라인이 보이는가 | 한 번 직접 `npx memento-mcp-server@latest --help`를 손으로 돌려 캐시 확보 |
| stdio: `better-sqlite3` 네이티브 빌드 실패 | 로그에 `node-gyp`·`gyp ERR!` 등장 | 호스트에 빌드 툴체인 설치(macOS: Xcode CLT, Linux: `build-essential`+`python3`), Node 버전을 LTS로 |
| stdio: `~/.memento` 권한 없음 | `EACCES` / `EPERM` | `chown -R "$USER" ~/.memento` |
| HTTP: 컨테이너가 다른 포트로 떠 있음 | `docker compose ps` | 비서 config의 `url`을 실제 매핑된 포트로 |
| HTTP: 9001을 다른 프로세스가 점유 | `lsof -i :9001` | `MCP_SERVER_PORT`로 다른 포트 지정 후 재기동 |
| HTTP: 서버는 떴으나 `/mcp`만 401 | `/health`는 200, `/mcp`는 401 | 인증 문제로 분류 — [§ 401 Unauthorized](#401-unauthorized) 참조 |

서버 측 상세 로그는 [§ 디버그 로그 활성화](#디버그-로그-활성화)에서 다룹니다.

---

## recall 결과가 비어있음

### 증상

- `recall(query=...)`이 빈 배열을 돌려줌.
- 직전 세션에서 `remember`를 분명히 호출했는데 다음 세션에서 안 보임.
- 기억은 저장되지만 검색 점수가 비정상적으로 낮음.

### 1차 진단

저장이 되긴 했는지부터 확인합니다. 같은 환경에서 CLI로 직접 회상해 봅니다.

```bash
npx memento-mcp-server@latest recall --query "테스트 키워드"
```

서버가 살아있고 같은 `DB_PATH`를 본다면 결과가 나와야 합니다. 결과가 비어 있으면 다음 세 가지를 차례로 확인하세요.

1. **데이터 파일 위치가 일치하는가**
   - stdio 기본: `~/.memento/memory.db` (그리고 동일 디렉터리의 `memory.db-wal`, `memory.db-shm`).
   - Docker 기본: 컨테이너 내부 `/app/data/memory.db` (호스트 볼륨에 마운트됨).
   - 비서가 stdio로 띄운 자식 프로세스와 별도로 띄운 HTTP 서버가 **다른 DB를 보고 있으면** 회상이 비어 보일 수 있습니다. `DB_PATH` 환경변수를 양쪽에 동일하게 고정하세요 ([`./transports.md`](./transports.md#트랙-전환--마이그레이션) 참조).

2. **임베딩 프로바이더가 무엇인가**
   - `OPENAI_API_KEY` / `GEMINI_API_KEY`를 안 넣었다면 lightweight 임베딩(로컬 폴백)으로 동작합니다. 의미 검색 품질은 키워드 기반 폴백 수준에 가깝습니다.
   - 외부 키를 넣었는데도 호출 실패가 잦다면 임베딩이 비어 저장됐을 수 있습니다 — 서버 로그에서 `embedding`/`provider` 단어를 찾아 실패 메시지를 확인하세요.
   - 자세한 동작과 진단 절차는 [`../../reference/ko/embedding-provider-issues.md`](../../reference/ko/embedding-provider-issues.md)를 참조하세요. (현재 빌드에는 `/admin/providers` 라우트가 없으므로 환경변수와 로그로 확인합니다.)

3. **검색 범위가 너무 좁지 않은가**
   - `recall`에 `tags` 필터를 걸었다면 풀어 보세요. 시스템 프롬프트가 채널 태그를 자동 부여하면 다른 채널 기억이 안 잡힙니다([`./system-prompt.md`](./system-prompt.md)).
   - `owner_id`가 다르면 보이지 않습니다 — 같은 사람이 같은 비서로 부른 게 맞는지 확인하세요.

### 처방 요약

- DB 경로 통일 → 같은 SQLite 파일을 보게 한다.
- 임베딩 키 설정 또는 lightweight 임베딩의 한계를 이해하고 키워드를 더 구체적으로 입력한다.
- 필터(`tags`, `owner_id`)를 풀고 다시 시도한다.

---

## 401 Unauthorized

### 증상

- HTTP 트랙에서 `/mcp`·`/messages`·`/api/v1/quality/*` 호출이 `401 Unauthorized`로 실패.
- 비서 측 에러 메시지에 `Authorization`·`Bearer`·`API key` 같은 단어가 등장.
- 서버 로그에 `ADMIN_API_KEY is not configured` 또는 토큰 불일치 경고.

### 1차 진단

```bash
# 토큰 없이 호출 — 401이 나오면 인증 게이트는 정상
curl -i http://localhost:9001/api/v1/quality/snapshot

# 비서가 쓰는 것과 같은 토큰으로 호출 — 200이 나와야 정상
curl -i -H "Authorization: Bearer $MEMENTO_TOKEN" http://localhost:9001/api/v1/quality/snapshot
```

토큰을 직접 명령에 박아 넣지 말고 환경변수를 통해 주입하세요. 셸 히스토리·`ps` 출력·로그 어디에도 토큰이 평문으로 남지 않습니다.

### 흔한 원인과 처방

| 원인 | 처방 |
|---|---|
| 비서 config에 토큰 자체가 누락 | [`./auth.md`](./auth.md#비서별-secret-저장-위치)의 저장 위치 표대로 비밀 저장소·환경변수에 넣고 config는 `${MEMENTO_TOKEN}`로 참조 |
| 서버 측 `ADMIN_API_KEY`가 비어있거나 다른 값 | 서버 환경변수 확인 후 [`./auth.md`](./auth.md#서버에-적용)의 적용 절차로 갱신·재시작 |
| 회전 직후 비서들이 옛 토큰을 그대로 보냄 | [`./auth.md`](./auth.md#회전) 절차대로 모든 비서를 새 키로 동시 갱신 |
| `Authorization` 헤더가 reverse proxy에서 잘림 | nginx의 `proxy_set_header Authorization $http_authorization;` 명시, Cloudflare는 "Authenticated Origin Pulls" 같은 변환 비활성화 |
| `Bearer ` 접두어 누락 또는 공백 한 칸 빠짐 | 헤더 값이 정확히 `Bearer <key>` 형태인지 확인. 공백 한 칸이 필수 |
| 잘못된 헤더 키(`X-Api-Key` 대소문자 등) | `X-API-Key`(코드 기준)와 `Authorization: Bearer <key>` 둘 중 하나로 통일 |

토큰 발급/회전/폐기의 일반 절차는 모두 [`./auth.md`](./auth.md)에서 다룹니다.

---

## TLS 인증서 오류

### 증상

- 비서 측에서 `unable to verify the first certificate`, `self-signed certificate`, `CERT_HAS_EXPIRED` 같은 메시지.
- HTTPS base URL로 바꿨더니 갑자기 `recall`이 모두 실패.

### 1차 진단

```bash
# 서버까지 TLS 핸드셰이크가 정상인지
curl -vI https://memory.example.com/health
```

핸드셰이크 자체가 실패하면 reverse proxy 설정 문제이고, 핸드셰이크는 되는데 비서만 실패한다면 비서 호스트의 신뢰 저장소 문제입니다.

### 흔한 원인과 처방

| 상황 | 권장 처방 |
|---|---|
| 외부에서 접속하는 운영 환경 | **Let's Encrypt** 인증서를 reverse proxy(nginx, Caddy, Cloudflare Tunnel)에 마운트하세요. Caddy를 쓰면 자동 발급·갱신을 사실상 0설정으로 처리할 수 있습니다 |
| 내부망/VPN에서 자체 서명을 써야 함 | 인증서를 비서 호스트의 OS 신뢰 저장소에 추가 (macOS Keychain Access, Linux `update-ca-certificates`, Windows `certmgr.msc`). 검증을 끄지 마세요 |
| 부득이하게 검증을 끄는 로컬 개발 | 비서 클라이언트 한 군데에서만 옵트인. `NODE_TLS_REJECT_UNAUTHORIZED=0` 같은 전역 플래그를 운영에 두지 마세요 ([`./auth.md`](./auth.md#tls-검증)) |
| 인증서 만료 | reverse proxy 갱신 자동화 (Let's Encrypt + cron / Caddy 자동 갱신) |
| Cloudflare Tunnel + origin TLS | tunnel 종단까지만 TLS이고 origin은 평문일 수 있음 — `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지해 외부 노출을 막으세요 |

권장 순위: **Let's Encrypt + reverse proxy → OS 신뢰 저장소 등록 → 검증 비활성화는 최후 수단**.

---

## 멀티 디바이스 기억 동기화 안됨

### 증상

- 노트북에서 저장한 사실이 데스크톱·홈서버 비서에서 안 보임.
- 두 비서 모두 `recall`은 동작하지만 결과 집합이 디바이스마다 다름.

### 1차 진단

각 디바이스에서 비서가 실제로 어디에 붙고 있는지부터 확인하세요. 가장 흔한 함정은 "둘 다 stdio로 자기 머신의 SQLite를 보고 있다"는 상황입니다.

```bash
# 각 디바이스에서
echo "$MEMENTO_BASE_URL"   # 비서가 참조하는 base URL (있다면)
```

그리고 양쪽이 같은 HTTP base URL을 쓰는지, 같은 토큰을 쓰는지, 같은 사용자 식별자(`owner_id`)를 쓰는지 한 번에 확인합니다.

### 흔한 원인과 처방

| 원인 | 처방 |
|---|---|
| 둘 다 stdio 트랙이라 각자 로컬 SQLite를 봄 | HTTP 트랙으로 마이그레이션 ([`./transports.md`](./transports.md#stdio--http-마이그레이션)) |
| HTTP 트랙이지만 디바이스마다 다른 base URL | 비서 config에서 `url`을 한 호스트로 통일 |
| 같은 base URL이지만 다른 `owner_id` 태그 | 시스템 프롬프트에서 `<현재_사용자>` 토큰이 디바이스마다 다르게 렌더링되는지 점검 ([`./system-prompt.md`](./system-prompt.md#채널사용자-태그-치환)) |
| 채널 태그(`channel:desktop` 등)로 필터가 좁혀져 다른 채널 기억이 빠짐 | `recall` 호출 시 채널 필터를 풀거나, 채널을 의도적으로 분리하려는 게 맞는지 재확인 |
| 한쪽이 옛 토큰이라 401만 받고 있음 | [§ 401 Unauthorized](#401-unauthorized) 절차로 토큰 갱신 |

동시에 양쪽 트랜스포트(stdio + HTTP)가 같은 SQLite를 잡으면 WAL 충돌이 날 수 있습니다. 한쪽을 내리고 다른 쪽을 올리세요 ([`./transports.md`](./transports.md#동시에-양쪽을-띄워도-되는가)).

---

## 디버그 로그 활성화

서버 측 상세 로그는 환경변수 `LOG_LEVEL`로 제어합니다 (코드상 실제 사용되는 변수명). `MEMENTO_LOG`라는 이름은 사용되지 않으니 주의하세요.

```bash
LOG_LEVEL=debug npm run start:http
```

Docker compose라면 서비스의 `environment:`에 다음을 추가하고 재기동:

```yaml
environment:
  - LOG_LEVEL=debug
```

stdio 트랙은 비서가 spawn할 때 환경변수를 함께 넘기도록 비서별 설정을 수정해야 합니다. 비서 가이드의 MCP 등록 스니펫에 `env` 블록이 있는지 확인하세요.

> **토큰 노출 주의**: 디버그 모드에서도 절대 `Authorization` 헤더 값을 직접 출력하지 마세요. 로그를 외부로 옮기기 전에 grep으로 한 번 검토합니다.
>
> ```bash
> grep -Ei "authorization|bearer|x-api-key|admin_api_key" server.log
> ```
>
> 만약 토큰이 보인다면 즉시 [`./auth.md`](./auth.md#회전) 절차로 회전하고, 로그 수집 파이프라인의 마스킹 정책을 점검하세요.

debug 레벨은 그래프 빌드·임베딩 호출·SQL 호출까지 출력해 양이 많습니다. 평소에는 `info`로 두고, 재현되는 이슈를 좁힐 때만 `debug`로 올리세요.

---

## 진단용 한 줄 명령 모음

이슈가 어디서 끊기는지 빠르게 좁힐 때 쓰는 cookbook입니다. 토큰은 환경변수로 주입한다고 가정합니다 (`export MEMENTO_TOKEN=...`).

```bash
# 1) 서버 살아있는가
curl -i http://localhost:9001/health

# 2) MCP 라우트가 인증을 기대하는가 (401이 나와야 정상)
curl -i http://localhost:9001/api/v1/quality/snapshot

# 3) 내가 가진 토큰이 그 서버에서 유효한가 (200이 나와야 정상)
curl -i -H "Authorization: Bearer $MEMENTO_TOKEN" \
  http://localhost:9001/api/v1/quality/snapshot

# 4) CLI로 회상이 되는가 (서버가 살아있고 같은 DB를 봐야 함)
npx memento-mcp-server@latest recall --query "ping"

# 5) 포트 점유 누가 하고 있나
lsof -i :9001 || ss -ltnp | grep 9001

# 6) Docker 컨테이너 상태와 로그 끝부분
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 memento

# 7) 로그에서 토큰이 새고 있지 않은지 (반드시 빈 결과여야 함)
grep -Ei "authorization|bearer|x-api-key" /path/to/server.log
```

문제가 좁혀지지 않으면 디버그 로그로 한 번 더 재현해 위 명령을 다시 돌리세요.

---

## 다음 단계

- [`./transports.md`](./transports.md) — stdio·HTTP 트랜스포트 셋업과 트랙 전환
- [`./auth.md`](./auth.md) — 토큰 발급·저장·회전·폐기·TLS
- [`./system-prompt.md`](./system-prompt.md) — recall/remember 호출을 유도하는 권장 프롬프트
- [`../README.md`](../README.md) — 비서별 통합 가이드 허브
- [`../../reference/ko/embedding-provider-issues.md`](../../reference/ko/embedding-provider-issues.md) — 임베딩 프로바이더 동작·진단
- [`../../reference/ko/security.md`](../../reference/ko/security.md) — HTTP 신뢰 모델·CORS·바인드 호스트 권장
