import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  ALL_RELATION_TYPES,
  MEMORY_TYPE_RELATION_MAP,
  RELATION_TYPE_BOOST_MAP,
  RELATION_TYPE_CATEGORY_MAP,
  type RelationType,
} from '../../../../../shared/types/relation.js';
import { RelationTypeRegistrySeedsMigration } from './038-relation-type-registry-seeds.js';

function applicableTypesFor(relationType: RelationType): string[] {
  return Object.entries(MEMORY_TYPE_RELATION_MAP)
    .filter(([, relationTypes]) => relationTypes.includes(relationType))
    .map(([memoryType]) => memoryType);
}

describe('RelationTypeRegistrySeedsMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE relation_type_registry (
        type_name TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        description TEXT,
        applicable_types TEXT,
        default_confidence REAL DEFAULT 0.7,
        search_boost REAL DEFAULT 1.0
      );
    `);
    db.prepare(`
      INSERT INTO relation_type_registry (type_name, category, applicable_types, search_boost)
      VALUES ('CAUSES', 'Causal', '["episodic","semantic"]', 1.2)
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('backfills every canonical RelationType and normalizes existing registry values', async () => {
    const migration = new RelationTypeRegistrySeedsMigration();

    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const relationTypes = db.prepare(`
      SELECT type_name, category, applicable_types, search_boost
      FROM relation_type_registry
      ORDER BY type_name
    `).all() as Array<{
      type_name: RelationType;
      category: string;
      applicable_types: string;
      search_boost: number;
    }>;

    expect(relationTypes.map(({ type_name }) => type_name)).toEqual([...ALL_RELATION_TYPES].sort());

    for (const relationType of relationTypes) {
      expect(relationType.category).toBe(RELATION_TYPE_CATEGORY_MAP[relationType.type_name]);
      expect(JSON.parse(relationType.applicable_types)).toEqual(
        applicableTypesFor(relationType.type_name),
      );
      expect(relationType.search_boost).toBe(RELATION_TYPE_BOOST_MAP[relationType.type_name]);
    }
  });
});
