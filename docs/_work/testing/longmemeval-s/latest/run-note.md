# LongMemEval-S External Judge Run (2026-06-14)

## Scope

- Dataset revision: `98d7416c24c778c2fee6e6f3006e7a073259d48f`
- Dataset SHA-256: `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
- Retrieval: all 470 non-abstention questions; 30 abstention questions excluded
- Task completion: 18 non-abstention questions, the first three records from each of six question types
- Reader: Codex CLI 0.139.0, model `gpt-5.5`
- Judge: Claude Code 2.1.153, model `claude-sonnet-4-6`
- Judge protocol: `longmemeval-v1`, aligned with the upstream semantic answer-check rules

## Result

- Accuracy: 10/18 (55.56%)
- Required evidence coverage: 62.50%
- Retrieval and task-completion results remain separate in `results.json`.
- Raw LongMemEval data is not committed; only hypotheses, labels, and session IDs are published.

## Reproduction

1. Acquire the pinned dataset with `npm run quality:longmemeval:acquire`.
2. Select the first three non-abstention cases per question type.
3. Give the reader only question/date and oracle evidence sessions, never the reference answer.
4. Give the judge only question, reference answer or rubric, and reader hypothesis, never retrieval scores.
5. Convert the structured judgments to `judge-results.jsonl`.
6. Run:

```bash
npm run quality:longmemeval:validate -- \
  --dataset .local/longmemeval/longmemeval_s_cleaned.json \
  --judge-results docs/_work/testing/longmemeval-s/latest/judge-results.jsonl \
  --dataset-revision 98d7416c24c778c2fee6e6f3006e7a073259d48f \
  --output-dir /tmp/longmemeval-s-reproduction \
  --seed 483
```

## Cost And Limits

- Codex reader reported 70,568 total tokens; subscription execution did not expose a per-run USD cost.
- Claude judge used 25,795 cache-creation input tokens, 23,028 cache-read input tokens, 3,095 output tokens, and reported USD 0.15007665.
- This is a deterministic stratified sample, not a statistically random or full 470-case task-completion run.
- Reader evidence was capped at 12,000 characters per case with head/tail preservation. Additional required sessions could be omitted.
- The cap directly caused several incomplete hypotheses, so 55.56% must not be interpreted as full-context model quality or Memento retrieval-to-answer accuracy.
- Oracle evidence was used for the reader. This run validates the external reader/judge pipeline, not the production Memento ranking path.
