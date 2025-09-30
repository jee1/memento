# Formulas for Search Ranking and Memory Decay

## 1) Final Ranking Score

$$S = \alpha \cdot \text{relevance} + \beta \cdot \text{recency} + \gamma \cdot \text{importance} + \delta \cdot \text{usage} - \varepsilon \cdot \text{duplication\_penalty}$$

**Default coefficients (M1 recommended)**: $\alpha=0.50$, $\beta=0.20$, $\gamma=0.20$, $\delta=0.10$, $\varepsilon=0.15$

**Meaning**: For candidate m, boost relevance, recency, importance, and usage, while reducing duplication penalty.

**Practical tip**: Start with the above default values → adjust $\alpha$, $\beta$ through A/B testing, and increase $\varepsilon$ if result diversity is insufficient.

## 2) Relevance Composition

$$\text{relevance} = w_e \cdot \text{sim}_e + w_k \cdot \text{bm25\_norm} + w_t \cdot \text{tag\_match} + w_p \cdot \text{title\_hit}$$

**Default weights (M1)**: $w_e=0.60$, $w_k=0.30$, $w_t=0.05$, $w_p=0.05$

### (1) Embedding Similarity (Cosine)

$$\text{sim}_e = \max(0, \cos(\mathbf{E}(q), \mathbf{E}(m)))$$

$\mathbf{E}(x)$ is the embedding function. Clamp cosine values to 0 if negative to prevent negative scores.

### (2) Keyword (BM25 Normalization)

$$\text{bm25\_norm} = \frac{\text{BM25}}{\text{BM25} + k_{\text{norm}}}$$

Recommended $k_{\text{norm}}=2.0$. Maps any query to [0,1] for easy combination with other features.

### (3) Tag Matching (Jaccard Similarity)

$$\text{tag\_match} = \frac{|T_q \cap T_m|}{|T_q \cup T_m|}$$

Overlap between query tags ($T_q$) and document tags ($T_m$). Actively using tags significantly improves search quality.

### (4) Title Match (Exact·Prefix·N-gram Addition)

$$\text{title\_hit} = I_{\text{exact}} \cdot 1.0 + I_{\text{prefix}} \cdot 0.5 + I_{\text{ngram}} \cdot 0.2$$

$I_*$ is 1 when condition is met, 0 otherwise. Fine-tuning section.

### Candidate Generation Tips (2-stage search recommended)

Stage 1 (ANN): Top $N_e$ embeddings, Stage 2 (BM25): Top $N_k$ keywords → Create union as candidate set and re-rank with above relevance.

## 3) Recency = Half-life Based Exponential Decay

$$\text{recency} = \exp\left(-\frac{\ln(2) \cdot \text{age\_days}}{\text{half\_life}(\text{type})}\right)$$

- $\text{half\_life}(\text{working})=2$
- $\text{half\_life}(\text{episodic})=30$ 
- $\text{half\_life}(\text{semantic})=180$ (unit: days)

**Meaning**: Different half-lives for each memory type so working memory fades quickly while semantic memory lasts long.

**Tuning**: Shorter half_life for fast domains (e.g., issue response notes), longer for knowledge bases.

## 4) Importance = User Weight + System Weight

$$\text{importance} = \text{clamp}(\text{imp\_user} + 0.20 \cdot \text{pinned} + \text{type\_boost}, 0, 1)$$

- $\text{imp\_user} \in [0,1]$: User-provided importance when storing (default 0.5)
- $\text{pinned} \in \{0,1\}$: 1 when pinned (protected from forgetting·decay)
- $\text{type\_boost}$: semantic=+0.10, episodic=0.00, working=−0.05 (example)
- $\text{clamp}(a,0,1)$: Clamp to 0~1 range

**Tip**: Instead of using imp_user directly, add project-specific policies (e.g., project:accounting +0.05).

## 5) Usage = Normalization of Log-scale Aggregation

$$\text{usage\_raw} = \log(1 + \text{view\_cnt}) + 2 \cdot \log(1 + \text{cite\_cnt}) + 0.5 \cdot \log(1 + \text{edit\_cnt})$$

$$\text{usage} = \frac{\text{usage\_raw} - \text{min\_batch}}{\text{max\_batch} - \text{min\_batch} + \varepsilon}$$

$\text{cite\_cnt}$ (reuse/citation) has highest weight. $\varepsilon$ is small value like $1e-6$.

**Reason for batch normalization**: Reduces absolute value deviation per document to ensure stable scale per query·session.

## 6) Duplication Penalty = MMR-style Diversity Control

$$\text{duplication\_penalty} = \max_{j \in R} \text{sim}_e(m, j)$$

$R$: Set of items already selected in current result list

**Interpretation**: Give penalty as the degree of similarity between new candidate m and most similar existing selected result.

If result diversity is insufficient, increase $\varepsilon$ (coefficient in final formula) or use MMR post-processing below.

### MMR Post-processing (Optional)

$$\text{MMR}(m) = \lambda \cdot S(m) - (1 - \lambda) \cdot \max_{j \in R} \text{sim}_e(m, j)$$

Recommended $\lambda=0.8$. When extracting final Top-K, add diversity term on top of S score.

## 7) Forgetting (garbage collection)·Reminder (spaced review)

Forgetting includes not just "deletion" but also "re-exposure (review)". Using score-based deletion risk and review schedule together is most stable.

### 7.1 Deletion Risk (ForgetScore)

$$\text{ForgetScore} = u_1 \cdot (1 - \text{recency}) + u_2 \cdot (1 - \text{usage}) + u_3 \cdot \text{dup\_ratio} - u_4 \cdot \text{importance} - u_5 \cdot \text{pinned}$$

**Default coefficients (M1)**: $u_1=0.35$, $u_2=0.25$, $u_3=0.20$, $u_4=0.15$, $u_5=0.30$

$\text{dup\_ratio}$: Proportion of similar items in cluster (if none, normalize duplication_penalty to 0~1 as substitute)

**Interpretation**: Easier to delete when old ($1-\text{recency}↑$), unused ($1-\text{usage}↑$), and many duplicates ($\text{dup\_ratio}↑$). Protect important or pinned items.

### Deletion Policy (Example)

- **Soft deletion candidates**: $\text{ForgetScore} \geq \theta_{\text{soft}}$ AND $\text{age\_days} \geq \text{TTL}_{\text{soft}}(\text{type})$
- **Hard deletion**: $\text{ForgetScore} \geq \theta_{\text{hard}}$ AND $\text{age\_days} \geq \text{TTL}_{\text{hard}}(\text{type})$

**Recommended values (M1)**:
- $\theta_{\text{soft}}=0.6$, $\theta_{\text{hard}}=0.8$
- $\text{TTL}_{\text{soft}}(\text{working})=2$, $\text{TTL}_{\text{soft}}(\text{episodic})=30$, $\text{TTL}_{\text{soft}}(\text{semantic})=\infty$
- $\text{TTL}_{\text{hard}}(\text{working})=7$, $\text{TTL}_{\text{hard}}(\text{episodic})=180$, $\text{TTL}_{\text{hard}}(\text{semantic})=\infty$

### 7.2 Spaced Review Schedule

$$p_{\text{recall}}(t) = \exp\left(-\frac{t}{\tau}\right)$$

$$\tau_{\text{next}} = \tau_{\text{prev}} \cdot (1 + a_1 \cdot \text{importance} + a_2 \cdot \text{usage} + a_3 \cdot \text{feedback\_helpful} - a_4 \cdot \text{feedback\_bad})$$

**Recommended coefficients**: $a_1=0.6$, $a_2=0.4$, $a_3=0.5$, $a_4=0.7$

**Meaning**: Memories that are important, frequently used, and marked as helpful have **increased memory half-life ($\tau$)** so review cycle becomes longer.

**Scheduling condition (example)**: Set next review time when $p_{\text{recall}}(t) \leq 0.7$ to issue reminder cards.

### Simple Preset (Light version instead of complex SM-2)

After first storage: 1 day, 6 days, then $\text{interval\_next} = \lceil \text{interval\_prev} \cdot (1 + 0.5 \cdot \text{importance} + 0.3 \cdot \text{usage}) \rceil$

## 8) Candidate Generation, Re-ranking, Diversification Pipeline (Recommended)

### CandidateGen
$$C = \text{TopN}_e(\text{ANN by sim}_e) \cup \text{TopN}_k(\text{BM25})$$
(Recommended $N_e=50$, $N_k=50$)

### Feature Compute
Calculate relevance, recency, importance, usage, duplication_penalty for each $m \in C$

### Primary Score
$$S(m) = \alpha \cdot \text{relevance} + \beta \cdot \text{recency} + \gamma \cdot \text{importance} + \delta \cdot \text{usage} - \varepsilon \cdot \text{duplication\_penalty}$$

### Diversification (Optional)
Apply MMR greedily to generate Top-K

### Thresholding
Keep only $S(m) \geq \theta_{\text{keep}}$ (e.g., $\theta_{\text{keep}}=0.35$)

## 9) Normalization and Calibration

Maintaining [0,1] scale for all partial scores makes combination easy. Recommend batch normalization for features with high variance per batch.

$$x_{\text{norm}} = \frac{x - \text{min\_batch}}{\text{max\_batch} - \text{min\_batch} + \varepsilon}$$

Example: Apply to usage, duplication_penalty, bm25_norm

**Advantage**: Reduces query bias and collection deviation to increase score stability↑

## 10) M1 Default Parameter Table (Summary)

| Item | Value |
|------|-------|
| **Final formula** | $\alpha=0.50$, $\beta=0.20$, $\gamma=0.20$, $\delta=0.10$, $\varepsilon=0.15$ |
| **relevance weights** | $w_e=0.60$, $w_k=0.30$, $w_t=0.05$, $w_p=0.05$ |
| **recency** | $\text{half\_life}(\text{working})=2$, $\text{episodic}=30$, $\text{semantic}=180$ |
| **importance** | $\text{pinned}=+0.20$, $\text{type\_boost}(\text{semantic}=+0.10, \text{working}=-0.05)$ |
| **usage** | log-based, batch normalization |
| **duplication_penalty** | max sim to selected |
| **forgetting** | $\theta_{\text{soft}}=0.6$, $\theta_{\text{hard}}=0.8$, TTL_soft/hard see table above |
| **review** | $p_{\text{recall}}(t)=\exp(-t/\tau)$, first 1day→6days→variable multiplier |

Implementing this way can be used immediately in **M1 (personal use)**, and only coefficient re-tuning is needed when going to M2/M3.
