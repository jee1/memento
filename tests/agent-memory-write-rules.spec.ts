import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const WRITE_RULES = [
  "기억에 코드를 붙여 넣지 않는다. 저장소 상대 경로, 수정한 함수나 클래스 이름, 바뀐 시그니처, 확정한 상수나 정규식만 적는다.",
  "완료 작업의 `episodic` 기록은 그대로 남긴다. `semantic`과 `procedural`은 세 조건을 모두 만족할 때만 남긴다. 문제가 반복된다. 내용은 결정 근거, 여러 단계의 우회, 다시 쓰는 절차다. 다음 에이전트가 검색 결과를 그대로 쓴다.",
];

describe("agent memory write rules (#1429)", () => {
  it.each(["AGENTS.md", "docs/agents/agent-workflow.md"])(
    "%s states the coordinate rule and the value bar",
    (relativePath) => {
      const text = readFileSync(join(root, relativePath), "utf-8");
      for (const rule of WRITE_RULES) {
        expect(text).toContain(rule);
      }
    },
  );
});
