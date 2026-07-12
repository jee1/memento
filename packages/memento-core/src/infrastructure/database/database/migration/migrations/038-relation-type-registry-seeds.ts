/**
 * Migration: 038 - relation type registry seeds
 * Version: 38.0
 */

import type Database from 'better-sqlite3';
import {
  ALL_RELATION_TYPES,
  MEMORY_TYPE_RELATION_MAP,
  RELATION_TYPE_BOOST_MAP,
  RELATION_TYPE_CATEGORY_MAP,
  type RelationType,
} from '../../../../../shared/types/relation.js';
import type { Migration } from '../types.js';

const RELATION_TYPE_DESCRIPTIONS: Record<RelationType, string> = {
  CAUSES: '인과 관계: 한 기억이 다른 기억의 원인이 되는 관계',
  DEPENDS_ON: '의존 관계: 한 기억이 다른 기억에 의존하는 관계',
  FOLLOWS: '시간적 순서: 한 기억이 다른 기억 이후에 발생하는 관계',
  CONTRASTS_WITH: '대조 관계: 한 기억이 다른 기억과 대조되는 관계',
  REFERENCES: '참조 관계: 한 기억이 다른 기억을 참조하는 관계',
  BELONGS_TO: '포함 관계: 한 기억이 다른 기억에 속하는 관계',
  VERSION_OF: '버전 관계: 새 절차 기억이 이전 절차 기억을 대체하는 관계',
  extracted_from: '추출 근거 관계: 의미 기억이 원본 기억에서 추출된 관계',
  supported_by: '근거 관계: 한 기억이 다른 기억의 근거가 되는 관계',
};

function applicableTypesFor(relationType: RelationType): string[] {
  return Object.entries(MEMORY_TYPE_RELATION_MAP)
    .filter(([, relationTypes]) => relationTypes.includes(relationType))
    .map(([memoryType]) => memoryType);
}

export class RelationTypeRegistrySeedsMigration implements Migration {
  version = '38.0';
  name = 'relation-type-registry-seeds';
  description = 'Seed the complete canonical relation type registry';

  async validateBefore(db: Database.Database): Promise<void> {
    const registry = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'relation_type_registry'")
      .get();

    if (!registry) {
      throw new Error('relation_type_registry table does not exist');
    }
  }

  async up(db: Database.Database): Promise<void> {
    const insert = db.prepare(`
      INSERT INTO relation_type_registry (
        type_name, category, description, applicable_types, default_confidence, search_boost
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(type_name) DO UPDATE SET
        category = excluded.category,
        description = excluded.description,
        applicable_types = excluded.applicable_types,
        default_confidence = excluded.default_confidence,
        search_boost = excluded.search_boost
    `);

    for (const relationType of ALL_RELATION_TYPES) {
      insert.run(
        relationType,
        RELATION_TYPE_CATEGORY_MAP[relationType],
        RELATION_TYPE_DESCRIPTIONS[relationType],
        JSON.stringify(applicableTypesFor(relationType)),
        0.7,
        RELATION_TYPE_BOOST_MAP[relationType],
      );
    }
  }

  async down(db: Database.Database): Promise<void> {
    db.prepare('DELETE FROM relation_type_registry WHERE type_name IN (?, ?, ?)').run(
      'VERSION_OF',
      'extracted_from',
      'supported_by',
    );
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const seededTypes = db.prepare('SELECT type_name FROM relation_type_registry').all() as Array<{
      type_name: string;
    }>;
    const availableTypes = new Set(seededTypes.map(({ type_name }) => type_name));

    for (const relationType of ALL_RELATION_TYPES) {
      if (!availableTypes.has(relationType)) {
        throw new Error(`Migration 038 did not seed relation type: ${relationType}`);
      }
    }
  }
}

export default RelationTypeRegistrySeedsMigration;
