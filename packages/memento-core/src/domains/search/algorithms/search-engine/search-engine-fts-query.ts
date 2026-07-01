/**
 * FTS5 쿼리 빌드·전처리
 */

import { mcpLogger } from '../../../../server/mcp-logger.js';
import { HYBRID_SEARCH } from '../../../../shared/config/constants.js';
import { getStopWords } from '../../../../shared/utils/stopwords.js';

export function buildFTSQuery(query: string): string {
  mcpLogger.logServer('debug', '원본 쿼리', { query });

  const preprocessedQuery = preprocessQuery(query);
  mcpLogger.logServer('debug', '전처리 후 쿼리', { preprocessedQuery });

  if (preprocessedQuery.length === 0) {
    mcpLogger.logServer('debug', '빈 쿼리, 모든 문서 검색');
    return '""';
  }

  const words = preprocessedQuery.split(' ').filter(w => w.length > 0);
  const orThreshold = HYBRID_SEARCH.FTS_OR_ABOVE_TOKEN_COUNT;
  const maxTokens = HYBRID_SEARCH.FTS_MAX_TOKENS_FOR_OR;
  const ftsQueryString = words.length > orThreshold
    ? words.slice(0, maxTokens).join(' OR ')
    : preprocessedQuery;

  const safeQuery = makeFTSSafe(ftsQueryString);
  mcpLogger.logServer('debug', 'FTS5 안전 쿼리', { safeQuery });

  if (safeQuery.length === 0) {
    mcpLogger.logServer('debug', '안전 쿼리 빈 문자열, 모든 문서 검색');
    return '""';
  }

  return safeQuery;
}

export function preprocessQuery(query: string): string {
  let processed = query.trim().replace(/\s+/g, ' ');

  processed = processed.replace(/[^a-zA-Z0-9가-힣\s]/g, ' ');

  processed = processed.replace(/\s+/g, ' ');

  const stopWords = getStopWords();
  const words = processed.split(' ').filter(word =>
    word.length > 0 && !stopWords.has(word.toLowerCase())
  );

  return words.join(' ');
}

export function makeFTSSafe(query: string): string {
  return query
    .replace(/"/g, '""')
    .replace(/'/g, "''")
    .replace(/[[\]{}()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
