import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Memento CLI agent skill (#112)", () => {
  const skillPath = join(root, "docs/skills/memento-cli-for-ai/SKILL.md");

  it("ships SKILL.md with matching frontmatter and CLI workflow", () => {
    const skill = readFileSync(skillPath, "utf-8");

    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: memento-cli");
    expect(skill).toMatch(/^description: .+/m);
    expect(skill).toContain("memento recall");
    expect(skill).toContain("memento remember");
    expect(skill).toContain("memory_injection");
    expect(skill).toContain("docs/guides/ko/memento-cli-for-ai.md");
    expect(skill).toContain("Do not paste source");
  });
});
