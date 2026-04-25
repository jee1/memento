export const AGENT_ASK_TOOL = {
  name: 'agent_ask',
  description: '기억과 웹 검색을 결합해 질문에 답합니다',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '질문 내용' },
      useSearch: { type: 'boolean', description: '웹 검색 사용 여부' },
    },
    required: ['query'],
  },
} as const;
