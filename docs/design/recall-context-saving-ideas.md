# recall 컨텍스트 절약 아이디어

## 문제

- `recall` 응답 시 조회된 **모든 항목의 전체 데이터**(content, 메타데이터, meta_stats 등)가 한 번에 반환됨.
- LLM 컨텍스트 낭비가 큼. 실제로 필요한 기억만 골라서 보는 패턴이 없음.

## 목표

- recall 응답이 LLM 컨텍스트에 들어가는 **양을 확실히 제한**하여 낭비를 줄인다.

---

## 왜 “목록 + 선택 조회”만으로는 부족한가

이전에 제안한 **list_only + get_memory** 2단계 방식도 **컨텍스트를 충분히 줄이지 못할 수 있다**는 검토 결과를 반영한다.

1. **목록 응답 자체가 컨텍스트를 씀**  
   MCP에서 도구 결과는 전부 LLM 컨텍스트에 들어간다. `list_only`라도 N개 항목의 요약·preview가 있으면 토큰이 쌓인다. `content_preview`를 넣으면 목록만으로도 꽤 큰 payload가 된다.

2. **LLM 행동에 절약이 의존함**  
   “필요한 것만 get_memory로 가져오라”는 설계는, 에이전트가 **일부만 선택**할 때만 이득이 난다. 에이전트가 보수적으로 **전부 필요**하다고 판단하면 `get_memory`를 N번 호출하게 되고, 그때는 **(목록 토큰) + (N개 full)** 이 되어 기존 “N개 full만”보다 오히려 늘어날 수 있다.

3. **선택적 로딩만으로는 상한이 없음**  
   “목록만 주고 선택하게 한다”는 것만으로는 **한 번의 recall 응답 크기 상한**이 생기지 않는다. 목록이 길거나 preview가 길면 첫 응답부터 무거워진다.

따라서 **서버가 응답 크기를 강제로 제한**하는 방식이 LLM이 어떻게 쓰든 컨텍스트를 줄이는 데 유리하다.

---

## 아이디어 요약

| 방안 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **A. recall에 list_only 모드** | `return_format=list_only` 또는 `response_shape=list_only` 추가. 항목당 요약만 반환 | 기존 도구 하나로 해결, 호환 유지 | 상세 조회를 위한 추가 도구 필요 |
| **B. get_memory 도구 신규** | `get_memory(memory_id)` MCP 도구 추가. 단일 기억 상세 조회 | 목록→선택 조회 워크플로 명확 | 도구 수 증가, 호출 횟수 증가 가능 |
| **C. recall에 ID별 상세 조회** | `recall`에 `memory_ids[]` 파라미터 추가. “이 ID들만 full로 반환” | 도구 수 불변, 한 번에 배치 조회 | recall 시맨틱이 “검색 + 선택적 상세”로 복잡해짐 |
| **D. recall 서버 측 토큰 상한** | `max_tokens`/`token_budget` 파라미터로 응답 크기 강제 제한 | LLM 행동과 무관하게 컨텍스트 상한 확보 | 구현 시 직렬화 전 토큰 추정 필요 |
| **E. memory_injection 우선 사용** | "맥락 주입"은 memory_injection, "목록/탐색"만 recall | memory_injection은 이미 token_budget으로 상한 있음 | 에이전트 가이드/프롬프트 변경 필요 |

---

## 권장: 서버 측 상한 + 목적 분리

### 1) [우선] recall에 토큰/크기 상한 도입 (D)

- **파라미터**
  - `max_tokens` 또는 `token_budget`: 응답(JSON 직렬화)이 이 예산을 넘지 않도록 제한.
  - (선택) 초과 분 처리: 예산 초과 시 이후 항목은 **memory_id만** 포함하고, `overflow_ids` 등으로 "추가 항목은 get_memory(id)로 조회" 안내.

- **동작**
  - 검색 결과를 relevance 순으로 돌면서, 항목을 직렬화했을 때의 예상 토큰을 누적.
  - 누적이 `max_tokens`를 넘기 전까지만 full 항목 포함.
  - 넘는 항목부터는 `items`에는 넣지 않고, 별도 필드(예: `more_memory_ids: string[]`)로만 나열.

- **효과**
  - **LLM이 어떻게 쓰든** 한 번의 recall 응답 크기가 상한 이하로 고정됨.
  - list_only처럼 "선택적으로 가져오는" 행동에 의존하지 않아도 절약이 보장됨.

- **참고**
  - `memory_injection`은 이미 `token_budget`으로 서버 측 요약·포맷 후 반환하므로 동일한 "서버 측 상한" 패턴을 recall에도 적용하는 것이다.

### 2) [보조] list_only는 "극소량"만 반환 (A 개선)

- list_only를 쓸 경우에도 **첫 응답이 작아지도록** 설계.
  - 항목당: `memory_id`, `type`, `created_at`, `tags` 정도만.
  - **content_preview는 제거하거나 최대 20자 수준**으로 제한 (preview만으로도 목록이 커지므로).
- 상세가 필요하면 `get_memory(memory_id)` 사용 (B: get_memory 도구 신규는 유지).

### 3) [사용 패턴] memory_injection vs recall 역할 분리 (E)

- **작업 맥락이 필요할 때**  
  이 쿼리/작업에 맞는 기억만 요약해서 넣어줘 → **memory_injection(query, token_budget)** 사용.  
  recall의 full 덤프를 쓰지 않으면, 맥락 용도에서의 컨텍스트 낭비가 줄어든다.

- **목록·탐색이 필요할 때만**  
  무슨 기억이 있는지 목록이 필요해 → recall 사용.  
  이때는 위 1)의 **max_tokens**로 recall 응답 자체를 제한.

- 에이전트/시스템 프롬프트에 맥락은 memory_injection, 목록/탐색은 recall로 안내하면 recall 풀 덤프 사용 빈도가 줄어든다.

- **get_memory** (B): 목록에서 선택한 항목만 상세 조회할 때 사용. pin/unpin/forget 등에서 쓰는 getMemoryById 패턴을 MCP 도구로 노출.

---

## 요약

| 접근 | 역할 |
|------|------|
| **recall + max_tokens** | 한 번의 recall 응답이 넘치지 않도록 **강제 상한**. 가장 확실한 절약. |
| **list_only(극소)** + **get_memory** | 2단계 조회 시 첫 응답을 최소한으로만. 선택적. |
| **memory_injection 우선** | 맥락 용도는 token_budget 있는 도구로 처리해 recall 풀 덤프 사용 감소. |

---

## 구현 시 참고

- **recall 반환 형식**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`의 `processSearchResults`, `createSuccessResult` 구조.
- **return_format**: 동일 파일에 `return_format`(full / steps_only) 이미 존재. 여기에 `list_only` 분기 추가.
- **getMemoryById**: `pin-tool.ts`, `unpin-tool.ts`, `forget-tool.ts` 등에서 사용. 동일 DB/컨텍스트를 쓰는 새 도구 `get-memory-tool.ts`에서 재사용하면 됨.
- **클라이언트**: `packages/memento-client`의 `getMemory(id)`는 현재 recall로 우회 중. MCP에 `get_memory`가 생기면 해당 도구를 호출하도록 변경 가능.

---

## 관련

- Memento MCP: recall은 **max_tokens**로 응답 상한, 맥락은 **memory_injection** 우선 사용으로 컨텍스트 절약.
- list_only(극소) + get_memory는 보조 수단.
