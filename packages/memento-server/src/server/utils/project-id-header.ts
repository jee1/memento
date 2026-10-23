import type { Request } from 'express';

const MAX_PROJECT_ID_LENGTH = 200;

/** #1270, #1094: X-Memento-Project-Id or X-Project-Id → default project_id for new memories. Blank or over-length values are ignored. */
export function readProjectIdHeader(req: Request): string | undefined {
  for (const name of ['x-memento-project-id', 'x-project-id']) {
    const value = req.get(name)?.trim();
    if (value && value.length <= MAX_PROJECT_ID_LENGTH) return value;
  }
  return undefined;
}
