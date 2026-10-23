import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { validateProductionEnv } from '../scripts/production-env';
import { adminInput, createFirstAdmin } from '../scripts/first-admin';
import { db } from '../server/db';

it('reports all missing production variables without printing credentials', () => {
  expect(() => validateProductionEnv({})).toThrow(/NODE_ENV.*\n.*DATABASE_URL.*\n.*APP_ORIGIN.*\n.*HOST.*\n.*PORT/);
  const env = {NODE_ENV:'production', DATABASE_URL:'mysql://user:password@localhost/shopflow', APP_ORIGIN:'https://shopflow.example.com', HOST:'127.0.0.1', PORT:'3001'};
  expect(() => validateProductionEnv(env)).not.toThrow();
  expect(() => validateProductionEnv({...env,DATABASE_URL:'mysql://:@localhost/shopflow'})).toThrow(/DATABASE_URL/);
  expect(() => validateProductionEnv({...env,APP_ORIGIN:'http://example.com'})).toThrow(/APP_ORIGIN/);
  expect(() => validateProductionEnv({...env,RUN_DB_TESTS:'1'})).toThrow(/RUN_DB_TESTS/);
});

it('defaults organization settings and accepts surrounding timezone whitespace', () => {
  const input = {name:' Ethan Allred ', email:' admin@example.test ', password:'test-password-only'};
  expect(adminInput.parse(input)).toMatchObject({organization:'Quality Craft Wood Works', timezone:'America/Denver', name:'Ethan Allred', email:'admin@example.test'});
  expect(adminInput.parse({...input,timezone:' America/Denver '})).toMatchObject({timezone:'America/Denver'});
  expect(adminInput.safeParse({...input,timezone:'Invalid/Timezone'}).success).toBe(false);
});

// Run only on the dedicated, initially empty deployment-verification database.
const suite = process.env.RUN_PRODUCTION_SETUP_TESTS === '1' ? describe : describe.skip;
suite('first production administrator', () => {
  afterAll(async () => { await db.$disconnect(); });
  it('serializes concurrent bootstrap, hashes passwords and never duplicates or resets accounts', async () => {
    expect(await db.organization.count()).toBe(0);
    const input = {organization:'Deployment verification',timezone:'UTC',name:'Test admin',email:randomUUID()+'@example.test',password:randomUUID()};
    const results = await Promise.all([createFirstAdmin(db,input),createFirstAdmin(db,input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.organization.count()).toBe(1);
    const admin = await db.user.findUniqueOrThrow({where:{email:input.email}});
    expect(await bcrypt.compare(input.password,admin.passwordHash)).toBe(true);
    expect(await createFirstAdmin(db,{...input,password:randomUUID()})).toBe(false);
    expect((await db.user.findUniqueOrThrow({where:{id:admin.id}})).passwordHash).toBe(admin.passwordHash);
    expect(await db.shop.count()).toBe(0);
    expect(await db.rawEvent.count()).toBe(0);
    await expect(db.shop.create({data:{orgId:randomUUID(),name:'Orphan'}})).rejects.toMatchObject({code:'P2003'});
    await expect(db.organization.delete({where:{id:admin.orgId}})).rejects.toMatchObject({code:'P2003'});
  });
});
