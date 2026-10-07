import type { Request } from 'express';

const MAX_PROJECT_ID_LENGTH = 200;

/** #1270: X-Memento-Project-Id → default project_id for new memories. Blank or over-length values are ignored. */
export function readProjectIdHeader(req: Request): string | undefined {
  const value = req.get('x-memento-project-id')?.trim();
  if (!value || value.length > MAX_PROJECT_ID_LENGTH) return undefined;
  return value;
}
