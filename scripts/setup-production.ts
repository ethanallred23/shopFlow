import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { validateProductionEnv } from './production-env';

try {
  validateProductionEnv(process.env);
  const steps = [
    ['Generate Prisma client', 'node_modules/prisma/build/index.js', 'generate'],
    ['Apply committed migrations', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    ['Type-check application', 'node_modules/typescript/bin/tsc', '--noEmit'],
    ['Build application', 'node_modules/vite/bin/vite.js', 'build'],
    ['Seed essential configuration', 'node_modules/tsx/dist/cli.mjs', 'scripts/seed-production.ts'],
  ];
  for (const [label, ...args] of steps) {
    console.log(`\n${label}`);
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    if (result.error || result.status !== 0) throw new Error(`${label} failed; setup stopped. Do not restart the app.`);
  }
  console.log('\nProduction setup succeeded. On first deployment, run npm run admin:create before starting the app.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production setup failed');
  process.exitCode = 1;
}
