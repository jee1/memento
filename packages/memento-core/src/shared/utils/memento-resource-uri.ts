/**
 * Canonical, owner-scoped Memento resource identifiers (#656).
 */

export const MEMENTO_RESOURCE_KINDS = ['memory', 'procedure', 'anchor', 'relation'] as const;

export type MementoResourceKind = (typeof MEMENTO_RESOURCE_KINDS)[number];

export interface MementoResourceUriParts {
  ownerId: string;
  kind: MementoResourceKind;
  id: string;
}

export interface FormatMementoResourceUriInput {
  ownerId?: string | null;
  kind: MementoResourceKind;
  id: string | number;
}

export function formatMementoResourceUri({
  ownerId,
  kind,
  id,
}: FormatMementoResourceUriInput): string {
  if (!isMementoResourceKind(kind)) {
    throw new Error(`Unsupported Memento resource kind: ${String(kind)}`);
  }

  const normalizedOwnerId = ownerId?.trim() || 'default';
  const normalizedId = String(id);

  if (!normalizedId.trim()) {
    throw new Error('Memento resource ID must not be empty');
  }

  return `memento://${encodeURIComponent(normalizedOwnerId)}/${kind}/${encodeURIComponent(normalizedId)}`;
}

export function parseMementoResourceUri(uri: string): MementoResourceUriParts {
  const prefix = 'memento://';
  if (!uri.startsWith(prefix) || uri.includes('?') || uri.includes('#')) {
    throw new Error(`Invalid Memento resource URI: ${uri}`);
  }

  const parts = uri.slice(prefix.length).split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid Memento resource URI: ${uri}`);
  }

  const [encodedOwnerId, kind, encodedId] = parts;
  if (!encodedOwnerId || !encodedId || kind === undefined || !isMementoResourceKind(kind)) {
    throw new Error(`Invalid Memento resource URI: ${uri}`);
  }

  try {
    const ownerId = decodeURIComponent(encodedOwnerId);
    const id = decodeURIComponent(encodedId);
    if (!ownerId.trim() || !id.trim()) {
      throw new Error('empty URI component');
    }
    return { ownerId, kind, id };
  } catch {
    throw new Error(`Invalid Memento resource URI: ${uri}`);
  }
}

export function isMementoResourceKind(value: string): value is MementoResourceKind {
  return (MEMENTO_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function memoryItemResourceKind(type: string): 'memory' | 'procedure' {
  return type === 'procedural' ? 'procedure' : 'memory';
}
