import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkflow(): string {
  return readFileSync(join(process.cwd(), ".github/workflows/security-check.yml"), "utf-8");
}

describe("security-check workflow", () => {
  it("runs lint without forwarding positional args into nested npm scripts", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("- name: ESLint Security Check");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).not.toContain("npm run lint -- --max-warnings 500");
  });
});
