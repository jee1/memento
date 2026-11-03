import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/claude-hooks/merge-guard.sh");

function runHook(command: string): string {
  const input = JSON.stringify({ tool_input: { command } });
  return execFileSync("bash", [script], { encoding: "utf8", input });
}

type DenyPayload = {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
};

function parseOutput(stdout: string): DenyPayload | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as DenyPayload;
}

describe("merge-guard.sh", () => {
  it("denies agent bash with --allow-review-overflow", () => {
    const out = parseOutput(
      runHook("node scripts/pr-merge-gate.ts 1 --merge --allow-review-overflow"),
    );
    expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("denies commands that mention the human approval label", () => {
    const out = parseOutput(runHook("gh pr edit 1 --add-label approved:human"));
    expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows normal merge-gate --merge without hook output", () => {
    expect(runHook("node scripts/pr-merge-gate.ts 1 --merge").trim()).toBe("");
  });

  it("matches overflow with grep -F -e (broken line without -e skips deny)", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("grep -qF -e '--allow-review-overflow'");
    expect(src).not.toMatch(/grep -qF '--allow-review-overflow'/);
  });
});
