# LLM 프로바이더 설정 가이드

## LLM이 필요한 이유

Memento는 기억을 단순히 저장하고 꺼내는 것 이상을 수행합니다. 새로운 기억을 저장할 때 기존 기억들과의 관계를 추출하고, 장기 보관 가치가 있는 지식을 episodic에서 semantic으로 공고화하며, 절차 기억의 내용을 분석합니다. 이 모든 지능형 처리에 LLM이 사용됩니다.

임베딩 제공자(텍스트를 벡터로 변환)와 LLM 제공자(추론 및 텍스트 생성)는 독립적으로 설정됩니다. 예를 들어 임베딩은 로컬 minilm을 사용하면서 관계 추출에는 Ollama를 쓰는 조합이 가능합니다.

## 기본 설정

`LLM_PROVIDER` 환경 변수로 사용할 LLM 제공자를 지정합니다.

```bash
LLM_PROVIDER=auto   # 기본값: auto
```

유효한 값은 `openai`, `gemini`, `ollama`, `auto`입니다. `auto`는 사용 가능한 제공자를 우선순위에 따라 자동으로 선택합니다.

## 제공자별 설정

### Ollama (로컬 무료)

Ollama는 로컬에서 실행되는 오픈소스 LLM 런타임입니다. API 비용 없이 다양한 모델을 사용할 수 있습니다.

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434   # 기본값
OLLAMA_MODEL=llama3                      # 기본값
```

Ollama를 사용하려면 먼저 `ollama serve`로 데몬을 실행하고, `ollama pull llama3`으로 모델을 다운로드해야 합니다. Memento는 초기화 시 `OLLAMA_BASE_URL/api/tags`에 GET 요청을 보내 연결을 확인합니다. 연결 확인이 실패하면 경고 로그와 함께 폴백이 수행됩니다.

### OpenAI

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_LLM_MODEL=gpt-4o-mini   # 기본값
```

`OPENAI_LLM_MODEL`은 LLM 추론 전용입니다. 임베딩에 사용되는 `OPENAI_MODEL`과 별개입니다.

### Gemini

```bash
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_LLM_MODEL=gemini-2.0-flash   # 기본값
```

`GEMINI_LLM_MODEL`은 LLM 추론 전용입니다. 임베딩에 사용되는 `GEMINI_MODEL`과 별개입니다.

### auto (자동 선택)

`LLM_PROVIDER=auto`로 설정하면 다음 순서로 사용 가능한 제공자를 자동 선택합니다.

1. OpenAI — `OPENAI_API_KEY`가 있으면 선택
2. Gemini — OpenAI를 쓸 수 없고 `GEMINI_API_KEY`가 있으면 선택
3. Ollama — 클라우드 API가 모두 없으면 로컬 Ollama 연결을 시도

## 제공자 선택 우선순위

동일한 환경 변수를 여러 곳에서 설정하는 경우 다음 우선순위로 결정됩니다.

1. 런타임에 `export LLM_PROVIDER=...`로 설정한 환경 변수
2. `.env` 파일에 설정된 값
3. 코드 기본값 (`auto`)

## 용도별 모델 오버라이드

Memento는 네 가지 LLM 사용 용도가 있으며, 각 용도에 다른 모델을 지정할 수 있습니다. 이는 비용과 품질을 용도에 맞게 조정할 때 유용합니다. 예를 들어 트리플 추출에는 저렴한 소형 모델을, 공고화에는 더 정교한 모델을 쓸 수 있습니다.

```bash
# 용도별 모델 오버라이드 (선택사항)
LLM_MODEL_TRIPLE_EXTRACTION=     # 트리플 추출
LLM_MODEL_RELATION_EXTRACTION=   # 관계 추출
LLM_MODEL_PROCEDURAL=            # 절차 기억 처리
LLM_MODEL_CONSOLIDATION=         # episodic → semantic 공고화
```

이 값들은 설정 시 해당 용도에서 제공자 기본 모델(`OPENAI_LLM_MODEL`, `GEMINI_LLM_MODEL`, `OLLAMA_MODEL`)보다 우선합니다. 설정하지 않으면 제공자 기본 모델이 사용됩니다.

모델 선택 순서를 정리하면 다음과 같습니다.

1. 해당 용도의 `LLM_MODEL_*` 환경 변수 (설정된 경우) — **단, 런타임 제공자가 모델이 묶인 제공자(아래 바인딩 규칙)와 같을 때만**
2. 제공자의 기본 LLM 모델 (`OPENAI_LLM_MODEL` 등)
3. 코드 하드코딩 기본값 (gpt-4o-mini, gemini-2.0-flash, llama3)

빈 문자열·공백만 있는 `LLM_MODEL_*` 값은 미설정과 같습니다.

## 용도별 제공자 오버라이드

트리플 추출·관계 추출·절차 기억(procedural)에 대해 전역 `LLM_PROVIDER`와 다른 제공자를 선호할 수 있습니다. (공고화 consolidation·personal-agent·임베딩은 이 축과 무관합니다.)

```bash
# 용도별 제공자 오버라이드 (선택사항; 미설정·빈 값 → 전역 LLM_PROVIDER)
LLM_PROVIDER_TRIPLE_EXTRACTION=     # openai | gemini | ollama | auto
LLM_PROVIDER_RELATION_EXTRACTION=
LLM_PROVIDER_PROCEDURAL=
```

동작 요약:

- **정규화**: 앞뒤 공백 제거 후 소문자. 허용 토큰은 전역 `LLM_PROVIDER`와 동일 (`openai` / `gemini` / `ollama` / `auto`).
- **잘못된 값**: 해당 용도 오버라이드를 무시하고 전역 경로를 쓰며, 설정 로드/초기화 시 `[CONFIG WARN]`을 **설정당 한 번** 남깁니다. 프로세스를 중단하지 않습니다.
- **prefer-then-fallback**: 유효한 오버라이드는 그 용도의 **선호** 제공자입니다. 사용 불가면 기존 폴백 정책을 따르며, “절대 폴백 금지” 모드는 없습니다.
- **전역과 동일 값**: 유효한 no-op입니다 (바인딩·Ollama readiness에 그대로 쓰입니다).
- **Ollama readiness**: 전역이 클라우드여도, 위 세 오버라이드 중 하나라도 `ollama`이면 초기화 시 Ollama 연결 검사를 수행합니다.

### 모델 오버라이드 바인딩 (폴백 시 모델명 누수 방지)

`LLM_MODEL_*`는 다음 **바인딩 제공자**에만 적용됩니다.

1. 해당 용도에 유효한 `LLM_PROVIDER_*`가 있으면 → 그 제공자
2. 없으면 → 그 호출에서 해석된 전역 기본 제공자

런타임 제공자가 바인딩 제공자와 달라지면(폴백 등) 해당 `LLM_MODEL_*`는 **적용하지 않고** 런타임 제공자의 기본 모델을 쓰며, 이 결정은 구조화 로그로 관측됩니다. 모델 폐기만으로 작업이 실패하지는 않습니다.

## 폴백 동작

각 제공자에 대한 폴백 동작은 다음과 같습니다.

`LLM_PROVIDER=openai`로 설정했는데 OpenAI 초기화가 실패하면, Gemini API 키가 있으면 Gemini로 자동 전환됩니다.

`LLM_PROVIDER=gemini`로 설정했는데 Gemini 초기화가 실패하면, OpenAI API 키가 있으면 OpenAI로 자동 전환됩니다.

`LLM_PROVIDER=ollama`로 설정했는데 Ollama 연결이 실패하면, OpenAI를 먼저 시도하고 그것도 실패하면 Gemini를 시도합니다.

모든 제공자가 실패하면 LLM이 필요한 기능(관계 추출, 공고화 등)은 비활성화되고 경고 로그가 기록됩니다. 기본적인 `remember`와 `recall`은 계속 동작합니다.

## 완성된 설정 예시

### 완전 로컬 (비용 없음)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### 혼합 (임베딩은 로컬, LLM은 클라우드)

```bash
EMBEDDING_PROVIDER=minilm
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_LLM_MODEL=gpt-4o-mini
```

### 완전 클라우드 (최고 품질)

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=text-embedding-3-small
LLM_PROVIDER=openai
OPENAI_LLM_MODEL=gpt-4o-mini
# 공고화에만 고성능 모델 사용
LLM_MODEL_CONSOLIDATION=gpt-4o
```

## 문제 해결

**모든 제공자가 사용 불가능한 경우**: API 키가 설정되어 있는지, Ollama 서버가 실행 중인지 확인하세요. `ollama serve` 명령으로 Ollama를 시작하고, `http://localhost:11434/api/tags`에 접근이 가능한지 브라우저에서 확인해보세요.

**Ollama 연결 실패**: `OLLAMA_BASE_URL`이 올바른지, 방화벽이 해당 포트를 차단하지 않는지 확인하세요. Docker 컨테이너 내에서 실행 중이라면 `http://host.docker.internal:11434`와 같이 호스트 주소를 명시해야 할 수 있습니다.

**폴백이 예상과 다르게 동작**: 런타임 환경 변수가 `.env` 파일보다 우선하므로, `export LLM_PROVIDER=...`로 설정된 값이 있는지 먼저 확인하세요.

## 관련 문서

- [임베딩 설정 가이드](./embedding-configuration.md)
- [임베딩 서비스 개요](./embedding-service-guide.md)
