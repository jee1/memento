/**
 * 검색 Provider 추상화
 * 하는 일: search_web_with_memory에서 사용. API 또는 Playwright 구현체 교체 가능
 * 연관: searchTool, PRD FR-5
 */

export interface SearchResult {
  summary: string;
  links: string[];
  snippets: string[];
}

export interface SearchProvider {
  search(query: string, context?: string): Promise<SearchResult>;
}

/** 스텁: 실제 검색 API(Tavily/SerpAPI 등) 연동 전까지 고정 응답 */
export class StubSearchProvider implements SearchProvider {
  async search(query: string, context?: string): Promise<SearchResult> {
    return {
      summary: `검색 스텁: "${query}"${context ? ` (맥락: ${context.slice(0, 50)}...)` : ''}. 실제 연동은 AGENT_SEARCH_PROVIDER 설정으로 교체 가능합니다.`,
      links: [],
      snippets: []
    };
  }
}
