#!/usr/bin/env node
/**
 * PR 머지 게이트 — `PR Risk` 라벨(scripts/pr-risk-score.ts)에 따라 머지 여부를 결정론으로 정한다.
 *
 *   low    : 필수 체크 + 현재 head 의 agent-review approve 마커(리뷰어 모델별 마지막 마커)
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
// ponytail: 승인 라벨은 head sha 와 묶지 않는다 — 승인 후 push 를 막으려면 라벨 이벤트 시각과 마지막 커밋 시각을 비교
export const APPROVAL_LABEL = "approved:human";
export const CODEX_MARKER_PREFIX = "<!-- codex-review sha=";
export const AGENT_REVIEW_MARKER_PREFIX = "<!-- agent-review ";
export const AUTHOR_MODEL_MARKER_RE = /<!--\s*author-model=([^\s>]+)\s*-->/;

const AGENT_REVIEW_LINE_RE =
  /^\s*<!--\s*agent-review\s+sha=([a-f0-9]+)\s+verdict=(approve|changes)\s+findings=(\d+)\/(\d+)\/(\d+)\s+round=(\d+)(?:\s+model=([^\s>]+))?\s*-->\s*$/i;

const CODEX_REVIEW_LINE_RE = /^\s*<!--\s*codex-review\s+sha=([a-f0-9]+)\s*-->\s*$/i;

export interface AgentReviewMarker {
  sha: string;
  verdict: "approve" | "changes";
  findings: { i: number; n: number; p: number };
  round: number;
  model?: string;
}

export interface GateComment {
  body: string;
  authorLogin: string;
}

export interface GateInput {
  state: string;
  mergeStateStatus: string;
  headRefOid: string;
  labels: string[];
  body: string;
  comments: GateComment[];
  checks: { name: string; bucket: string }[];
  repoOwnerLogin: string;
  authorModel?: string;
  allowReviewOverflow?: boolean;
  prNumber?: string;
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

export function commentFirstLine(body: string): string {
  return body.split("\n")[0] ?? "";
}

/** 인용·펜스·들여쓰기 코드 예시 줄은 마커로 세지 않는다. */
export function isExcludedMarkerLine(line: string): boolean {
  if (/^\s*```/.test(line)) return true;
  if (/^(?: {4}|\t)/.test(line)) return true;
  if (/^>\s/.test(line)) return true;
  return false;
}

/** 코멘트 첫 줄의 agent-review 마커 1개만 파싱한다. */
export function parseAgentReviewMarkerLine(line: string): AgentReviewMarker | undefined {
  const match = line.match(AGENT_REVIEW_LINE_RE);
  if (!match) return undefined;
  return {
    sha: match[1]!,
    verdict: match[2]!.toLowerCase() as "approve" | "changes",
    findings: { i: Number(match[3]), n: Number(match[4]), p: Number(match[5]) },
    round: Number(match[6]),
    model: match[7],
  };
}

export function parseAgentReviewMarkerFromCommentFirstLine(body: string): AgentReviewMarker | undefined {
  const line = commentFirstLine(body);
  if (isExcludedMarkerLine(line)) return undefined;
  return parseAgentReviewMarkerLine(line);
}

/** 저장소 소유자 코멘트에서만, 첫 줄 마커 1개씩 수집한다. */
export function parseTrustedAgentReviewMarkers(
  comments: GateComment[],
  repoOwnerLogin: string,
): AgentReviewMarker[] {
  const owner = repoOwnerLogin.toLowerCase();
  const out: AgentReviewMarker[] = [];
  for (const comment of comments) {
    if (comment.authorLogin.toLowerCase() !== owner) continue;
    const marker = parseAgentReviewMarkerFromCommentFirstLine(comment.body);
    if (marker) out.push(marker);
  }
  return out;
}

export function parseAgentReviewMarkers(comments: GateComment[], repoOwnerLogin: string): AgentReviewMarker[] {
  return parseTrustedAgentReviewMarkers(comments, repoOwnerLogin);
}

export function countAgentReviewMarkers(comments: GateComment[], repoOwnerLogin: string): number {
  return parseTrustedAgentReviewMarkers(comments, repoOwnerLogin).length;
}

/** head sha 별 리뷰어 model 키마다 마지막 마커만 남긴다. */
export function lastMarkersPerModelOnHead(
  markers: AgentReviewMarker[],
  headSha: string,
): AgentReviewMarker[] {
  const byModel = new Map<string, AgentReviewMarker>();
  for (const marker of markers) {
    if (marker.sha !== headSha) continue;
    const key = (marker.model ?? "").toLowerCase();
    byModel.set(key, marker);
  }
  return [...byModel.values()];
}

export function hasHeadAgentApprove(
  comments: GateComment[],
  headSha: string,
  repoOwnerLogin: string,
): boolean {
  const markers = parseTrustedAgentReviewMarkers(comments, repoOwnerLogin);
  return lastMarkersPerModelOnHead(markers, headSha).some((m) => m.verdict === "approve");
}

export function lastApprovedSha(comments: GateComment[], repoOwnerLogin: string): string | undefined {
  const approved = parseTrustedAgentReviewMarkers(comments, repoOwnerLogin).filter(
    (m) => m.verdict === "approve",
  );
  return approved.length > 0 ? approved[approved.length - 1]!.sha : undefined;
}

/** 모델 id 를 거친 계열 키로 접는다(high 교차 리뷰용). 알 수 없으면 undefined(fail-closed). */
export function modelFamily(model: string): string | undefined {
  const id = model.toLowerCase();
  if (
    /^(opus|sonnet|haiku|fable)([-_.]|$)/.test(id) ||
    id.startsWith("claude-") ||
    id === "claude" ||
    id.includes("claude")
  ) {
    return "claude";
  }
  if (id.includes("composer") || id.includes("cursor")) return "cursor";
  if (id.includes("gpt") || id.includes("codex") || id.includes("sol") || id.includes("luna")) return "openai";
  if (id.includes("gemini")) return "google";
  return undefined;
}

export function isDifferentModelFamily(authorModel: string, reviewerModel: string): boolean {
  const author = modelFamily(authorModel);
  const reviewer = modelFamily(reviewerModel);
  if (author === undefined || reviewer === undefined) return false;
  return author !== reviewer;
}

/** 저장소 소유자 코멘트 첫 줄의 codex-review 마커(코멘트당 1개)만 인정한다. */
export function hasHeadCodexReview(
  comments: GateComment[],
  headSha: string,
  repoOwnerLogin: string,
): boolean {
  const owner = repoOwnerLogin.toLowerCase();
  for (const comment of comments) {
    if (comment.authorLogin.toLowerCase() !== owner) continue;
    const line = commentFirstLine(comment.body);
    if (isExcludedMarkerLine(line)) continue;
    const match = line.match(CODEX_REVIEW_LINE_RE);
    if (match && match[1] === headSha) return true;
  }
  return false;
}

export function highHeadReviewOk(
  comments: GateComment[],
  headSha: string,
  repoOwnerLogin: string,
  authorModel?: string,
): boolean {
  if (hasHeadCodexReview(comments, headSha, repoOwnerLogin)) return true;
  if (!authorModel || modelFamily(authorModel) === undefined) return false;
  const markers = parseTrustedAgentReviewMarkers(comments, repoOwnerLogin);
  return lastMarkersPerModelOnHead(markers, headSha).some(
    (m) =>
      m.verdict === "approve" &&
      m.model !== undefined &&
      isDifferentModelFamily(authorModel, m.model),
  );
}

export function reviewOverflowReason(prNumber?: string): string {
  const n = prNumber ?? "<번호>";
  return `조치 필요 — 3회 초과, 접근 재검토 (사용자가 계속하라고 하면 \`! node scripts/pr-merge-gate.ts ${n} --merge --allow-review-overflow\`)`;
}

const RISK_ORDER = ["low", "medium", "high"];

// 수동 상향 직후 워크플로가 정리하기 전에는 risk 라벨이 둘 이상일 수 있다 — 가장 높은 등급을 쓴다. 모르는 값이 섞이면 unknown(대기).
export function highestRiskLevel(labels: string[]): string {
  const levels = labels.filter((l) => l.startsWith("risk:")).map((l) => l.slice(5));
  if (levels.length === 0 || levels.some((l) => !RISK_ORDER.includes(l))) return "unknown";
  return levels.reduce((a, b) => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b));
}

function reviewRoundBlock(pr: GateInput): string | undefined {
  if (pr.allowReviewOverflow) return undefined;
  if (countAgentReviewMarkers(pr.comments, pr.repoOwnerLogin) >= 4) {
    return reviewOverflowReason(pr.prNumber);
  }
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
    return hasHeadAgentApprove(pr.comments, pr.headRefOid, pr.repoOwnerLogin)
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
    if (!hasHeadAgentApprove(pr.comments, pr.headRefOid, pr.repoOwnerLogin)) {
      reasons.push(headApproveReason("medium"));
    }
    return reasons.length === 0
      ? { action: "merge", level, reasons: ["medium — 동작 설명 + head approve"] }
      : { action: "needs", level, reasons };
  }

  if (level === "high") {
    const reasons: string[] = [];
    if (!highHeadReviewOk(pr.comments, pr.headRefOid, pr.repoOwnerLogin, pr.authorModel)) {
      if (!pr.authorModel) {
        reasons.push(
          "high — PR 본문에 `<!-- author-model=<작성 모델> -->` 가 필요하고, 다른 모델 계열의 agent-review approve 또는 Codex 리뷰가 필요",
        );
      } else if (hasHeadAgentApprove(pr.comments, pr.headRefOid, pr.repoOwnerLogin)) {
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

export type RollupItem = {
  __typename: string;
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  state?: string;
};

const FAIL_STATES = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

export function checkKey(item: Pick<RollupItem, "workflowName" | "name" | "context">): string {
  const wf = item.workflowName ?? "";
  const n = item.name ?? item.context ?? "?";
  return `${wf}:${n}`;
}

export function isCancelledRollup(item: RollupItem): boolean {
  return item.status === "COMPLETED" && item.conclusion === "CANCELLED";
}

function isSubstituteRollup(item: RollupItem): boolean {
  return !isCancelledRollup(item) && item.conclusion !== "SKIPPED";
}

/** rollup → decide() 가 쓰는 check 목록. loadPr 과 스펙이 같은 변환을 쓴다. */
export function checksFromRollup(items: RollupItem[]): { name: string; bucket: string }[] {
  return filterDuplicateCancelledRollup(items).map((c) => ({
    name: c.name ?? c.context ?? "?",
    bucket: bucketOf(c),
  }));
}

/** 같은 workflow·이름의 비취소 실행이 있으면 취소된 중복만 판정에서 뺀다. 취소만 있으면 그대로 둔다. */
export function filterDuplicateCancelledRollup(items: RollupItem[]): RollupItem[] {
  const byKey = new Map<string, RollupItem[]>();
  for (const item of items) {
    const key = checkKey(item);
    const group = byKey.get(key) ?? [];
    group.push(item);
    byKey.set(key, group);
  }
  const out: RollupItem[] = [];
  for (const group of byKey.values()) {
    const hasSubstitute = group.some((i) => isSubstituteRollup(i));
    if (hasSubstitute) {
      out.push(...group.filter((i) => !isCancelledRollup(i)));
    } else {
      out.push(...group);
    }
  }
  return out;
}

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
  const repoOwnerLogin = gh(["repo", "view", "--json", "owner", "-q", ".owner.login"]).trim();
  const view = JSON.parse(
    gh([
      "pr",
      "view",
      pr,
      "--json",
      "state,mergeStateStatus,headRefOid,baseRefName,labels,body,comments,statusCheckRollup",
    ]),
  ) as {
    state: string;
    mergeStateStatus: string;
    headRefOid: string;
    baseRefName: string;
    labels: { name: string }[];
    body: string;
    comments: { body: string; author: { login: string } }[];
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
    comments: view.comments.map((c) => ({ body: c.body, authorLogin: c.author.login })),
    checks: checksFromRollup(view.statusCheckRollup ?? []),
    repoOwnerLogin,
    authorModel: parseAuthorModel(body),
    prNumber: pr,
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
    throw new Error(
      `현재 체크아웃 ${head.slice(0, 8)} 이 PR head ${data.headRefOid.slice(0, 8)} 와 다르다 — PR worktree 에서 실행`,
    );
  }
  const round = countAgentReviewMarkers(data.comments, data.repoOwnerLogin) + 1;
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

  const prev = lastApprovedSha(data.comments, data.repoOwnerLogin);
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
    throw new Error(
      `현재 체크아웃 ${head.slice(0, 8)} 이 PR head ${data.headRefOid.slice(0, 8)} 와 다르다 — PR worktree 에서 실행`,
    );
  }
  execFileSync("git", ["fetch", "-q", "origin", data.baseRefName]);
  const review = execFileSync("codex", ["review", "--base", `origin/${data.baseRefName}`], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const body = [
    codexMarker(data.headRefOid),
    `## Codex review (\`${data.headRefOid.slice(0, 8)}\`)`,
    "",
    review.trim(),
  ].join("\n");
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
      "api",
      "-X",
      "PUT",
      `repos/${repo}/pulls/${pr}/merge`,
      "-f",
      "merge_method=squash",
      "-f",
      `sha=${data.headRefOid}`,
      "-q",
      ".sha",
    ]).trim();
    console.log(`merged ${sha}`);
  }
}

if (isMain(import.meta.url)) {
  main();
}
