export function validateProductionEnv(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    if (url.protocol !== 'mysql:' || !url.hostname || !url.username || !url.password || !/^\/[^/]+$/.test(url.pathname)) throw new Error();
  } catch { errors.push('DATABASE_URL must include a MySQL host, database name, username and nonempty password (URL-encode credentials)'); }
  try {
    const url = new URL(env.APP_ORIGIN ?? '');
    if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN || url.username || url.password) throw new Error();
  } catch { errors.push('APP_ORIGIN must be an HTTPS origin without a path or trailing slash'); }
  if (env.HOST !== '127.0.0.1' && env.HOST !== '::1') errors.push('HOST must be 127.0.0.1 or ::1 behind the same-host reverse proxy');
  if (!/^\d+$/.test(env.PORT ?? '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535) errors.push('PORT must be an integer between 1 and 65535');
  if (env.RUN_DB_TESTS === '1') errors.push('RUN_DB_TESTS must not be 1 in production');
  if (errors.length) throw new Error('Production configuration errors:\n- ' + errors.join('\n- '));
}
