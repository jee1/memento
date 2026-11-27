import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
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
    expect(out?.hookSpecificOutput?.permissionDecisionReason).toContain("다른 Claude 단계의 리뷰");
  });

  it.each(["{broken", "", "[]", "null", "{}", '{"tool_input": "ls"}', '{"tool_input": {"command": 1}}'])(
    "blocks with exit 2 when the hook input cannot be read: %j",
    (input) => {
      const result = spawnSync("bash", [script], { encoding: "utf8", input });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("입력을 읽지 못해");
      expect(result.stdout).toBe("");
    },
  );

  it("blocks with exit 2 when jq is missing", () => {
    const result = spawnSync("/bin/bash", [script], {
      encoding: "utf8",
      input: JSON.stringify({ tool_input: { command: "ls" } }),
      env: { PATH: "/nonexistent" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("입력을 읽지 못해");
  });

  it.each([
    "gh pr merge 1",
    "gh  pr   merge",
    "gh -R o/r pr merge 1",
    "gh pr -R o/r merge 1",
    "gh --repo=o/r pr merge 1 --squash",
    "gh -R o/r pr --repo o/r merge 1",
    'gh pr -R "o/r" merge 1',
    "gh pr \\\n  merge 1",
    "gh -R $(cat repo) pr merge 1",
    'gh -R "$(cat repo)" pr merge 1',
    "gh -R `cat repo` pr merge 1",
    "gh -R $REPO pr merge 1",
    'gh pr -R o/r --body "a b" merge 1',
    "gh pr --body 'a b' merge 1",
    'gh api -X PUT repos/o/r/pulls/"1"/merge',
    "cd x && gh pr merge 1",
    "gh api -X PUT repos/o/r/pulls/1/merge",
    "gh api -X PUT repos/o/r/pulls/$PR/merge",
    'gh api -X PUT "repos/o/r/pulls/${PR}/merge"',
    'gh api -X PUT repos/o/r/pulls/"$PR"/merge',
    "gh api -X PUT repos/o/r/pulls/$(cat n)/merge",
    "gh api -X PUT repos/o/r/pulls/`cat n`/merge",
    "curl -X PUT https://api.github.com/repos/o/r/pulls/{number}/merge",
  ])("denies a direct merge: %j", (command) => {
    const out = parseOutput(runHook(command));
    expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it.each([
    "node scripts/pr-merge-gate.ts 1 --merge",
    "node scripts/pr-merge-gate.ts $PR --merge",
    "gh pr view 1",
    "gh pr view 1 --json mergeable,mergeCommit",
    "gh -R o/r pr view 1 --json state",
    "gh pr -R o/merge-tools list",
    "gh pr list --state merged",
    'gh pr list --search "merge"',
    'gh pr create --title "fix merge order"',
    "gh pr checks 1 && git merge --ff-only origin/main",
    "gh api repos/o/r/pulls/1",
    "gh api repos/o/r/pulls/$PR/merge-queue",
    "git diff src/pulls/utils/merge.ts",
    "gh pr view 1\ngit merge main",
    "grep -n 'pulls/<N>/merge' docs/agents/commands.md",
    "grep -n 'pulls/${pr}/merge' scripts/pr-merge-gate.ts",
    'git commit -m "chore: look at pulls/$PR/merge"',
    "cat app/pulls/{id}/merge.ts",
  ])("allows a command that does not merge a PR: %j", (command) => {
    expect(runHook(command).trim()).toBe("");
  });

  it("answers within the hook timeout for a large command with line continuations", () => {
    const command = `echo ${"가나다라마바사아자차 \\\n".repeat(12_000)}`;
    const started = Date.now();
    expect(runHook(command).trim()).toBe("");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("matches overflow with grep -F -e (broken line without -e skips deny)", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain("grep -qF -e '--allow-review-overflow'");
    expect(src).not.toMatch(/grep -qF '--allow-review-overflow'/);
  });
});
