import { db } from '../server/db';
import { validateProductionEnv } from './production-env';
try {
  validateProductionEnv(process.env);
  await db.bootstrapState.upsert({ where: { id: 'first-admin' }, create: { id: 'first-admin' }, update: {} });
  console.log('Essential bootstrap marker ready. No users, shops or events seeded.');
} catch {
  console.error('Essential configuration failed. Check production configuration, database access and migrations.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
