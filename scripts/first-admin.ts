import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const adminInput = z.object({
  organization: z.string().trim().min(1).max(191),
  timezone: z.string().refine(v => DateTime.now().setZone(v).isValid, 'Enter a valid IANA timezone'),
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().toLowerCase().email().max(191),
  password: z.string().min(12).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes'),
});

export async function createFirstAdmin(db: PrismaClient, input: z.input<typeof adminInput>) {
  const values = adminInput.parse(input);
  const passwordHash = await bcrypt.hash(values.password, 12);
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{completed: boolean}>>`SELECT completed FROM BootstrapState WHERE id = 'first-admin' FOR UPDATE`;
    if (!rows.length) throw new Error('Run setup:production first.');
    if (rows[0].completed || await tx.user.count({where: {role: 'admin'}})) return false;
    if (await tx.organization.count()) throw new Error('An organization already exists without an administrator. Resolve this explicitly; first-admin setup will not duplicate it.');
    const org = await tx.organization.create({data: {name: values.organization, timezone: values.timezone, demo: false}});
    await tx.user.create({data: {orgId: org.id, email: values.email, name: values.name, passwordHash, role: 'admin'}});
    await tx.bootstrapState.update({where: {id: 'first-admin'}, data: {completed: true}});
    return true;
  });
}
