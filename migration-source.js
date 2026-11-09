import { DatabaseSync } from 'node:sqlite';

export function openMigrationSource(filename) {
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec('BEGIN');
    if (source.prepare('PRAGMA user_version').get().user_version !== 2)
      throw new Error('Upgrade a copy of the SQLite database to schema version 2 first');
    if (
      source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      source.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('SQLite source integrity check failed');
    return source;
  } catch (error) {
    source.close();
    throw error;
  }
}
