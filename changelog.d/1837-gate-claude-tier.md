Changed
- 머지 게이트의 high 교차 리뷰는 작성자와 다른 Claude 단계(작성 Opus, 리뷰 Sonnet 이나 Fable)의 리뷰만 받는다. 버전만 다른 같은 단계, 정해진 꼴이 아닌 모델 id, Claude 가 아닌 모델의 리뷰는 거절한다. Codex 리뷰 경로(`--codex-review`)를 지웠고, head 에 changes 리뷰가 남으면 거절한다 (#1837)
