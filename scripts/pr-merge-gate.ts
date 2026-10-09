#!/usr/bin/env node
/**
 * PR 머지 게이트 — `PR Risk` 라벨(scripts/pr-risk-score.ts)에 따라 머지 여부를 결정론으로 정한다.
 *
 *   low    : 필수 체크 통과면 머지
 *   medium : PR 본문에 `## 동작 설명` 절이 있어야 머지
 *   high   : 현재 head 에 대한 Codex 리뷰 코멘트 + 사람이 단 `approved:human` 라벨이 있어야 머지
 *
 * 에이전트는 머지 API 를 직접 부르지 않고 이 스크립트로만 머지한다(.claude 훅이 강제).
 *
 *   node scripts/pr-merge-gate.ts <PR>                  판정만 출력
 *   node scripts/pr-merge-gate.ts <PR> --merge          판정이 merge 면 squash 머지
 *   node scripts/pr-merge-gate.ts <PR> --codex-review   PR head 체크아웃에서 Codex 리뷰를 돌려 코멘트로 남긴다
 *
 * 종료 코드: 0 머지 가능(또는 머지함) · 2 조치 필요 · 3 대기(체크 진행 중 등)
 */

import { execFileSync } from "node:child_process";
import { isMain, parseArgs as parseCliArgs } from "./lib/cli-runtime.js";

export const EXPLANATION_HEADING_RE = /^##\s*동작 설명\s*$/m;
// ponytail: 승인 라벨은 head sha 와 묶지 않는다 — 승인 후 push 를 막으려면 라벨 이벤트 시각과 마지막 커밋 시각을 비교
export const APPROVAL_LABEL = "approved:human";
export const CODEX_MARKER_PREFIX = "<!-- codex-review sha=";

export interface GateInput {
  state: string;
  mergeStateStatus: string;
  headRefOid: string;
  labels: string[];
  body: string;
  comments: string[];
  checks: { name: string; bucket: string }[];
}

export type GateDecision =
  | { action: "merge"; level: string; reasons: string[] }
  | { action: "needs"; level: string; reasons: string[] }
  | { action: "wait"; level: string; reasons: string[] };

export function codexMarker(sha: string): string {
  return `${CODEX_MARKER_PREFIX}${sha} -->`;
}

export function decide(pr: GateInput): GateDecision {
  const level = pr.labels.find((l) => l.startsWith("risk:"))?.slice(5) ?? "unknown";

  if (pr.state !== "OPEN") return { action: "needs", level, reasons: [`PR 상태가 ${pr.state}`] };

  const failed = pr.checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  if (failed.length > 0) {
    return { action: "needs", level, reasons: failed.map((c) => `체크 실패: ${c.name}`) };
  }
  const pending = pr.checks.filter((c) => c.bucket === "pending");
  if (pending.length > 0) {
    return { action: "wait", level, reasons: [`체크 진행 중 ${pending.length}개`] };
  }
  if (pr.mergeStateStatus !== "CLEAN") {
    return { action: "wait", level, reasons: [`mergeStateStatus=${pr.mergeStateStatus}`] };
  }

  if (level === "low") return { action: "merge", level, reasons: ["low — 필수 체크 통과"] };

  if (level === "medium") {
    return EXPLANATION_HEADING_RE.test(pr.body)
      ? { action: "merge", level, reasons: ["medium — 동작 설명 있음"] }
      : {
          action: "needs",
          level,
          reasons: ["medium — diff 를 읽고 PR 본문에 `## 동작 설명` 절(무엇이 왜 이렇게 동작하는지)을 추가"],
        };
  }

  if (level === "high") {
    const reasons: string[] = [];
    if (!pr.comments.some((c) => c.includes(codexMarker(pr.headRefOid)))) {
      reasons.push("high — 현재 head 에 대한 Codex 리뷰 없음: `--codex-review` 실행");
    }
    if (!pr.labels.includes(APPROVAL_LABEL)) {
      reasons.push(
        `high — 사용자 승인 없음: Codex 지적·explain-diff 요약을 보여주고, 사용자가 \`${APPROVAL_LABEL}\` 라벨을 단다`,
      );
    }
    return reasons.length === 0
      ? { action: "merge", level, reasons: ["high — Codex 리뷰 + 사용자 승인"] }
      : { action: "needs", level, reasons };
  }

  return { action: "wait", level, reasons: ["risk 라벨 없음 — PR Risk 워크플로 대기"] };
}

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf-8", input, maxBuffer: 32 * 1024 * 1024 });
}

type RollupItem = {
  __typename: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
};

const FAIL_STATES = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** CheckRun(status·conclusion)·StatusContext(state)를 pass·fail·pending 으로 접는다. */
export function bucketOf(item: RollupItem): string {
  if (item.__typename === "StatusContext") {
    const state = item.state ?? "";
    if (state === "PENDING" || state === "EXPECTED") return "pending";
    return FAIL_STATES.has(state) ? "fail" : "pass";
  }
  if (item.status !== "COMPLETED") return "pending";
  return FAIL_STATES.has(item.conclusion ?? "") ? "fail" : "pass";
}

function loadPr(pr: string): GateInput & { baseRefName: string } {
  // `gh pr checks --json` 은 gh 버전에 따라 없다 — statusCheckRollup 을 쓴다
  const view = JSON.parse(
    gh([
      "pr", "view", pr, "--json",
      "state,mergeStateStatus,headRefOid,baseRefName,labels,body,comments,statusCheckRollup",
    ]),
  ) as {
    state: string;
    mergeStateStatus: string;
    headRefOid: string;
    baseRefName: string;
    labels: { name: string }[];
    body: string;
    comments: { body: string }[];
    statusCheckRollup: RollupItem[];
  };
  return {
    state: view.state,
    mergeStateStatus: view.mergeStateStatus,
    headRefOid: view.headRefOid,
    baseRefName: view.baseRefName,
    labels: view.labels.map((l) => l.name),
    body: view.body ?? "",
    comments: view.comments.map((c) => c.body),
    checks: view.statusCheckRollup.map((c) => ({ name: c.name ?? c.context ?? "?", bucket: bucketOf(c) })),
  };
}

function runCodexReview(pr: string, data: GateInput & { baseRefName: string }): void {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  if (head !== data.headRefOid) {
    throw new Error(`현재 체크아웃 ${head.slice(0, 8)} 이 PR head ${data.headRefOid.slice(0, 8)} 와 다르다 — PR worktree 에서 실행`);
  }
  execFileSync("git", ["fetch", "-q", "origin", data.baseRefName]);
  const review = execFileSync("codex", ["review", "--base", `origin/${data.baseRefName}`], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const body = [codexMarker(data.headRefOid), `## Codex review (\`${data.headRefOid.slice(0, 8)}\`)`, "", review.trim()].join("\n");
  gh(["pr", "comment", pr, "--body-file", "-"], body);
  console.log(review.trim());
}

function main(): void {
  const { values, positionals } = parseCliArgs({
    allowPositionals: true,
    options: {
      merge: { type: "boolean", default: false },
      "codex-review": { type: "boolean", default: false },
    },
  });
  const pr = positionals[0];
  if (!pr || !/^\d+$/.test(pr)) {
    console.error("usage: node scripts/pr-merge-gate.ts <PR> [--merge | --codex-review]");
    process.exit(64);
  }

  const data = loadPr(pr);
  if (values["codex-review"]) {
    runCodexReview(pr, data);
    return;
  }

  const decision = decide(data);
  console.log(`PR #${pr} risk:${decision.level} → ${decision.action}`);
  for (const reason of decision.reasons) console.log(`- ${reason}`);

  if (decision.action === "wait") process.exit(3);
  if (decision.action === "needs") process.exit(2);
  if (values.merge) {
    const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
    const sha = gh([
      "api", "-X", "PUT", `repos/${repo}/pulls/${pr}/merge`,
      "-f", "merge_method=squash", "-f", `sha=${data.headRefOid}`, "-q", ".sha",
    ]).trim();
    console.log(`merged ${sha}`);
  }
}

if (isMain(import.meta.url)) {
  main();
}
