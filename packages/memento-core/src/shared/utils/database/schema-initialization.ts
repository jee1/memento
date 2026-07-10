import type Database from 'better-sqlite3';

import { initializeMigrationStatusTable, loadMigrationStatusToConfig } from '../fts5-migration-status.js';
import { normalizeReflectionNotes } from '../reflection-notes-normalize.js';
import { log } from './database-error-helpers.js';
import { runQuery } from './query-helpers.js';

export async function initializeDatabase(db: Database.Database): Promise<void> {
  try {
    runQuery(db, 'PRAGMA journal_mode = WAL');
    runQuery(db, 'PRAGMA synchronous = NORMAL');
    runQuery(db, 'PRAGMA cache_size = 10000');
    runQuery(db, 'PRAGMA temp_store = MEMORY');
    runQuery(db, 'PRAGMA mmap_size = 268435456');
    runQuery(db, 'PRAGMA busy_timeout = 30000');

    runQuery(db, 'PRAGMA compile_options');

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_item (
          id TEXT PRIMARY KEY,
          type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
          content TEXT NOT NULL,
          importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
          privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_accessed TIMESTAMP,
          pinned BOOLEAN DEFAULT FALSE,
          tags TEXT,
          source TEXT,
          view_count INTEGER DEFAULT 0,
          cite_count INTEGER DEFAULT 0,
          edit_count INTEGER DEFAULT 0,
          origin_source TEXT DEFAULT '{}',
          task_goal TEXT,
          steps TEXT,
          reflection_notes TEXT,
          workflow_name TEXT,
          skill_name TEXT,
          trigger_conditions TEXT,
          version INTEGER NULL,
          version_series_id TEXT NULL,
          owner_id TEXT NULL,
          process_id TEXT NULL,
          session_id TEXT NULL,
          num_times INTEGER NOT NULL DEFAULT 1,
          last_mentioned_at TIMESTAMP,
          source_session_id TEXT,
          confidence REAL,
          is_consolidated BOOLEAN DEFAULT FALSE,
          project_id TEXT
        )
      `
    );

    let memoryItemColumns = db
      .prepare('PRAGMA table_info(memory_item)')
      .all() as Array<{ name: string }>;
    if (!memoryItemColumns.some(c => c.name === 'is_consolidated')) {
      runQuery(db, 'ALTER TABLE memory_item ADD COLUMN is_consolidated BOOLEAN DEFAULT FALSE');
    }

    memoryItemColumns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!memoryItemColumns.some(c => c.name === 'is_deleted')) {
      runQuery(db, 'ALTER TABLE memory_item ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE NOT NULL');
    }
    memoryItemColumns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!memoryItemColumns.some(c => c.name === 'deleted_at')) {
      runQuery(db, 'ALTER TABLE memory_item ADD COLUMN deleted_at TEXT');
    }

    memoryItemColumns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    if (!memoryItemColumns.some(c => c.name === 'project_id')) {
      runQuery(db, 'ALTER TABLE memory_item ADD COLUMN project_id TEXT');
    }

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_tag (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_item_tag (
          memory_id TEXT NOT NULL,
          tag_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES memory_tag(id) ON DELETE CASCADE,
          PRIMARY KEY (memory_id, tag_id)
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_link (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts', 'version_of')) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(source_id, target_id, relation_type)
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS feedback_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          event TEXT CHECK (event IN ('used', 'edited', 'neglected', 'helpful', 'not_helpful')) NOT NULL,
          score REAL,
          comment TEXT,
          session_id TEXT,
          agent_id TEXT,
          score_breakdown_json TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_forgetting_event (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('soft', 'hard', 'review')),
          reason TEXT NOT NULL,
          policy TEXT NOT NULL,
          forget_score REAL,
          ttl_days INTEGER,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          metadata_json TEXT
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS wm_buffer (
          session_id TEXT PRIMARY KEY,
          items TEXT NOT NULL,
          token_budget INTEGER DEFAULT 4000,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
        )
      `
    );

    runQuery(
      db,
      `
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          embedding TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT,
          embedding_provider TEXT DEFAULT 'tfidf',
          dimensions INTEGER,
          created_by TEXT DEFAULT 'system',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(memory_id)
        )
      `
    );

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_type ON memory_item(type)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_created_at ON memory_item(created_at)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_pinned ON memory_item(pinned)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_privacy_scope ON memory_item(privacy_scope)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_importance ON memory_item(importance)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_user_id ON memory_item(id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_project_id ON memory_item(project_id)');
    runQuery(
      db,
      `CREATE INDEX IF NOT EXISTS idx_memory_item_project_id_type
         ON memory_item(project_id, type)
         WHERE project_id IS NOT NULL`
    );
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_workflow_name ON memory_item(workflow_name)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_skill_name ON memory_item(skill_name)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_process_id ON memory_item(process_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_session_id ON memory_item(session_id)');
    runQuery(
      db,
      `CREATE INDEX IF NOT EXISTS idx_memory_item_is_consolidated
         ON memory_item(type, is_consolidated)
         WHERE type = 'episodic'`
    );

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_tag_memory_id ON memory_item_tag(memory_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_tag_tag_id ON memory_item_tag(tag_id)');

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_link_source ON memory_link(source_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_link_target ON memory_link(target_id)');

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_memory_id ON feedback_event(memory_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_event(event)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_event(created_at)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id)');
    runQuery(
      db,
      'CREATE INDEX IF NOT EXISTS idx_feedback_memory_created_at ON feedback_event(memory_id, created_at)'
    );

    runQuery(
      db,
      'CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_memory_id ON memory_forgetting_event(memory_id)'
    );
    runQuery(
      db,
      'CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_action ON memory_forgetting_event(action)'
    );
    runQuery(
      db,
      'CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_created_at ON memory_forgetting_event(created_at)'
    );

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_wm_buffer_expires_at ON wm_buffer(expires_at)');

    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
    runQuery(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');

    try {
      db.function(
        'normalize_reflection_notes',
        {
          deterministic: true,
          varargs: false,
        },
        (reflectionNotes: string | null) => {
          return normalizeReflectionNotes(reflectionNotes);
        }
      );

      runQuery(
        db,
        `
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            tags,
            source,
            reflection_notes,
            content='memory_item',
            content_rowid='rowid'
          )
        `
      );

      runQuery(
        db,
        `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
            INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
            VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
          END
        `
      );

      runQuery(
        db,
        `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
            INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
            VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
          END
        `
      );

      runQuery(
        db,
        `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
            INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
            VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
            INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
            VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
          END
        `
      );
    } catch (error) {
      log('⚠️ FTS5 가상 테이블 생성 실패', { error });
    }

    try {
      initializeMigrationStatusTable(db);
      loadMigrationStatusToConfig(db);
    } catch (error) {
      log('⚠️ FTS5 마이그레이션 상태 초기화 실패', { error });
    }

    log('✅ 데이터베이스 초기화 완료');
  } catch (error) {
    log('❌ 데이터베이스 초기화 실패', { error });
    throw error;
  }
}
