import type Database from 'better-sqlite3';
import { normalizeReflectionNotes } from '../../../shared/utils/reflection-notes-normalize.js';
import { log } from './init-log.js';

/**
 * WAL/pragma, FTS5·sqlite-vec 확장, reflection_notes 정규화 UDF를 연결 직후에 적용한다.
 */
export async function configureSqliteSession(db: Database.Database): Promise<void> {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    if (process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true') {
      log('[ENV] Docker 환경에서 FTS5 사용 가능');
    } else {
      db.loadExtension('fts5');
      log('[OK] FTS5 확장 로드 완료');
    }
  } catch (error) {
    log('[WARN]  FTS5 확장 로드 실패, 기본 검색으로 전환:', error);
  }

  db.pragma('busy_timeout = 60000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 20000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');
  db.pragma('wal_autocheckpoint = 100');
  db.pragma('journal_size_limit = 33554432');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('locking_mode = NORMAL');
  db.pragma('read_uncommitted = 0');

  db.function(
    'normalize_reflection_notes',
    {
      deterministic: true,
      varargs: false
    },
    (reflectionNotes: string | null) => {
      return normalizeReflectionNotes(reflectionNotes);
    }
  );

  try {
    const { getLoadablePath } = await import('sqlite-vec');
    const extensionPath = getLoadablePath();
    db.loadExtension(extensionPath);
    log('[OK] sqlite-vec 확장 로드 성공');
  } catch (error) {
    log('[WARN] sqlite-vec 확장 로드 실패 (벡터 검색 기능 비활성화):', error);
  }
}
