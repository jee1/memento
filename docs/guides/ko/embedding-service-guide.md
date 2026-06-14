# 임베딩 서비스 가이드

## 임베딩이란 무엇이며 왜 필요한가

Memento는 저장된 기억들을 단순 키워드 매칭이 아닌 의미적 유사도로 검색합니다. 이를 가능하게 하는 핵심 기술이 임베딩입니다. 텍스트를 고차원 숫자 벡터로 변환하면, "React 컴포넌트 생명주기"와 "useEffect 정리 함수"처럼 단어는 다르지만 의미가 가까운 기억들을 연결할 수 있습니다.

Memento의 임베딩 시스템은 `UnifiedEmbeddingService`라는 단일 인터페이스 뒤에 여러 제공자를 추상화합니다. 사용자는 환경 변수 하나로 제공자를 교체할 수 있고, 제공자가 실패하면 자동으로 대안으로 전환됩니다.

## 제공자 비교

Memento는 네 가지 임베딩 제공자를 지원합니다.

**tfidf / lightweight**: TF-IDF 기반의 통계적 임베딩입니다. 평균 0.82ms 수준의 극도로 빠른 속도와 낮은 메모리 사용량(약 4.48MB)이 특징이며, 완전 무료입니다. 512차원 벡터를 생성합니다. 대량 텍스트를 빠르게 처리해야 하거나 리소스가 제한된 환경에 적합합니다. 의미적 이해보다는 어휘 빈도에 의존하므로 검색 정확도는 다른 제공자보다 낮습니다.

**minilm**: 로컬에서 실행되는 경량 신경망 모델입니다. 평균 56ms 내외의 처리 속도로 의미를 실질적으로 이해하며, 완전 무료입니다. 384차원 벡터를 생성합니다. 기본 제공자이며, 대부분의 AI 에이전트 워크플로우에 적합한 성능과 비용의 균형점을 제공합니다.

**openai**: OpenAI의 클라우드 API(`text-embedding-3-small` 등)를 사용합니다. 최고 수준의 의미 이해 능력을 제공하며, 1536차원 벡터를 생성합니다. 유료이며 `OPENAI_API_KEY`가 필요합니다. 복잡한 의미 분석이나 높은 검색 정확도가 요구되는 환경에 적합합니다.

**gemini**: Google의 클라우드 API(`text-embedding-004` 등)를 사용합니다. 768차원 벡터를 생성하며, 다국어 텍스트 처리에 강점이 있습니다. 유료이며 `GEMINI_API_KEY`가 필요합니다.

## 제공자 선택 방법

임베딩 제공자는 `EMBEDDING_PROVIDER` 환경 변수로 지정합니다.

```bash
# .env 파일
EMBEDDING_PROVIDER=minilm   # 기본값
# EMBEDDING_PROVIDER=tfidf
# EMBEDDING_PROVIDER=openai
# EMBEDDING_PROVIDER=gemini
```

설정 우선순위는 다음과 같습니다.

1. 환경 변수 `EMBEDDING_PROVIDER`에 명시된 값을 우선 사용합니다.
2. 설정이 없으면 `minilm`이 기본값으로 사용됩니다.
3. 지정된 제공자가 초기화에 실패하면(예: API 키 누락, 네트워크 오류) 시스템은 자동으로 다음 우선순위 제공자로 폴백합니다. 유료 제공자가 실패하면 무료 제공자(minilm 또는 tfidf)가 최종 대안이 됩니다.

## 환경 변수 요약

```bash
# 임베딩 제공자 선택
EMBEDDING_PROVIDER=minilm        # tfidf | lightweight | minilm | openai | gemini

# OpenAI 임베딩 설정 (EMBEDDING_PROVIDER=openai 사용 시 필요)
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=text-embedding-3-small   # 임베딩 모델 (LLM 모델과 별도)

# Gemini 임베딩 설정 (EMBEDDING_PROVIDER=gemini 사용 시 필요)
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=text-embedding-004       # 임베딩 모델 (LLM 모델과 별도)

# 임베딩 차원 오버라이드 (일반적으로 불필요)
EMBEDDING_DIMENSIONS=384              # 미설정 시 제공자 기본값 사용
```

`OPENAI_MODEL`과 `GEMINI_MODEL`은 임베딩 전용입니다. LLM 추론(관계 추출, 공고화 등)에 사용되는 모델은 별도로 `OPENAI_LLM_MODEL`, `GEMINI_LLM_MODEL`로 설정합니다.

## 폴백 동작

상위 제공자가 실패하면 Memento는 자동으로 대안 제공자로 전환하고 경고 로그를 기록합니다. 예를 들어 `EMBEDDING_PROVIDER=openai`로 설정했는데 `OPENAI_API_KEY`가 없거나 API 호출이 실패하면, 시스템은 minilm 또는 tfidf로 자동 전환됩니다.

이 폴백 동작 덕분에 API 서비스 장애나 키 만료 상황에서도 Memento는 검색 기능을 유지합니다.

## 차원 일관성

임베딩 차원은 데이터베이스와 일관성을 유지해야 합니다. 기존 데이터가 384차원(minilm)으로 저장된 상태에서 1536차원(openai)으로 제공자를 바꾸면 벡터 유사도 검색이 올바르게 동작하지 않습니다. 제공자를 변경할 경우 기존 임베딩을 재생성하거나 새로운 DB로 시작하는 것을 권장합니다.

`EMBEDDING_DIMENSIONS`를 명시적으로 설정하지 않으면 제공자의 기본 차원이 자동으로 사용됩니다.

## 문제 해결

**MiniLM 첫 실행이 느립니다.** 첫 번째 호출 시 로컬에서 모델을 로드하기 때문입니다. 이후 호출은 메모리에 캐시된 모델을 사용하므로 빠릅니다.

**OpenAI/Gemini API 오류가 발생합니다.** API 키가 올바르게 설정되어 있는지, 할당량이 남아 있는지 확인하세요. HTTP 429는 할당량 초과, 401은 키 오류입니다. 오류 발생 시 폴백 제공자로 자동 전환됩니다.

**벡터 차원 불일치 오류가 발생합니다.** 제공자를 교체했을 때 발생할 수 있습니다. DB를 초기화하거나 `EMBEDDING_DIMENSIONS`를 현재 제공자의 기본값에 맞게 설정하세요.

## 관련 문서

- [임베딩 설정 상세 가이드](./embedding-configuration.md)
- [LLM 프로바이더 설정 가이드](./llm-provider-configuration.md)
