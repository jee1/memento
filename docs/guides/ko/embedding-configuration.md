# 임베딩 설정 가이드

`recall`과 `remember`는 같은 임베딩 스택을 탑니다. **stdio MCP**, **HTTP 관리 서버**, **CLI** 중 어떤 방식으로 기동하든 환경 변수 한 세트가 제공자를 결정하므로, 저장소 루트 `.env`에 두거나 셸에서 export한 뒤 프로세스를 시작하면 됩니다.

## 설정 개요

아래 절에서는 `EMBEDDING_PROVIDER` 값별로 필요한 변수와 예시를 정리합니다.

## EMBEDDING_PROVIDER

사용할 임베딩 제공자를 지정합니다. 유효한 값은 `tfidf`, `lightweight`, `minilm`, `openai`, `gemini`입니다.

```bash
EMBEDDING_PROVIDER=minilm   # 기본값
```

`tfidf`와 `lightweight`는 동일한 TF-IDF 기반 제공자를 가리키는 별칭입니다. 어느 쪽을 사용해도 동일하게 동작합니다.

이 값을 설정하지 않으면 `minilm`이 기본값으로 사용됩니다.

## 제공자별 필수 설정

### tfidf / lightweight / minilm

추가 설정이 필요하지 않습니다. 로컬에서 실행되며 외부 API 없이 동작합니다.

```bash
EMBEDDING_PROVIDER=minilm
```

### openai

OpenAI API 키와 모델을 설정합니다.

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=text-embedding-3-small   # 기본값: text-embedding-3-small
```

`OPENAI_MODEL`은 임베딩 전용 모델을 지정합니다. `text-embedding-3-small`(1536차원)과 `text-embedding-3-large`(3072차원) 중에서 선택할 수 있으며, 비용 대비 성능 면에서 `text-embedding-3-small`이 권장됩니다.

### gemini

Google AI API 키와 모델을 설정합니다.

```bash
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=text-embedding-004   # 기본값: text-embedding-004
```

`GEMINI_MODEL`은 임베딩 전용 모델입니다. LLM 추론에 사용되는 Gemini 모델은 `GEMINI_LLM_MODEL`로 별도 설정합니다.

## EMBEDDING_DIMENSIONS

임베딩 벡터의 차원 수를 명시적으로 지정합니다. 일반적으로 설정하지 않아도 되며, 각 제공자는 고정된 기본 차원을 사용합니다.

| 제공자 | 기본 차원 |
|-------|---------|
| tfidf / lightweight | 512 |
| minilm | 384 |
| openai (text-embedding-3-small) | 1536 |
| gemini (text-embedding-004) | 768 |

```bash
# 일반적으로 설정 불필요 — 제공자 기본값이 자동 사용됨
EMBEDDING_DIMENSIONS=384
```

이 값을 명시하는 경우는 제공자의 기본값을 재정의해야 할 특수한 상황(예: 일부 OpenAI 모델의 차원 축소 옵션 사용)으로 제한하는 것이 좋습니다.

## 폴백 동작

지정한 제공자가 사용 불가능한 경우(API 키 없음, 네트워크 오류 등) Memento는 다음 순서로 자동 폴백합니다.

1. `EMBEDDING_PROVIDER`에 지정된 제공자
2. minilm (로컬 무료)
3. tfidf (로컬 무료, 최후 수단)

폴백 발생 시 경고 로그가 기록됩니다. API 키가 있는 유료 제공자를 설정했더라도, 그 제공자가 실패하면 무료 로컬 제공자로 자동 전환되므로 서비스 중단 없이 동작합니다.

## 차원 일관성 주의사항

임베딩 차원이 다른 제공자로 전환하면 기존에 저장된 벡터와 새로 생성되는 벡터의 차원이 달라집니다. 차원이 다른 벡터 간의 유사도 계산은 의미가 없으므로, 제공자를 변경할 때는 다음 중 하나를 선택하세요.

- 기존 DB를 초기화하고 새로 시작합니다.
- 기존 기억 항목의 임베딩을 모두 재생성합니다.

단순히 환경 변수만 바꾸고 기존 데이터를 그대로 사용하면 검색 품질이 저하될 수 있습니다.

## 완성된 설정 예시

### 로컬 전용 (API 없음, 권장 기본 설정)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### OpenAI 기반 (최고 품질)

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=text-embedding-3-small
OPENAI_LLM_MODEL=gpt-4o-mini
LLM_PROVIDER=openai
```

### Gemini 기반

```bash
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=text-embedding-004
GEMINI_LLM_MODEL=gemini-2.0-flash
LLM_PROVIDER=gemini
```

## 관련 문서

- [임베딩 서비스 개요](./embedding-service-guide.md)
- [LLM 프로바이더 설정 가이드](./llm-provider-configuration.md)
