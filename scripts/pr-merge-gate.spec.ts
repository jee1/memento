import { describe, expect, it } from "vitest";
import {
  APPROVAL_LABEL,
  agentReviewMarker,
  bucketOf,
  checkKey,
  codexMarker,
  countAgentReviewMarkers,
  decide,
  checksFromRollup,
  filterDuplicateCancelledRollup,
  hasHeadAgentApprove,
  hasHeadCodexReview,
  highHeadReviewOk,
  isCancelledRollup,
  isDifferentModelFamily,
  lastMarkersPerModelOnHead,
  modelFamily,
  parseTrustedAgentReviewMarkers,
  reviewOverflowReason,
  type GateComment,
  type GateInput,
} from "./pr-merge-gate.js";

const OWNER = "repo-owner";
const HEAD = "abc123def4567890abcdef1234567890abcdef12";

const gateComment = (body: string, authorLogin = OWNER): GateComment => ({ body, authorLogin });

const pr = (overrides: Partial<GateInput> = {}): GateInput => ({
  state: "OPEN",
  mergeStateStatus: "CLEAN",
  headRefOid: HEAD,
  labels: ["risk:low"],
  body: "## Summary\n...",
  comments: [],
  checks: [{ name: "test-core", bucket: "pass" }],
  repoOwnerLogin: OWNER,
  prNumber: "1633",
  ...overrides,
});

const headApprove = (sha = HEAD, model = "grok-4.7-high-fast") =>
  gateComment(
    agentReviewMarker({
      sha,
      verdict: "approve",
      findings: { i: 0, n: 0, p: 0 },
      round: 1,
      model,
    }),
  );

const headChanges = (sha = HEAD, model = "grok-4.7-high-fast", round = 2) =>
  gateComment(
    agentReviewMarker({
      sha,
      verdict: "changes",
      findings: { i: 1, n: 0, p: 0 },
      round,
      model,
    }),
  );

describe("modelFamily", () => {
  it("알려진 id 를 계열로 접는다", () => {
    expect(modelFamily("claude-opus-5-5-high")).toBe("claude");
    expect(modelFamily("composer-2.5")).toBe("cursor");
    expect(modelFamily("gpt-5.6-sol-high")).toBe("openai");
    expect(modelFamily("gemini-4-argon-medium")).toBe("google");
  });

  it("미지 모델은 undefined (fail-closed)", () => {
    expect(modelFamily("grok-4.7-high-fast")).toBeUndefined();
    expect(isDifferentModelFamily("composer-2.5", "grok-4.7-high-fast")).toBe(false);
  });
});

describe("parseTrustedAgentReviewMarkers", () => {
  it("외부 작성자·인용·첫 줄 아님·코드 블록 예시·코멘트당 1개만 인정", () => {
    const marker = agentReviewMarker({
      sha: HEAD,
      verdict: "approve",
      findings: { i: 0, n: 0, p: 0 },
      round: 1,
      model: "gemini-4-argon-medium",
    });
    const external = gateComment(marker, "dependabot");
    const quoted = gateComment(`> ${marker}`);
    const twoInOne = gateComment(`${marker}\n${marker.replace("round=1", "round=2")}`);
    const notFirstLine = gateComment(`## Agent review\n${marker}`);
    const fencedExample = gateComment(
      "```markdown\n" + marker + "\n```",
    );
    const indentedExample = gateComment(`    ${marker}`);
    expect(parseTrustedAgentReviewMarkers([external], OWNER)).toHaveLength(0);
    expect(parseTrustedAgentReviewMarkers([quoted], OWNER)).toHaveLength(0);
    expect(parseTrustedAgentReviewMarkers([twoInOne], OWNER)).toHaveLength(1);
    expect(parseTrustedAgentReviewMarkers([notFirstLine], OWNER)).toHaveLength(0);
    expect(parseTrustedAgentReviewMarkers([fencedExample], OWNER)).toHaveLength(0);
    expect(parseTrustedAgentReviewMarkers([indentedExample], OWNER)).toHaveLength(0);
  });
});

describe("decide", () => {
  it("코드 블록 안 approve 마커만 있으면 head approve 없음(needs)", () => {
    const marker = agentReviewMarker({
      sha: HEAD,
      verdict: "approve",
      findings: { i: 0, n: 0, p: 0 },
      round: 1,
      model: "grok-4.7-high-fast",
    });
    const comments = [gateComment("```\n" + marker + "\n```")];
    expect(decide(pr({ comments })).action).toBe("needs");
  });

  it("첫 줄이 아닌 approve 마커는 무시", () => {
    const marker = agentReviewMarker({
      sha: HEAD,
      verdict: "approve",
      findings: { i: 0, n: 0, p: 0 },
      round: 1,
      model: "grok-4.7-high-fast",
    });
    expect(decide(pr({ comments: [gateComment("note\n" + marker)] })).action).toBe("needs");
  });

  it("model 대소문자만 다른 마지막 마커는 같은 리뷰어로 본다", () => {
    const comments = [
      gateComment(
        agentReviewMarker({
          sha: HEAD,
          verdict: "approve",
          findings: { i: 0, n: 0, p: 0 },
          round: 1,
          model: "gpt-5.5",
        }),
      ),
      gateComment(
        agentReviewMarker({
          sha: HEAD,
          verdict: "changes",
          findings: { i: 1, n: 0, p: 0 },
          round: 2,
          model: "GPT-5.5",
        }),
      ),
    ];
    expect(decide(pr({ comments })).action).toBe("needs");
  });

  it("low 는 head approve 마커(마지막 마커)가 있어야 머지", () => {
    expect(decide(pr()).action).toBe("needs");
    expect(decide(pr({ comments: [headApprove()] })).action).toBe("merge");
  });

  it("head 마커 없음과 deadbeef sha 마커만 있으면 조치 필요", () => {
    expect(decide(pr({ labels: ["risk:low"] })).reasons.some((r) => r.includes("head"))).toBe(true);
    expect(decide(pr({ labels: ["risk:low"], comments: [headApprove("deadbeef")] })).action).toBe(
      "needs",
    );
  });

  it("같은 head 에 approve 뒤 changes 면 승인 철회", () => {
    const model = "grok-4.7-high-fast";
    const comments = [
      gateComment(
        agentReviewMarker({
          sha: HEAD,
          verdict: "approve",
          findings: { i: 0, n: 0, p: 0 },
          round: 1,
          model,
        }),
      ),
      headChanges(HEAD, model, 2),
    ];
    expect(decide(pr({ comments })).action).toBe("needs");
  });

  it("agent-review 마커 정확히 3개는 통과, 4개면 3회 초과", () => {
    const mk = (round: number) =>
      gateComment(
        agentReviewMarker({
          sha: HEAD,
          verdict: "changes",
          findings: { i: 0, n: 0, p: 0 },
          round,
          model: "grok-4.7-high-fast",
        }),
      );
    const three = [mk(1), mk(2), headApprove()];
    expect(decide(pr({ comments: three })).action).toBe("merge");
    const four = [mk(1), mk(2), mk(3), headApprove()];
    const blocked = decide(pr({ comments: four }));
    expect(blocked.action).toBe("needs");
    expect(blocked.reasons[0]).toContain("3회 초과");
    expect(blocked.reasons[0]).toContain(
      "! node scripts/pr-merge-gate.ts 1633 --merge --allow-review-overflow",
    );
    expect(
      decide(
        pr({
          comments: four,
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
      decide(
        pr({ labels: ["risk:medium"], body: "## 동작 설명\n무엇이 왜", comments: [headApprove()] }),
      ).action,
    ).toBe("merge");
  });

  it("high 는 head 의 다른 계열 approve 또는 Codex 와 사용자 승인 라벨이 있어야 머지", () => {
    const high = { labels: ["risk:high"], authorModel: "composer-2.5" };
    expect(decide(pr(high)).reasons.length).toBeGreaterThanOrEqual(2);

    const staleCodex = { comments: [gateComment(`${codexMarker("deadbeef")}\n## Codex review`)] };
    expect(decide(pr({ ...high, ...staleCodex, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe(
      "needs",
    );

    expect(decide(pr({ ...high, authorModel: undefined })).reasons.some((r) => r.includes("author-model"))).toBe(
      true,
    );

    const sameModel = { comments: [headApprove(HEAD, "composer-2.5")] };
    expect(decide(pr({ ...high, ...sameModel, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe(
      "needs",
    );

    const unknownReviewer = { comments: [headApprove(HEAD, "grok-4.7-high-fast")] };
    expect(
      decide(pr({ ...high, ...unknownReviewer, labels: ["risk:high", APPROVAL_LABEL] })).action,
    ).toBe("needs");

    const crossModel = { comments: [headApprove(HEAD, "gemini-4-argon-medium")] };
    expect(decide(pr({ ...high, ...crossModel })).action).toBe("needs");
    expect(
      decide(pr({ ...high, ...crossModel, labels: ["risk:high", APPROVAL_LABEL] })).action,
    ).toBe("merge");

    const codex = { comments: [gateComment(`${codexMarker(HEAD)}\n## Codex review`)] };
    expect(decide(pr({ ...high, ...codex, labels: ["risk:high", APPROVAL_LABEL] })).action).toBe(
      "merge",
    );
  });

  it("authorModel 누락 + 다른 계열 head approve + 승인 라벨은 needs", () => {
    const cross = { comments: [headApprove(HEAD, "gemini-4-argon-medium")] };
    expect(
      decide(
        pr({
          labels: ["risk:high", APPROVAL_LABEL],
          authorModel: undefined,
          body: "## Summary\n(no author-model marker)",
          ...cross,
        }),
      ).action,
    ).toBe("needs");
  });

  it("high 에서 같은 계열 approve 뒤 다른 계열 approve 면 통과", () => {
    const high = {
      labels: ["risk:high", APPROVAL_LABEL],
      authorModel: "composer-2.5",
      body: "<!-- author-model=composer-2.5 -->",
    };
    const comments = [
      headApprove(HEAD, "cursor-fast"),
      headApprove(HEAD, "gemini-4-argon-medium"),
    ];
    expect(decide(pr({ ...high, comments })).action).toBe("merge");
  });

  it("high stale agent-review (deadbeef) 는 차단", () => {
    const high = {
      labels: ["risk:high", APPROVAL_LABEL],
      authorModel: "composer-2.5",
      body: "<!-- author-model=composer-2.5 -->",
    };
    expect(
      decide(pr({ ...high, comments: [headApprove("deadbeef", "gemini-4-argon-medium")] })).action,
    ).toBe("needs");
  });
});

describe("hasHeadAgentApprove", () => {
  it("head sha 와 리뷰어 모델별 마지막 verdict approve 만 인정", () => {
    expect(hasHeadAgentApprove([headApprove(HEAD)], HEAD, OWNER)).toBe(true);
    expect(hasHeadAgentApprove([headApprove("deadbeef")], HEAD, OWNER)).toBe(false);
    const comments = [headApprove(HEAD, "m1"), headChanges(HEAD, "m1", 2)];
    expect(hasHeadAgentApprove(comments, HEAD, OWNER)).toBe(false);
  });
});

describe("hasHeadCodexReview", () => {
  it("저장소 소유자 코멘트 첫 줄 codex 마커만 인정 (--codex-review 형식)", () => {
    const trusted = gateComment(`${codexMarker(HEAD)}\n## Codex review`);
    expect(hasHeadCodexReview([trusted], HEAD, OWNER)).toBe(true);
    expect(hasHeadCodexReview([gateComment(`> ${codexMarker(HEAD)}`)], HEAD, OWNER)).toBe(false);
    expect(hasHeadCodexReview([gateComment(codexMarker(HEAD), "dependabot")], HEAD, OWNER)).toBe(
      false,
    );
    expect(hasHeadCodexReview([gateComment(`${codexMarker("deadbeef")}\n`)], HEAD, OWNER)).toBe(
      false,
    );
    expect(
      hasHeadCodexReview([gateComment(`## Codex review\n${codexMarker(HEAD)}`)], HEAD, OWNER),
    ).toBe(false);
  });

  it("여러 코멘트 중 head codex 마커가 뒤에 있으면 true, 옛 sha만 있으면 false", () => {
    const oldOnly = [gateComment(`${codexMarker("deadbeef")}\n`)];
    expect(hasHeadCodexReview(oldOnly, HEAD, OWNER)).toBe(false);

    const oldThenHead = [
      gateComment(`${codexMarker("deadbeef")}\n`),
      gateComment(`${codexMarker(HEAD)}\n## Codex review`),
    ];
    expect(hasHeadCodexReview(oldThenHead, HEAD, OWNER)).toBe(true);
  });
});

describe("highHeadReviewOk", () => {
  it("find 대신 any cross-family effective approve", () => {
    const comments = [
      headApprove(HEAD, "composer-2.5"),
      headApprove(HEAD, "gemini-4-argon-medium"),
    ];
    expect(highHeadReviewOk(comments, HEAD, OWNER, "composer-2.5")).toBe(true);
  });
});

describe("regression mutations (broken helper vs correct)", () => {
  it("head 비교 제거 변이는 stale approve 를 잘못 통과시킨다", () => {
    const markers = parseTrustedAgentReviewMarkers([headApprove("deadbeef")], OWNER);
    const broken = markers.some((m) => m.verdict === "approve");
    const fixed = hasHeadAgentApprove([headApprove("deadbeef")], HEAD, OWNER);
    expect(broken).toBe(true);
    expect(fixed).toBe(false);
  });

  it("high head 비교 제거 변이는 stale cross approve 를 통과시킨다", () => {
    const comments = [headApprove("deadbeef", "gemini-4-argon-medium")];
    const markers = parseTrustedAgentReviewMarkers(comments, OWNER);
    const broken = markers.some((m) => m.verdict === "approve" && m.model !== undefined);
    expect(broken).toBe(true);
    expect(highHeadReviewOk(comments, HEAD, OWNER, "composer-2.5")).toBe(false);
  });

  it("authorModel 누락 차단 변이는 cross approve + 라벨을 잘못 통과시킨다", () => {
    const comments = [headApprove(HEAD, "gemini-4-argon-medium")];
    const markers = parseTrustedAgentReviewMarkers(comments, OWNER);
    const brokenHighOk = lastMarkersPerModelOnHead(markers, HEAD).some(
      (m) =>
        m.verdict === "approve" &&
        m.model !== undefined &&
        isDifferentModelFamily("composer-2.5", m.model),
    );
    expect(brokenHighOk).toBe(true);
    expect(highHeadReviewOk(comments, HEAD, OWNER, undefined)).toBe(false);
    expect(
      decide(
        pr({
          labels: ["risk:high", APPROVAL_LABEL],
          authorModel: undefined,
          body: "## Summary",
          comments,
        }),
      ).action,
    ).toBe("needs");
  });

  it("상한 >=4 변이는 4개 마커를 통과시키고 >=5 변이는 3개를 막는다", () => {
    const mk = (round: number) =>
      gateComment(
        agentReviewMarker({
          sha: HEAD,
          verdict: "changes",
          findings: { i: 0, n: 0, p: 0 },
          round,
          model: "grok-4.7-high-fast",
        }),
      );
    const three = [mk(1), mk(2), headApprove()];
    expect(countAgentReviewMarkers(three, OWNER)).toBe(3);
    expect(decide(pr({ comments: three })).action).toBe("merge");
    expect(countAgentReviewMarkers(three, OWNER) >= 4).toBe(false);

    const four = [mk(1), mk(2), mk(3), headApprove()];
    expect(countAgentReviewMarkers(four, OWNER)).toBe(4);
    expect(decide(pr({ comments: four })).action).toBe("needs");
    expect(countAgentReviewMarkers(four, OWNER) >= 4).toBe(true);
    expect(countAgentReviewMarkers(four, OWNER) >= 5).toBe(false);
  });

  it("모델 비교 제거 변이는 unknown reviewer 를 통과시킨다", () => {
    const author = "composer-2.5";
    const reviewer = "grok-4.7-high-fast";
    const comments = [headApprove(HEAD, reviewer)];
    const brokenCrossOk = parseTrustedAgentReviewMarkers(comments, OWNER).some(
      (m) => m.verdict === "approve" && m.sha === HEAD,
    );
    expect(brokenCrossOk).toBe(true);
    expect(isDifferentModelFamily(author, reviewer)).toBe(false);
    expect(highHeadReviewOk(comments, HEAD, OWNER, author)).toBe(false);
  });

  it("첫 줄만 스캔 변이는 본문 두 번째 줄 마커를 잘못 인정한다", () => {
    const marker = agentReviewMarker({
      sha: HEAD,
      verdict: "approve",
      findings: { i: 0, n: 0, p: 0 },
      round: 1,
      model: "grok-4.7-high-fast",
    });
    const comments = [gateComment("intro\n" + marker)];
    const brokenScanAllLines = comments.flatMap((c) =>
      c.body.split("\n").flatMap((line) => {
        const m = parseTrustedAgentReviewMarkers([gateComment(line)], OWNER);
        return m;
      }),
    );
    expect(brokenScanAllLines.some((m) => m.sha === HEAD)).toBe(true);
    expect(hasHeadAgentApprove(comments, HEAD, OWNER)).toBe(false);
  });

  it("model 키 대소문자 미접기 변이는 GPT approve 뒤 changes 를 놓친다", () => {
    const comments = [
      headApprove(HEAD, "gpt-5.5"),
      headChanges(HEAD, "GPT-5.5", 2),
    ];
    const markers = parseTrustedAgentReviewMarkers(comments, OWNER);
    const brokenKeys = new Map<string, (typeof markers)[0]>();
    for (const m of markers) {
      if (m.sha !== HEAD) continue;
      brokenKeys.set(m.model ?? "", m);
    }
    expect(brokenKeys.get("gpt-5.5")!.verdict).toBe("approve");
    expect(brokenKeys.get("GPT-5.5")!.verdict).toBe("changes");
    expect(hasHeadAgentApprove(comments, HEAD, OWNER)).toBe(false);
  });
});

describe("lastMarkersPerModelOnHead", () => {
  it("같은 model 키의 마지막 마커만 남긴다", () => {
    const markers = parseTrustedAgentReviewMarkers(
      [headApprove(HEAD, "m1"), headChanges(HEAD, "m1", 2)],
      OWNER,
    );
    const last = lastMarkersPerModelOnHead(markers, HEAD);
    expect(last).toHaveLength(1);
    expect(last[0]!.verdict).toBe("changes");
  });

  it("model 키는 소문자로 접는다", () => {
    const markers = parseTrustedAgentReviewMarkers(
      [
        headApprove(HEAD, "gpt-5.5"),
        headChanges(HEAD, "GPT-5.5", 2),
      ],
      OWNER,
    );
    const last = lastMarkersPerModelOnHead(markers, HEAD);
    expect(last).toHaveLength(1);
    expect(last[0]!.verdict).toBe("changes");
  });
});

describe("reviewOverflowReason", () => {
  it("PR 번호와 --merge 가 들어간 overflow 안내", () => {
    expect(reviewOverflowReason("1633")).toContain("1633");
    expect(reviewOverflowReason("1633")).toContain("--merge");
    expect(reviewOverflowReason("1633")).toContain("--allow-review-overflow");
  });
});

describe("bucketOf", () => {
  it("CheckRun 과 StatusContext 를 pass·fail·pending 으로 접는다", () => {
    expect(bucketOf({ __typename: "CheckRun", status: "IN_PROGRESS" })).toBe("pending");
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" })).toBe(
      "pass",
    );
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" })).toBe(
      "pass",
    );
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" })).toBe(
      "fail",
    );
    expect(bucketOf({ __typename: "CheckRun", status: "COMPLETED", conclusion: "CANCELLED" })).toBe(
      "fail",
    );
    expect(bucketOf({ __typename: "StatusContext", state: "PENDING" })).toBe("pending");
    expect(bucketOf({ __typename: "StatusContext", state: "ERROR" })).toBe("fail");
  });
});

const rollupRun = (
  name: string,
  workflowName: string,
  conclusion: string,
  status: string = "COMPLETED",
) => ({
  __typename: "CheckRun" as const,
  name,
  workflowName,
  status,
  conclusion,
});

describe("filterDuplicateCancelledRollup", () => {
  it("checkKey 는 workflowName 과 name 을 묶는다", () => {
    expect(checkKey({ workflowName: "PR Risk", name: "score" })).toBe("PR Risk:score");
  });

  it("isCancelledRollup 은 CANCELLED 만 본다", () => {
    expect(isCancelledRollup(rollupRun("score", "PR Risk", "CANCELLED"))).toBe(true);
    expect(isCancelledRollup(rollupRun("score", "PR Risk", "SKIPPED"))).toBe(false);
  });

  it("(취소 + 성공) → 통과", () => {
    const checks = checksFromRollup([
      rollupRun("score", "PR Risk", "CANCELLED"),
      rollupRun("score", "PR Risk", "SUCCESS"),
    ]);
    expect(checks).toEqual([{ name: "score", bucket: "pass" }]);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("merge");
  });

  it("(취소만) → needs", () => {
    const checks = checksFromRollup([rollupRun("score", "PR Risk", "CANCELLED")]);
    expect(checks).toHaveLength(1);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("needs");
  });

  it("(취소 + SKIPPED) → needs", () => {
    const checks = checksFromRollup([
      rollupRun("score", "PR Risk", "CANCELLED"),
      rollupRun("score", "PR Risk", "SKIPPED"),
    ]);
    expect(checks).toHaveLength(2);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("needs");
  });

  it("(취소 + 진행 중) → wait", () => {
    const checks = checksFromRollup([
      rollupRun("score", "PR Risk", "CANCELLED"),
      rollupRun("score", "PR Risk", "SUCCESS", "IN_PROGRESS"),
    ]);
    expect(checks.some((c) => c.bucket === "pending")).toBe(true);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("wait");
  });

  it("(실패 + 성공) → needs", () => {
    const checks = checksFromRollup([
      rollupRun("score", "PR Risk", "FAILURE"),
      rollupRun("score", "PR Risk", "SUCCESS"),
    ]);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("needs");
  });

  it("다른 workflow 의 같은 이름(취소 + 성공) → needs", () => {
    const checks = checksFromRollup([
      rollupRun("score", "Other WF", "CANCELLED"),
      rollupRun("score", "PR Risk", "SUCCESS"),
    ]);
    expect(checks).toHaveLength(2);
    expect(decide(pr({ checks, comments: [headApprove()] })).action).toBe("needs");
  });

  it("필터를 건너뛰면 취소+성공이 needs 로 잘못 막힌다 (회귀)", () => {
    const items = [
      rollupRun("score", "PR Risk", "CANCELLED"),
      rollupRun("score", "PR Risk", "SUCCESS"),
    ];
    const unfiltered = items.map((c) => ({ name: c.name, bucket: bucketOf(c) }));
    expect(decide(pr({ checks: unfiltered, comments: [headApprove()] })).action).toBe("needs");
    expect(decide(pr({ checks: checksFromRollup(items), comments: [headApprove()] })).action).toBe(
      "merge",
    );
  });
});
