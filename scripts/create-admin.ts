import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { db } from '../server/db';
import { validateProductionEnv } from './production-env';
import { adminInput, createFirstAdmin } from './first-admin';

async function question(label: string) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try { return await rl.question(label); } finally { rl.close(); }
}
function secret(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    emitKeypressEvents(process.stdin);
    const previousRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const finish = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (text: string | undefined, key: {name?: string; ctrl?: boolean; meta?: boolean}) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

try {
  validateProductionEnv(process.env);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal. Password arguments and piped input are not accepted.');
  if (await db.user.count({where: {role: 'admin'}})) {
    console.log('An administrator already exists; no data changed.');
  } else {
    const organization = process.env.ORG_NAME?.trim() || undefined;
    const timezone = process.env.ORG_TIMEZONE?.trim() || undefined;
    const configuration = adminInput.pick({organization: true, timezone: true}).safeParse({organization, timezone});
    if (!configuration.success) throw new Error('Check ORG_NAME and ORG_TIMEZONE in .env: ' + configuration.error.issues.map(i => i.message).join('; '));
    console.log(`Organization: ${configuration.data.organization}; timezone: ${configuration.data.timezone}`);
    const name = await question('Administrator name: ');
    const email = await question('Administrator email: ');
    let password: string;
    while (true) {
      password = await secret('Password (12+ characters, hidden): ');
      const validPassword = adminInput.shape.password.safeParse(password);
      if (!validPassword.success) {
        console.log(validPassword.error.issues.map(i => i.message).join('; '));
        continue;
      }
      const confirmation = await secret('Confirm password (hidden): ');
      if (password === confirmation) break;
      console.log('Passwords did not match. Enter the password again; your name and email are kept.');
    }
    const parsed = adminInput.safeParse({organization, timezone, name, email, password});
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n'));
    const created = await createFirstAdmin(db, parsed.data);
    console.log(created ? 'Organization and administrator created. Configure shops and shifts in Settings.' : 'An administrator already exists; no data changed.');
  }
} catch (error) {
  // Prisma errors can contain query arguments; never print them with credentials.
  console.error(error instanceof Error && !('code' in error) && !error.name.startsWith('Prisma') ? error.message : 'Administrator creation failed. Check database availability and run setup:production first.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
