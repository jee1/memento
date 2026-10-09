import { describe, expect, it } from 'vitest';
import { CORE_TOOLSET, getToolRegistry } from './index.js';

/**
 * #1292: MCP 도구 surface(이름·설명·입력 스키마)는 외부 계약이다. 내부 정리 PR 이 이것을
 * 바꾸면 이 스냅샷이 깨진다. 의도한 계약 변경이면 `vitest -u` 로 갱신하고 PR 에 이유를 적는다.
 */
describe('MCP tool surface contract', () => {
  it('keeps every registered tool name, description and input schema unchanged', () => {
    const surface = getToolRegistry()
      .getAll()
      .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));

    expect({ core: [...CORE_TOOLSET].sort(), tools: surface }).toMatchSnapshot();
  });
});
