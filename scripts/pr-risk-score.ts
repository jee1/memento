#!/usr/bin/env node
/**
 * PR 리스크 스코어 (0–100) — 리뷰 깊이 라우팅용 advisory 지표
 *
 * 보안 30 · 범위 20 · 파괴적 변경 20 · 테스트 누락 15 · DB 마이그레이션 15.
 * 차단하지 않는다. 머지 차단권은 lint·type-check·test 같은 결정론적 required check 에만 있다.
 *
 * 사용법:
 *   node scripts/pr-risk-score.ts [--base origin/main] [--head HEAD] [--title "<PR 제목>"] [--json]
 */
import { execFileSync } from "node:child_process";
import { isMain, parseArgs as parseCliArgs } from "./lib/cli-runtime.js";

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export type RiskLevel = "low" | "medium" | "high";

export interface RiskFactor {
  name: string;
  points: number;
  max: number;
  reason: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

const TEST_RE = /(\.(spec|test)\.[cm]?[jt]s$|\/__tests__\/|^tests\/)/;
const NON_CODE_RE = /(\.md$|^docs\/|package-lock\.json$|^CHANGELOG)/;
const SOURCE_RE = /^(packages|apps|scripts|static)\/.*\.[cm]?[jt]s$/;
const SECURITY_RE =
  /(auth|token|secur|crypto|session|permission|cors|secret|pii|sanitiz|path-traversal)/i;
const MIGRATION_RE = /(\/migrations\/|schema\.sql$)/;
// 외부에 보이는 계약: MCP 도구 스키마, 클라이언트 SDK, 배포 설정, 패키지 매니페스트
const PUBLIC_SURFACE_RE =
  /(^packages\/memento-core\/src\/(tools|domains\/[^/]+\/tools)\/|^packages\/memento-client\/src\/|^docker-compose[^/]*\.yml$|^\.env\.example$|^config\/|(^|\/)package\.json$)/;
const BREAKING_TITLE_RE = /(^\w+(\([^)]*\))?!:|BREAKING)/;

export function scoreRisk(files: ChangedFile[], title = ""): RiskResult {
  const code = files.filter(
    (f) => !NON_CODE_RE.test(f.path) && !TEST_RE.test(f.path),
  );
  const tests = files.filter((f) => TEST_RE.test(f.path));
  const factors: RiskFactor[] = [];

  const securityHits = code
    .filter((f) => SECURITY_RE.test(f.path))
    .map((f) => f.path);
  factors.push({
    name: "보안",
    max: 30,
    points: securityHits.length > 0 ? 30 : 0,
    reason:
      securityHits.length > 0
        ? securityHits.slice(0, 5).join(", ")
        : "보안 경로 변경 없음",
  });

  const lines = code.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const byLines = lines >= 500 ? 20 : lines >= 200 ? 12 : lines >= 50 ? 5 : 0;
  const byFiles = code.length >= 20 ? 20 : 0;
  factors.push({
    name: "범위",
    max: 20,
    points: Math.max(byLines, byFiles),
    reason: `코드 ${code.length}개 파일 · ${lines}줄 (테스트·문서·lockfile 제외)`,
  });

  const surfaceHits = code
    .filter((f) => PUBLIC_SURFACE_RE.test(f.path))
    .map((f) => f.path);
  const breakingTitle = BREAKING_TITLE_RE.test(title);
  factors.push({
    name: "파괴적 변경",
    max: 20,
    points: breakingTitle || surfaceHits.length > 0 ? 20 : 0,
    reason: breakingTitle
      ? "PR 제목에 breaking 표기"
      : surfaceHits.length > 0
        ? `공개 계약 변경: ${surfaceHits.slice(0, 5).join(", ")}`
        : "공개 계약 변경 없음",
  });

  const sourceChanged = code.some((f) => SOURCE_RE.test(f.path));
  factors.push({
    name: "테스트",
    max: 15,
    points: sourceChanged && tests.length === 0 ? 15 : 0,
    reason: !sourceChanged
      ? "소스 변경 없음"
      : tests.length === 0
        ? "소스는 바뀌었는데 테스트 변경 없음"
        : `테스트 ${tests.length}개 파일 변경`,
  });

  const migrations = files
    .filter((f) => MIGRATION_RE.test(f.path))
    .map((f) => f.path);
  factors.push({
    name: "DB 마이그레이션",
    max: 15,
    points: migrations.length > 0 ? 15 : 0,
    reason: migrations.length > 0 ? migrations.join(", ") : "마이그레이션 없음",
  });

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const level: RiskLevel =
    score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, factors };
}

const ROUTING: Record<RiskLevel, string> = {
  low: "필수 체크 통과면 머지해도 된다.",
  medium:
    '작성자가 diff 를 직접 읽고, PR 본문에 "무엇이 왜 이렇게 동작하는지"를 자기 말로 적은 뒤 머지한다.',
  high: "심층 리뷰(`/code-review high` 또는 작성 모델과 다른 모델의 교차 리뷰)를 돌리고, 지적을 정리한 뒤 사람이 승인한다.",
};

export function renderMarkdown(result: RiskResult): string {
  const rows = result.factors.map(
    (f) => `| ${f.name} | ${f.points}/${f.max} | ${f.reason} |`,
  );
  return [
    `<!-- pr-risk-score -->`,
    `## PR 리스크: **${result.level}** (${result.score}/100)`,
    "",
    `> ${ROUTING[result.level]}`,
    "",
    "| 항목 | 점수 | 근거 |",
    "|---|---|---|",
    ...rows,
    "",
    "<sub>advisory 지표다. 머지를 막지 않는다 — `scripts/pr-risk-score.ts`</sub>",
  ].join("\n");
}

export function parseNumstat(output: string): ChangedFile[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [add, del, ...rest] = line.split("\t");
      // 바이너리는 '-' 로 나온다
      return {
        path: rest.join("\t"),
        additions: Number(add) || 0,
        deletions: Number(del) || 0,
      };
    });
}

function main(): void {
  const { values } = parseCliArgs({
    options: {
      base: { type: "string", default: "origin/main" },
      head: { type: "string", default: "HEAD" },
      title: { type: "string", default: "" },
      json: { type: "boolean", default: false },
    },
  });
  const numstat = execFileSync(
    "git",
    ["diff", "--numstat", "--no-renames", `${values.base}...${values.head}`],
    {
      encoding: "utf-8",
    },
  );
  const result = scoreRisk(parseNumstat(numstat), String(values.title));
  const markdown = renderMarkdown(result);
  console.log(values.json ? JSON.stringify({ ...result, markdown }) : markdown);
}

if (isMain(import.meta.url)) {
  main();
}
