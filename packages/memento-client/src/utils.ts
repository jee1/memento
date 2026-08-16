/**
 * @jee1/memento-client 유틸리티 함수들
 * 클라이언트 라이브러리 사용을 편리하게 하는 헬퍼 함수들
 */

export {
  isValidMemoryType,
  isValidPrivacyScope,
  isValidImportance,
  validateCreateMemoryParams,
  validateSearchParams,
} from './client/validation-utils.js';

export {
  extractTagsFromContent,
  summarizeContent,
  calculateImportance,
  getDefaultSettingsForType,
  serializeMemory,
  deserializeMemory,
} from './client/memory-utils.js';

export {
  normalizeQuery,
  normalizeScore,
  groupSearchResults,
} from './client/search-utils.js';

export {
  getRelativeTime,
  createDateRangeFilter,
} from './client/time-utils.js';

export {
  memoriesToCSV,
  memoriesToMarkdown,
} from './client/format-utils.js';

export { createMementoClient } from './client/factory.js';
