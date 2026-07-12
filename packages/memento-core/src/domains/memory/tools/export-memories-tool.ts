/**
 * Export Memories Tool (#672)
 *
 * memory_item 스냅샷을 markdown 또는 jsonl로보냅니다.
 */

import { z } from 'zod';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';

const MEMORY_ITEM_TYPES = ['working', 'episodic', 'semantic', 'procedural'] as const;

const ExportMemoriesSchema = z.object({
  format: z.enum(['markdown', 'jsonl']).default('markdown'),
  types: z.array(z.enum(MEMORY_ITEM_TYPES)).optional(),
  owner_id: z.string().optional(),
  limit: z.number().int().min(1).max(10000).optional(),
});

type ExportMemoriesParams = z.infer<typeof ExportMemoriesSchema>;

type MemoryExportRow = {
  id: string;
  type: string;
  content: string;
  importance: number | null;
  privacy_scope: string | null;
  created_at: string | null;
  tags: string | null;
  source: string | null;
  task_goal: string | null;
  steps: string | null;
  workflow_name: string | null;
  skill_name: string | null;
  owner_id: string | null;
  project_id: string | null;
};

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function parseSteps(stepsJson: string | null): string[] {
  if (!stepsJson) return [];
  try {
    const parsed = JSON.parse(stepsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step, index) => {
      if (typeof step === 'string') return step;
      if (step && typeof step === 'object') {
        const title = 'title' in step && typeof step.title === 'string' ? step.title : `Step ${index + 1}`;
        const detail = 'detail' in step && typeof step.detail === 'string' ? step.detail : JSON.stringify(step);
        return `${title}: ${detail}`;
      }
      return String(step);
    });
  } catch {
    return [];
  }
}

function yamlEscape(value: string): string {
  if (/[:#\n\r]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return JSON.stringify(value);
  }
  return value;
}

function formatMemoryMarkdown(row: MemoryExportRow): string {
  const tags = parseTags(row.tags);
  const steps = parseSteps(row.steps);
  const frontmatter: string[] = [
    '---',
    `id: ${row.id}`,
    `type: ${row.type}`,
    `uri: ${formatMementoResourceUri({ ownerId: row.owner_id, kind: memoryItemResourceKind(row.type), id: row.id })}`,
  ];

  if (tags.length > 0) {
    frontmatter.push(`tags: [${tags.map((t) => yamlEscape(t)).join(', ')}]`);
  }
  if (row.source) frontmatter.push(`source: ${yamlEscape(row.source)}`);
  if (row.importance != null) frontmatter.push(`importance: ${row.importance}`);
  if (row.privacy_scope) frontmatter.push(`privacy_scope: ${row.privacy_scope}`);
  if (row.created_at) frontmatter.push(`created_at: ${row.created_at}`);
  if (row.owner_id) frontmatter.push(`owner_id: ${yamlEscape(row.owner_id)}`);
  if (row.project_id) frontmatter.push(`project_id: ${yamlEscape(row.project_id)}`);
  if (row.workflow_name) frontmatter.push(`workflow_name: ${yamlEscape(row.workflow_name)}`);
  if (row.skill_name) frontmatter.push(`skill_name: ${yamlEscape(row.skill_name)}`);
  if (row.task_goal) frontmatter.push(`task_goal: ${yamlEscape(row.task_goal)}`);

  frontmatter.push('---');

  const body: string[] = [frontmatter.join('\n'), '', row.content];

  if (steps.length > 0) {
    body.push('', '## Steps', '');
    for (const step of steps) {
      body.push(`- ${step}`);
    }
  }

  return body.join('\n');
}

function fetchMemories(
  context: ToolContext,
  params: ExportMemoriesParams,
): MemoryExportRow[] {
  const conditions: string[] = ['is_deleted = 0'];
  const sqlParams: unknown[] = [];

  if (params.types && params.types.length > 0) {
    const placeholders = params.types.map(() => '?').join(', ');
    conditions.push(`type IN (${placeholders})`);
    sqlParams.push(...params.types);
  }

  if (params.owner_id) {
    conditions.push('owner_id = ?');
    sqlParams.push(params.owner_id);
  }

  let sql = `
    SELECT id, type, content, importance, privacy_scope, created_at, tags, source,
           task_goal, steps, workflow_name, skill_name, owner_id, project_id
    FROM memory_item
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC
  `;

  if (params.limit) {
    sql += ' LIMIT ?';
    sqlParams.push(params.limit);
  }

  return DatabaseUtils.all(context.db, sql, sqlParams) as MemoryExportRow[];
}

export class ExportMemoriesTool extends BaseTool {
  constructor() {
    super(
      'export',
      '기억을 markdown 또는 jsonl 형식으로보냅니다',
      {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['markdown', 'jsonl'],
            description: '보내기 형식 (기본값: markdown)',
            default: 'markdown',
          },
          types: {
            type: 'array',
            items: { type: 'string', enum: [...MEMORY_ITEM_TYPES] },
            description: '보낼 memory_item 타입 필터 (미지정 시 전체)',
          },
          owner_id: {
            type: 'string',
            description: '특정 owner_id 기억만보내기',
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 10000,
            description: '최대 항목 수',
          },
        },
      },
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    this.validateDatabase(context);
    const parsed = ExportMemoriesSchema.parse(params);
    const rows = fetchMemories(context, parsed);

    if (parsed.format === 'jsonl') {
      const lines = rows.map((row) => JSON.stringify({
        id: row.id,
        uri: formatMementoResourceUri({ ownerId: row.owner_id, kind: memoryItemResourceKind(row.type), id: row.id }),
        type: row.type,
        content: row.content,
        tags: parseTags(row.tags),
        source: row.source ?? undefined,
        importance: row.importance ?? undefined,
        privacy_scope: row.privacy_scope ?? undefined,
        created_at: row.created_at ?? undefined,
        task_goal: row.task_goal ?? undefined,
        steps: parseSteps(row.steps),
        workflow_name: row.workflow_name ?? undefined,
        skill_name: row.skill_name ?? undefined,
        owner_id: row.owner_id ?? undefined,
        project_id: row.project_id ?? undefined,
      }));
      return this.createSuccessResult({
        format: 'jsonl',
        count: rows.length,
        content: lines.join('\n'),
      });
    }

    const documents = rows.map((row) => formatMemoryMarkdown(row));
    return this.createSuccessResult({
      format: 'markdown',
      count: rows.length,
      content: documents.join('\n\n---\n\n'),
    });
  }
}

export { ExportMemoriesSchema, formatMemoryMarkdown, fetchMemories };
