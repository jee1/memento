#!/usr/bin/env node
/**
 * PR 머지 게이트 — `PR Risk` 라벨(scripts/pr-risk-score.ts)에 따라 머지 여부를 결정론으로 정한다.
 *
 *   low    : 필수 체크 + 현재 head 의 agent-review approve 마커
 *   medium : low 조건 + PR 본문 `## 동작 설명`
 *   high   : 현재 head 리뷰(Codex 마커 또는 다른 모델 계열 agent-review approve) + 사람 `approved:human` 라벨
 *
 * PR 본문 `<!-- author-model=<id> -->` 에 작성 에이전트 모델을 적는다(high 교차 모델 판정).
 * 리뷰 마커 4개(3회 초과)면 멈춘다. 사용자가 계속하라고 하면 `--allow-review-overflow` 로 재실행.
 *
 * 에이전트는 머지 API 를 직접 부르지 않고 이 스크립트로만 머지한다(.claude 훅이 강제).
 *
 *   node scripts/pr-merge-gate.ts <PR>                  판정만 출력
 *   node scripts/pr-merge-gate.ts <PR> --merge          판정이 merge 면 squash 머지
 *   node scripts/pr-merge-gate.ts <PR> --codex-review   PR head 체크아웃에서 Codex 리뷰를 돌려 코멘트로 남긴다
 *   node scripts/pr-merge-gate.ts <PR> --post-review approve --findings 0/0/0 --model <id>
 *
 * 종료 코드: 0 머지 가능(또는 머지함) · 2 조치 필요 · 3 대기(체크 진행 중 등)
 */

import { execFileSync } from "node:child_process";
import { isMain, parseArgs as parseCliArgs } from "./lib/cli-runtime.js";

export const EXPLANATION_HEADING_RE = /^##\s*동작 설명\s*$/m;
export const APPROVAL_LABEL = "approved:human";
export const CODEX_MARKER_PREFIX = "<!-- codex-review sha=";
export const AGENT_REVIEW_MARKER_PREFIX = "<!-- agent-review ";
export const AUTHOR_MODEL_MARKER_RE = /<!--\s*author-model=([^\s>]+)\s*-->/;

const AGENT_REVIEW_MARKER_RE =
  /<!--\s*agent-review\s+sha=([a-f0-9]+)\s+verdict=(approve|changes)\s+findings=(\d+)\/(\d+)\/(\d+)\s+round=(\d+)(?:\s+model=([^\s>]+))?\s*-->/i;

export interface AgentReviewMarker {
  sha: string;
  verdict: "approve" | "changes";
  findings: { i: number; n: number; p: number };
  round: number;
  model?: string;
}

export interface GateInput {
  state: string;
  mergeStateStatus: string;
  headRefOid: string;
  labels: string[];
  body: string;
  comments: string[];
  checks: { name: string; bucket: string }[];
  authorModel?: string;
  allowReviewOverflow?: boolean;
}

export type GateDecision =
  | { action: "merge"; level: string; reasons: string[] }
  | { action: "needs"; level: string; reasons: string[] }
  | { action: "wait"; level: string; reasons: string[] };

export function codexMarker(sha: string): string {
  return `${CODEX_MARKER_PREFIX}${sha} -->`;
}

export function agentReviewMarker(input: {
  sha: string;
  verdict: "approve" | "changes";
  findings: { i: number; n: number; p: number };
  round: number;
  model: string;
}): string {
  const f = `${input.findings.i}/${input.findings.n}/${input.findings.p}`;
  return `<!-- agent-review sha=${input.sha} verdict=${input.verdict} findings=${f} round=${input.round} model=${input.model} -->`;
}

export function parseAuthorModel(body: string): string | undefined {
  return body.match(AUTHOR_MODEL_MARKER_RE)?.[1];
}

export function parseAgentReviewMarkers(comments: string[]): AgentReviewMarker[] {
  const out: AgentReviewMarker[] = [];
  for (const comment of comments) {
    for (const match of comment.matchAll(new RegExp(AGENT_REVIEW_MARKER_RE.source, "gi"))) {
      out.push({
        sha: match[1]!,
        verdict: match[2]!.toLowerCase() as "approve" | "changes",
        findings: { i: Number(match[3]), n: Number(match[4]), p: Number(match[5]) },
        round: Number(match[6]),
        model: match[7],
      });
    }
  }
  return out;
}

export function countAgentReviewMarkers(comments: string[]): number {
  return parseAgentReviewMarkers(comments).length;
}

export function hasHeadAgentApprove(comments: string[], headSha: string): boolean {
  return parseAgentReviewMarkers(comments).some((m) => m.sha === headSha && m.verdict === "approve");
}

export function lastApprovedSha(comments: string[]): string | undefined {
  const approved = parseAgentReviewMarkers(comments).filter((m) => m.verdict === "approve");
  return approved.length > 0 ? approved[approved.length - 1]!.sha : undefined;
}

/** 모델 id 를 거친 계열 키로 접는다(high 교차 리뷰용). */
export function modelFamily(model: string): string {
  const id = model.toLowerCase();
  if (id.includes("claude")) return "claude";
  if (id.includes("composer")) return "composer";
  if (id.includes("grok")) return "grok";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("codex") || id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"))
    return "openai";
  return id.split(/[-_.]/)[0] ?? id;
}

export function isDifferentModelFamily(authorModel: string, reviewerModel: string): boolean {
  return modelFamily(authorModel) !== modelFamily(reviewerModel);
}

export function hasHeadCodexReview(comments: string[], headSha: string): boolean {
  return comments.some((c) => c.includes(codexMarker(headSha)));
}

export function highHeadReviewOk(comments: string[], headSha: string, authorModel?: string): boolean {
  if (hasHeadCodexReview(comments, headSha)) return true;
  const headApprove = parseAgentReviewMarkers(comments).find(
    (m) => m.sha === headSha && m.verdict === "approve",
  );
  if (!headApprove?.model) return false;
  if (!authorModel) return false;
  return isDifferentModelFamily(authorModel, headApprove.model);
}

const REVIEW_OVERFLOW_REASON =
  "조치 필요 — 3회 초과, 접근 재검토 (사용자가 계속하라고 하면 `node scripts/pr-merge-gate.ts <PR> --merge --allow-review-overflow`)";

const RISK_ORDER = ["low", "medium", "high"];

export function highestRiskLevel(labels: string[]): string {
  const levels = labels.filter((l) => l.startsWith("risk:")).map((l) => l.slice(5));
  if (levels.length === 0 || levels.some((l) => !RISK_ORDER.includes(l))) return "unknown";
  return levels.reduce((a, b) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b));
}

function reviewRoundBlock(pr: GateInput): string | undefined {
  if (pr.allowReviewOverflow) return undefined;
  if (countAgentReviewMarkers(pr.comments) >= 4) return REVIEW_OVERFLOW_REASON;
  return undefined;
}

function headApproveReason(level: string): string {
  return `${level} — 현재 head 에 대한 agent-review approve 없음: \`--post-review approve --findings I/N/P --model <model>\``;
}

export function decide(pr: GateInput): GateDecision {
  const level = highestRiskLevel(pr.labels);

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

  const roundBlock = reviewRoundBlock(pr);
  if (roundBlock) return { action: "needs", level, reasons: [roundBlock] };

  if (level === "low") {
    return hasHeadAgentApprove(pr.comments, pr.headRefOid)
      ? { action: "merge", level, reasons: ["low — 필수 체크 + head approve"] }
      : { action: "needs", level, reasons: [headApproveReason("low")] };
  }

  if (level === "medium") {
    const reasons: string[] = [];
    if (!EXPLANATION_HEADING_RE.test(pr.body)) {
      reasons.push(
        "medium — diff 를 읽고 PR 본문에 `## 동작 설명` 절(무엇이 왜 이렇게 동작하는지)을 추가",
      );
    }
    if (!hasHeadAgentApprove(pr.comments, pr.headRefOid)) reasons.push(headApproveReason("medium"));
    return reasons.length === 0
      ? { action: "merge", level, reasons: ["medium — 동작 설명 + head approve"] }
      : { action: "needs", level, reasons };
  }

  if (level === "high") {
    const reasons: string[] = [];
    if (!highHeadReviewOk(pr.comments, pr.headRefOid, pr.authorModel)) {
      if (!pr.authorModel) {
        reasons.push(
          "high — PR 본문에 `<!-- author-model=<작성 모델> -->` 가 필요하고, 다른 모델 계열의 agent-review approve 또는 Codex 리뷰가 필요",
        );
      } else if (hasHeadAgentApprove(pr.comments, pr.headRefOid)) {
        reasons.push(
          "high — head agent-review 가 작성자와 같은 모델 계열: 다른 계열 리뷰어로 `--post-review approve` 또는 Codex `--codex-review`",
        );
      } else {
        reasons.push(
          "high — 현재 head 리뷰 없음: 다른 모델 `--post-review approve` 또는 `--codex-review`",
        );
      }
    }
    if (!pr.labels.includes(APPROVAL_LABEL)) {
      reasons.push(
        `high — 사용자 승인 없음: 리뷰 요약을 보여주고, 사용자가 \`${APPROVAL_LABEL}\` 라벨을 단다`,
      );
    }
    return reasons.length === 0
      ? { action: "merge", level, reasons: ["high — head 리뷰 + 사용자 승인"] }
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
  const body = view.body ?? "";
  return {
    state: view.state,
    mergeStateStatus: view.mergeStateStatus,
    headRefOid: view.headRefOid,
    baseRefName: view.baseRefName,
    labels: view.labels.map((l) => l.name),
    body,
    comments: view.comments.map((c) => c.body),
    checks: view.statusCheckRollup.map((c) => ({ name: c.name ?? c.context ?? "?", bucket: bucketOf(c) })),
    authorModel: parseAuthorModel(body),
  };
}

function parseFindings(raw: string): { i: number; n: number; p: number } {
  const m = raw.match(/^(\d+)\/(\d+)\/(\d+)$/);
  if (!m) throw new Error("--findings 는 I/N/P 형식(예: 0/0/0)이어야 한다");
  return { i: Number(m[1]), n: Number(m[2]), p: Number(m[3]) };
}

function runPostReview(
  pr: string,
  data: GateInput & { baseRefName: string },
  verdict: "approve" | "changes",
  findings: { i: number; n: number; p: number },
  model: string,
): void {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  if (head !== data.headRefOid) {
    throw new Error(`현재 체크아웃 ${head.slice(0, 8)} 이 PR head ${data.headRefOid.slice(0, 8)} 와 다르다 — PR worktree 에서 실행`);
  }
  const round = countAgentReviewMarkers(data.comments) + 1;
  const marker = agentReviewMarker({
    sha: data.headRefOid,
    verdict,
    findings,
    round,
    model,
  });
  const f = `${findings.i}/${findings.n}/${findings.p}`;
  const body = [
    marker,
    `## Agent review (\`${data.headRefOid.slice(0, 8)}\`)`,
    "",
    `verdict: ${verdict} · findings: ${f} · round: ${round}`,
  ].join("\n");
  gh(["pr", "comment", pr, "--body-file", "-"], body);

  const prev = lastApprovedSha(data.comments);
  if (prev && prev !== data.headRefOid) {
    console.log(`재리뷰 diff: git diff ${prev}..${data.headRefOid}`);
  } else {
    execFileSync("git", ["fetch", "-q", "origin", data.baseRefName]);
    console.log(`전체 diff: git diff origin/${data.baseRefName}..${data.headRefOid}`);
  }
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
      "post-review": { type: "string" },
      findings: { type: "string" },
      model: { type: "string" },
      "allow-review-overflow": { type: "boolean", default: false },
    },
  });
  const pr = positionals[0];
  if (!pr || !/^\d+$/.test(pr)) {
    console.error(
      "usage: node scripts/pr-merge-gate.ts <PR> [--merge | --codex-review | --post-review approve|changes --findings I/N/P --model <id>]",
    );
    process.exit(64);
  }

  const data = loadPr(pr);
  if (values["codex-review"]) {
    runCodexReview(pr, data);
    return;
  }

  const postReview = values["post-review"];
  if (postReview !== undefined) {
    const verdict = postReview.toLowerCase();
    if (verdict !== "approve" && verdict !== "changes") {
      console.error("--post-review 는 approve 또는 changes");
      process.exit(64);
    }
    const model = values.model;
    if (!model) {
      console.error("--post-review 는 --model 이 필요");
      process.exit(64);
    }
    const findingsRaw = values.findings ?? "0/0/0";
    runPostReview(pr, data, verdict, parseFindings(findingsRaw), model);
    return;
  }

  const decision = decide({ ...data, allowReviewOverflow: values["allow-review-overflow"] === true });
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
