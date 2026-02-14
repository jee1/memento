/**
 * search_web_with_memory 툴
 * 하는 일: context 키워드 + query로 검색, 결과 요약 반환
 * 연관: SearchProvider, registry, actionableLoop
 */

import type { Tool, ToolResult } from './baseTool.js';
import type { SearchProvider } from '../clients/searchClient.js';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '사용자 검색 쿼리' },
    context: { type: 'string', description: '기억에서 추출한 맥락 키워드' }
  },
  required: ['query']
};

export function createSearchTool(provider: SearchProvider): Tool<{ query: string; context?: string }> {
  return {
    name: 'search_web_with_memory',
    description: 'Personalized web search using memory context',
    inputSchema: INPUT_SCHEMA,
    async execute(input) {
      const { query, context } = input;
      const result = await provider.search(query, context);
      return {
        summary: result.summary,
        raw: { links: result.links, snippets: result.snippets }
      };
    }
  };
}
