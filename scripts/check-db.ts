import { db } from '../server/db.js';

try {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.username || !url.password) {
    throw new Error('Fill in the username and password in DATABASE_URL before checking the database.');
  }
  const result = await db.$queryRaw<Array<{ databaseName: string; version: string; bindAddress: string }>>`
    SELECT DATABASE() AS databaseName, VERSION() AS version, @@bind_address AS bindAddress
  `;
  console.log('Backend Prisma connection verified:', result[0]);
} catch {
  console.error('Database check failed. Verify DATABASE_URL credentials and that local MySQL is running. Connection details were not printed.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
