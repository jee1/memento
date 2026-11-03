import { describe, expect, it } from "vitest";
import {
  APPROVAL_LABEL,
  agentReviewMarker,
  bucketOf,
  codexMarker,
  decide,
  hasHeadAgentApprove,
  type GateInput,
} from "./pr-merge-gate.js";

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

const headApprove = (sha = "abc123", model = "grok-4.7-high-fast") =>
  agentReviewMarker({
    sha,
    verdict: "approve",
    findings: { i: 0, n: 0, p: 0 },
    round: 1,
    model,
  });

describe("decide", () => {
  it("low 는 head approve 마커가 있어야 머지", () => {
    expect(decide(pr()).action).toBe("needs");
    expect(decide(pr({ comments: [headApprove()] })).action).toBe("merge");
  });

  it("head 마커 없음과 이전 sha 마커만 있으면 조치 필요", () => {
    expect(decide(pr({ labels: ["risk:low"] })).reasons.some((r) => r.includes("head"))).toBe(true);
    expect(
      decide(pr({ labels: ["risk:low"], comments: [headApprove("old999")] })).action,
    ).toBe("needs");
  });

  it("agent-review 마커 4개면 3회 초과로 멈춘다", () => {
    const comments = [1, 2, 3, 4].map((round) =>
      agentReviewMarker({
        sha: "abc123",
        verdict: "changes",
        findings: { i: 0, n: 0, p: 0 },
        round,
        model: "grok-4.7-high-fast",
      }),
    );
    const d = decide(pr({ comments: [...comments, headApprove()] }));
    expect(d.action).toBe("needs");
    expect(d.reasons[0]).toContain("3회 초과");
    expect(
      decide(
        pr({
          comments: [...comments, headApprove()],
          allowReviewOverflow: true,
        }),
      ).action,
    ).toBe("merge");
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

  it("risk 라벨이 둘 이상이면 가장 높은 등급으로 판정", () => {
    const d = decide(pr({ labels: ["risk:low", "risk:medium"] }));
    expect(d.level).toBe("medium");
    expect(d.action).toBe("needs");
    expect(
      decide(
        pr({
          labels: ["risk:medium", "risk:low"],
          body: "## 동작 설명\n무엇이 왜",
          comments: [headApprove()],
        }),
      ).action,
    ).toBe("merge");
    expect(decide(pr({ labels: ["risk:low", "risk:high"] })).level).toBe("high");
    expect(decide(pr({ labels: ["risk:high", "risk:low"] })).action).toBe("needs");
  });

  it("알 수 없는 risk 값이 섞이면 unknown 으로 대기", () => {
    const d = decide(pr({ labels: ["risk:low", "risk:bogus"] }));
    expect(d.level).toBe("unknown");
    expect(d.action).toBe("wait");
  });

  it("medium 은 `## 동작 설명` 절과 head approve 가 있어야 머지", () => {
    expect(decide(pr({ labels: ["risk:medium"], comments: [headApprove()] })).action).toBe("needs");
    expect(
      decide(pr({ labels: ["risk:medium"], body: "## 동작 설명\n무엇이 왜", comments: [headApprove()] })).action,
    ).toBe("merge");
  });

  it("high 는 head 의 다른 모델 approve 또는 Codex 와 사용자 승인 라벨이 있어야 머지", () => {
    const high = { labels: ["risk:high"], authorModel: "composer-2.5" };
    expect(decide(pr(high)).reasons.length).toBeGreaterThanOrEqual(2);

    const staleReview = { comments: [codexMarker("old999")] };
    expect(decide(pr({ ...high, ...staleReview, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("needs");

    const sameModel = { comments: [headApprove("abc123", "composer-2.5")] };
    expect(decide(pr({ ...high, ...sameModel, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("needs");

    const crossModel = { comments: [headApprove("abc123", "grok-4.7-high-fast")] };
    expect(decide(pr({ ...high, ...crossModel })).action).toBe("needs");
    expect(decide(pr({ ...high, ...crossModel, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("merge");

    const codex = { comments: [`${codexMarker("abc123")}\n## Codex review`] };
    expect(decide(pr({ ...high, ...codex, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe("merge");
  });
});

describe("hasHeadAgentApprove", () => {
  it("head sha 와 verdict approve 만 인정", () => {
    expect(hasHeadAgentApprove([headApprove("abc123")], "abc123")).toBe(true);
    expect(hasHeadAgentApprove([headApprove("old")], "abc123")).toBe(false);
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
