# 검색 랭킹 및 망각을 위한 수식

## 1) 최종 랭킹 점수

$$S = \alpha \cdot \text{relevance} + \beta \cdot \text{recency} + \gamma \cdot \text{importance} + \delta \cdot \text{usage} - \varepsilon \cdot \text{duplication\_penalty}$$

**기본 계수(M1 추천)**: $\alpha=0.50$, $\beta=0.20$, $\gamma=0.20$, $\delta=0.10$, $\varepsilon=0.15$

**의미**: 후보 m에 대해 관련성(relevance)과 최근성(recency), 중요도(importance), 사용성(usage)을 올리고, 중복(duplication_penalty)을 깎는다.

**실무 팁**: 처음엔 위 기본값으로 시작 → A/B 테스트로 $\alpha$, $\beta$를 조정하고, 결과 다양성이 부족하면 $\varepsilon$를 키운다.

## 2) 관련성(relevance) 구성

$$\text{relevance} = w_e \cdot \text{sim}_e + w_k \cdot \text{bm25\_norm} + w_t \cdot \text{tag\_match} + w_p \cdot \text{title\_hit}$$

**기본 가중치(M1)**: $w_e=0.60$, $w_k=0.30$, $w_t=0.05$, $w_p=0.05$

### (1) 임베딩 유사도(코사인)

$$\text{sim}_e = \max(0, \cos(\mathbf{E}(q), \mathbf{E}(m)))$$

$\mathbf{E}(x)$는 임베딩 함수. 코사인 값이 음수가 나오는 모델이라면 0으로 클램프해 점수 음수화를 방지.

### (2) 키워드(BM25의 정규화)

$$\text{bm25\_norm} = \frac{\text{BM25}}{\text{BM25} + k_{\text{norm}}}$$

권장 $k_{\text{norm}}=2.0$. 어떤 쿼리든 [0,1]로 매핑해 다른 피처와 합치기 쉽다.

### (3) 태그 매칭(자카드 유사도)

$$\text{tag\_match} = \frac{|T_q \cap T_m|}{|T_q \cup T_m|}$$

쿼리 태그($T_q$)와 문서 태그($T_m$) 겹침 정도. 태그를 적극 쓰면 검색 품질이 눈에 띄게 오른다.

### (4) 타이틀 매치(정확·접두·N-gram 가산)

$$\text{title\_hit} = I_{\text{exact}} \cdot 1.0 + I_{\text{prefix}} \cdot 0.5 + I_{\text{ngram}} \cdot 0.2$$

$I_*$는 해당 조건 충족 시 1, 아니면 0. 세밀한 튜닝 구간.

### 후보 생성 팁(2단계 검색 권장)

1차(ANN): 임베딩 상위 $N_e$개, 2차(BM25): 키워드 상위 $N_k$개 → 합집합을 후보 세트로 만들고 위 relevance로 재랭킹.

## 3) 최근성(recency) = 반감기 기반 지수 감쇠

$$\text{recency} = \exp\left(-\frac{\ln(2) \cdot \text{age\_days}}{\text{half\_life}(\text{type})}\right)$$

- $\text{half\_life}(\text{working})=2$
- $\text{half\_life}(\text{episodic})=30$ 
- $\text{half\_life}(\text{semantic})=180$ (단위: 일)

**의미**: 각 타입별 기억의 반감기를 다르게 둬서, 작업기억은 빠르게 색이 바래고 의미기억은 오래 간다.

**튜닝**: 도메인이 빠르면(예: 이슈 대응 노트) half_life를 더 짧게, 지식 베이스는 더 길게.

## 4) 중요도(importance) = 사용자 가중 + 시스템 가중

$$\text{importance} = \text{clamp}(\text{imp\_user} + 0.20 \cdot \text{pinned} + \text{type\_boost}, 0, 1)$$

- $\text{imp\_user} \in [0,1]$: 사용자가 저장 시 준 중요도(기본 0.5)
- $\text{pinned} \in \{0,1\}$: 고정 시 1 (망각·감쇠에서 보호)
- $\text{type\_boost}$: semantic=+0.10, episodic=0.00, working=−0.05 (예시)
- $\text{clamp}(a,0,1)$: 0~1 범위로 자르기

**팁**: imp_user를 그대로 쓰기보단, 프로젝트별 정책(예: project:정산 +0.05)을 더해도 좋다.

## 5) 사용성(usage) = 로그 스케일 집계의 정규화

$$\text{usage\_raw} = \log(1 + \text{view\_cnt}) + 2 \cdot \log(1 + \text{cite\_cnt}) + 0.5 \cdot \log(1 + \text{edit\_cnt})$$

$$\text{usage} = \frac{\text{usage\_raw} - \text{min\_batch}}{\text{max\_batch} - \text{min\_batch} + \varepsilon}$$

$\text{cite\_cnt}$(재사용/인용) 가중치를 가장 높게. $\varepsilon$는 $1e-6$ 같은 작은 값.

**배치 정규화 이유**: 문서별 절대치 편차를 줄여 쿼리·세션마다 안정적 스케일을 보장.

## 6) 중복 패널티(duplication_penalty) = MMR식 다양성 제어

$$\text{duplication\_penalty} = \max_{j \in R} \text{sim}_e(m, j)$$

$R$: 이미 현재 결과 리스트에 선정된 항목 집합

**해석**: 새 후보 m이 기존 선정 결과와 가장 비슷한 정도를 패널티로 준다.

결과 다양성이 부족하면 $\varepsilon$(최종식의 계수)를 키우거나, 아래의 MMR 후처리를 사용.

### MMR 후처리(선택)

$$\text{MMR}(m) = \lambda \cdot S(m) - (1 - \lambda) \cdot \max_{j \in R} \text{sim}_e(m, j)$$

추천 $\lambda=0.8$. 최종 Top-K를 뽑을 때, S 점수에 다양성 항을 더 얹는 방식.

## 7) 망각(garbage collection)·리마인드(spaced review)

망각은 "삭제"만이 아니라 "재노출(복습)"도 포함한다. 점수 기반의 삭제 위험도와 리뷰 스케줄을 함께 쓰는 게 가장 안정적이다.

### 7.1 삭제 위험도(ForgetScore)

$$\text{ForgetScore} = u_1 \cdot (1 - \text{recency}) + u_2 \cdot (1 - \text{usage}) + u_3 \cdot \text{dup\_ratio} - u_4 \cdot \text{importance} - u_5 \cdot \text{pinned}$$

**기본 계수(M1)**: $u_1=0.35$, $u_2=0.25$, $u_3=0.20$, $u_4=0.15$, $u_5=0.30$

$\text{dup\_ratio}$: 군집 내 유사 항목 비중(없으면 duplication_penalty를 0~1로 정규화해 대체)

**해석**: 오래되고($1-\text{recency}↑$), 안 쓰이고($1-\text{usage}↑$), 중복 많을수록($\text{dup\_ratio}↑$) 지우기 쉽다. 중요하거나 핀인 항목은 보호.

### 삭제 정책(예시)

- **소프트 삭제 후보**: $\text{ForgetScore} \geq \theta_{\text{soft}}$ AND $\text{age\_days} \geq \text{TTL}_{\text{soft}}(\text{type})$
- **하드 삭제**: $\text{ForgetScore} \geq \theta_{\text{hard}}$ AND $\text{age\_days} \geq \text{TTL}_{\text{hard}}(\text{type})$

**권장값(M1)**:
- $\theta_{\text{soft}}=0.6$, $\theta_{\text{hard}}=0.8$
- $\text{TTL}_{\text{soft}}(\text{working})=2$, $\text{TTL}_{\text{soft}}(\text{episodic})=30$, $\text{TTL}_{\text{soft}}(\text{semantic})=\infty$
- $\text{TTL}_{\text{hard}}(\text{working})=7$, $\text{TTL}_{\text{hard}}(\text{episodic})=180$, $\text{TTL}_{\text{hard}}(\text{semantic})=\infty$

### 7.2 간격 반복(Spaced Review) 스케줄

$$p_{\text{recall}}(t) = \exp\left(-\frac{t}{\tau}\right)$$

$$\tau_{\text{next}} = \tau_{\text{prev}} \cdot (1 + a_1 \cdot \text{importance} + a_2 \cdot \text{usage} + a_3 \cdot \text{feedback\_helpful} - a_4 \cdot \text{feedback\_bad})$$

**추천 계수**: $a_1=0.6$, $a_2=0.4$, $a_3=0.5$, $a_4=0.7$

**의미**: 중요하고 자주 쓰이고, 유용하다고 표시된 기억은 **기억 반감기($\tau$)**가 늘어나서 리뷰 주기가 길어진다.

**스케줄링 조건(예시)**: $p_{\text{recall}}(t) \leq 0.7$가 되는 시점을 다음 리뷰 시점으로 잡아 리마인드 카드 발행.

### 간단 프리셋(복잡한 SM-2 대신 라이트 버전)

첫 저장 후 1일, 6일, 그 다음부터는 $\text{interval\_next} = \lceil \text{interval\_prev} \cdot (1 + 0.5 \cdot \text{importance} + 0.3 \cdot \text{usage}) \rceil$

## 8) 후보 생성, 재랭킹, 다양화 파이프라인(권장)

### CandidateGen
$$C = \text{TopN}_e(\text{ANN by sim}_e) \cup \text{TopN}_k(\text{BM25})$$
(권장 $N_e=50$, $N_k=50$)

### Feature Compute
각 $m \in C$에 대해 relevance, recency, importance, usage, duplication_penalty 계산

### Primary Score
$$S(m) = \alpha \cdot \text{relevance} + \beta \cdot \text{recency} + \gamma \cdot \text{importance} + \delta \cdot \text{usage} - \varepsilon \cdot \text{duplication\_penalty}$$

### Diversification (선택)
Greedy로 MMR 적용해 Top-K 생성

### Thresholding
$S(m) \geq \theta_{\text{keep}}$만 유지 (예: $\theta_{\text{keep}}=0.35$)

## 9) 정규화와 캘리브레이션

모든 부분 점수는 [0,1] 스케일을 유지하면 조합이 쉽다. 배치마다 분산이 큰 피처는 배치 정규화를 권장.

$$x_{\text{norm}} = \frac{x - \text{min\_batch}}{\text{max\_batch} - \text{min\_batch} + \varepsilon}$$

예: usage, duplication_penalty, bm25_norm에 적용

**장점**: 쿼리 편향, 컬렉션 편차를 줄여 점수 안정성↑

## 10) M1 기본 파라미터 표(요약)

| 항목 | 값 |
|------|-----|
| **최종식** | $\alpha=0.50$, $\beta=0.20$, $\gamma=0.20$, $\delta=0.10$, $\varepsilon=0.15$ |
| **relevance 가중** | $w_e=0.60$, $w_k=0.30$, $w_t=0.05$, $w_p=0.05$ |
| **recency** | $\text{half\_life}(\text{working})=2$, $\text{episodic}=30$, $\text{semantic}=180$ |
| **importance** | $\text{pinned}=+0.20$, $\text{type\_boost}(\text{semantic}=+0.10, \text{working}=-0.05)$ |
| **usage** | log 기반, 배치 정규화 |
| **duplication_penalty** | max sim to selected |
| **망각** | $\theta_{\text{soft}}=0.6$, $\theta_{\text{hard}}=0.8$, TTL_soft/hard 위 표 참조 |
| **리뷰** | $p_{\text{recall}}(t)=\exp(-t/\tau)$, 첫 1일→6일→가변 배수 |

이대로 구현하면 **M1(개인용)**에서 바로 쓸 수 있고, M2/M3로 갈 때는 계수만 재튜닝하면 된다.
