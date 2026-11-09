import { accountSchema, createPostgresDb } from '../postgres.js';
import { openMigrationSource } from '../migration-source.js';

const [filename, user] = process.argv.slice(2);
if (!filename || !process.env.DATABASE_URL)
  throw new Error(
    'Set DATABASE_URL and pass a stopped SQLite backup path, then an optional account username',
  );
const database = await createPostgresDb(process.env.DATABASE_URL, accountSchema(user), {
  seed: () => openMigrationSource(filename),
});
try {
  if (!database.initialized)
    throw new Error('Destination already initialized; it was not overwritten');
  console.log(JSON.stringify({ event: 'postgres_migration', status: 'verified', tables: 4 }));
} finally {
  await database.close();
}
