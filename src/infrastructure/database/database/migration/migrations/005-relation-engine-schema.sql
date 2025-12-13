-- Migration: 005 - Relation Engine Schema
-- Description: Create memory_relation and relation_type_registry tables for semantic relation engine
-- Version: 5.0
-- Date: 2025-01-XX

-- 1. Create memory_relation table
CREATE TABLE IF NOT EXISTS memory_relation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT, -- JSON: extraction method, timestamp, cyclic flag, refinement history
  FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id, relation_type)
);

-- 2. Create relation_type_registry table
CREATE TABLE IF NOT EXISTS relation_type_registry (
  type_name TEXT PRIMARY KEY,
  category TEXT NOT NULL, -- 'Causal', 'Temporal', 'Structural', 'Semantic'
  description TEXT,
  applicable_types TEXT, -- JSON array: ['episodic', 'semantic'] etc.
  default_confidence REAL DEFAULT 0.7,
  search_boost REAL DEFAULT 1.0, -- Search ranking weight
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create indexes for memory_relation table
CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation(target_id);
CREATE INDEX IF NOT EXISTS idx_memory_relation_type ON memory_relation(relation_type);
CREATE INDEX IF NOT EXISTS idx_memory_relation_confidence ON memory_relation(confidence);
CREATE INDEX IF NOT EXISTS idx_memory_relation_source_type ON memory_relation(source_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_memory_relation_target_type ON memory_relation(target_id, relation_type);

-- 4. Create index for relation_type_registry table
CREATE INDEX IF NOT EXISTS idx_relation_type_registry_category ON relation_type_registry(category);

-- 5. Insert initial relation types into registry
-- Causal (인과 관계군)
INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('CAUSES', 'Causal', '인과 관계: 한 기억이 다른 기억의 원인이 되는 관계', '["episodic", "semantic"]', 0.7, 1.2);

-- Temporal (시간 관계군)
INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('FOLLOWS', 'Temporal', '시간적 순서: 한 기억이 다른 기억 이후에 발생하는 관계', '["episodic", "procedural"]', 0.7, 1.0);

-- Structural (구조 관계군)
INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('DEPENDS_ON', 'Structural', '의존 관계: 한 기억이 다른 기억에 의존하는 관계', '["semantic", "procedural"]', 0.7, 1.1);

INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('BELONGS_TO', 'Structural', '포함 관계: 한 기억이 다른 기억에 속하는 관계', '["semantic", "episodic"]', 0.7, 1.0);

-- Semantic (의미 관계군)
INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('CONTRASTS_WITH', 'Semantic', '대조 관계: 한 기억이 다른 기억과 대조되는 관계', '["semantic", "episodic"]', 0.7, 0.9);

INSERT INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES ('REFERENCES', 'Semantic', '참조 관계: 한 기억이 다른 기억을 참조하는 관계', '["working", "episodic", "semantic", "procedural"]', 0.7, 0.8);
