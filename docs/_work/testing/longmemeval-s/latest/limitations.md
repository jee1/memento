# LongMemEval-S Validation Limitations

- Run status: `completed`
- Reason codes: none
- The LongMemEval-S source file is never committed to this repository.
- Retrieval metrics and task-completion judge metrics are reported separately.
- Graph-RRF remains disabled because this run did not evaluate it and the 18-case sampled task-completion result is insufficient for adoption.
- Task completion covers 18/470 non-abstention cases (3.83%), selected deterministically by question type.
- The reader used oracle sessions with a 12,000-character per-case cap; this is not Memento retrieval-to-answer accuracy.
- Several required sessions were omitted by the cap, which can lower both accuracy and evidence coverage.
