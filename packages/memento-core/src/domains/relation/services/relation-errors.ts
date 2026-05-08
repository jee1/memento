import type { RelationType } from '../../../shared/types/relation.js';

export class RelationGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelationGraphError';
  }
}

export class DuplicateRelationError extends RelationGraphError {
  constructor(
    public readonly sourceId: string,
    public readonly targetId: string,
    public readonly relationType: RelationType,
    message?: string
  ) {
    super(
      message ??
        `이미 존재하는 관계입니다: ${sourceId} -> ${targetId} (${relationType})`
    );
    this.name = 'DuplicateRelationError';
  }
}

export class CyclicRelationError extends RelationGraphError {
  constructor(
    public readonly sourceId: string,
    public readonly targetId: string,
    public readonly relationType: RelationType,
    message?: string
  ) {
    super(
      message ??
        `순환 참조가 감지되었습니다: ${sourceId} -> ${targetId} (${relationType})`
    );
    this.name = 'CyclicRelationError';
  }
}
