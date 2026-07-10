import type { MemoryItem } from '../types.js';

/**
 * CSV 셀 값을 안전하게 이스케이프
 */
function toSafeCSVCell(value: string | null | undefined): string {
  if (value == null) return '';

  const neutralizedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;

  return `"${neutralizedValue.replace(/"/g, '""')}"`;
}

/**
 * 메모리 배열을 CSV로 변환
 */
export function memoriesToCSV(memories: MemoryItem[]): string {
  if (memories.length === 0) return '';

  const headers = [
    'id',
    'content',
    'type',
    'importance',
    'created_at',
    'last_accessed',
    'pinned',
    'tags',
    'privacy_scope',
    'source',
  ];

  const rows = memories.map(memory => [
    memory.id,
    toSafeCSVCell(memory.content),
    memory.type,
    memory.importance,
    memory.created_at,
    memory.last_accessed || '',
    memory.pinned,
    memory.tags?.length ? toSafeCSVCell(memory.tags.join(';')) : '',
    memory.privacy_scope,
    memory.source ? toSafeCSVCell(memory.source) : '',
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

/**
 * 메모리 배열을 Markdown으로 변환
 */
export function memoriesToMarkdown(memories: MemoryItem[]): string {
  if (memories.length === 0) return '# 기억이 없습니다\n';

  let markdown = `# 기억 목록 (${memories.length}개)\n\n`;

  for (const memory of memories) {
    const typeEmoji = {
      working: '⚡',
      episodic: '📅',
      semantic: '🧠',
      procedural: '🔧',
      core: '⭐',
      vault: '🔒',
    }[memory.type] || '📝';

    const importanceBar = '★'.repeat(Math.round(memory.importance * 5)) +
                         '☆'.repeat(5 - Math.round(memory.importance * 5));

    markdown += `## ${typeEmoji} ${memory.id}\n\n`;
    markdown += `**내용**: ${memory.content}\n\n`;
    markdown += `**타입**: ${memory.type}\n`;
    markdown += `**중요도**: ${importanceBar} (${memory.importance})\n`;
    markdown += `**생성일**: ${memory.created_at}\n`;

    if (memory.last_accessed) {
      markdown += `**마지막 접근**: ${memory.last_accessed}\n`;
    }

    if (memory.tags && memory.tags.length > 0) {
      markdown += `**태그**: ${memory.tags.map(tag => `#${tag}`).join(' ')}\n`;
    }

    markdown += `**공개 범위**: ${memory.privacy_scope}\n`;

    if (memory.pinned) {
      markdown += `**고정됨**: ✅\n`;
    }

    markdown += '\n---\n\n';
  }

  return markdown;
}
