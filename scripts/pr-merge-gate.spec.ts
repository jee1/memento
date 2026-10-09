import { describe, expect, it } from "vitest";
import { APPROVAL_LABEL, bucketOf, codexMarker, decide, type GateInput } from "./pr-merge-gate.js";

const pr = (overrides: Partial<GateInput> = {}): GateInput => ({
  state: "OPEN",
  mergeStateStatus: "CLEAN",
  headRefOid: "abc123",
  labels: ["risk:low"],
  body: "## Summary\n...",
  comments: [],
  checks: [{ name: "test-core", bucket: "pass" }],
  ...overrides,
});

describe("decide", () => {
  it("low 는 필수 체크 통과면 머지", () => {
    expect(decide(pr()).action).toBe("merge");
  });

  it("체크가 진행 중이거나 CLEAN 이 아니면 대기", () => {
    expect(decide(pr({ checks: [{ name: "test-core", bucket: "pending" }] })).action).toBe("wait");
    expect(decide(pr({ mergeStateStatus: "BLOCKED" })).action).toBe("wait");
  });

  it("체크 실패는 risk 와 무관하게 조치 필요", () => {
    const d = decide(pr({ checks: [{ name: "test-core", bucket: "fail" }] }));
    expect(d.action).toBe("needs");
    expect(d.reasons[0]).toContain("test-core");
  });

  it("risk 라벨이 없으면 PR Risk 를 기다린다", () => {
    expect(decide(pr({ labels: [] })).action).toBe("wait");
  });

  it("medium 은 `## 동작 설명` 절이 있어야 머지", () => {
    expect(decide(pr({ labels: ["risk:medium"] })).action).toBe("needs");
    expect(decide(pr({ labels: ["risk:medium"], body: "## 동작 설명\n무엇이 왜" })).action).toBe("merge");
  });

  it("high 는 현재 head 의 Codex 리뷰와 사용자 승인 라벨이 모두 있어야 머지", () => {
    const high = { labels: ["risk:high"] };
    expect(decide(pr(high)).reasons).toHaveLength(2);

    // 예전 head 에 대한 리뷰는 인정하지 않는다
    const staleReview = { comments: [codexMarker("old999")] };
    expect(decide(pr({ ...high, ...staleReview, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("needs");

    const reviewed = { comments: [`${codexMarker("abc123")}\n## Codex review`] };
    expect(decide(pr({ ...high, ...reviewed })).action).toBe("needs");
    expect(decide(pr({ ...reviewed, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("merge");
  });
});

describe("bucketOf", () => {
  it("CheckRun 과 StatusContext 를 pass·fail·pending 으로 접는다", () => {
    expect(bucketOf({ __typename: "CheckRun", status: "IN_PROGRESS" })).toBe("pending");
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" })).toBe("pass");
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" })).toBe("pass");
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" })).toBe("fail");
    expect(bucketOf({ __typename: "StatusContext", state: "PENDING" })).toBe("pending");
    expect(bucketOf({ __typename: "StatusContext", state: "ERROR" })).toBe("fail");
  });
});
