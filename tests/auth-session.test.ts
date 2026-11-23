import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../server/app.js';
import { createVercelApiHandler } from '../server/vercel-handler.js';

const sessionSecret = 'test-only-session-secret-that-is-at-least-32-characters';
const user = {
  id: 'user-gustavo',
  name: 'Gustavo',
  email: 'gustavo@futuracasa.local',
  passwordHash: await bcrypt.hash('a-test-password', 4),
};
const membership = {
  householdId: 'household-test',
  user: { id: user.id, name: user.name, email: user.email },
};
const prisma = {
  user: { findUnique: async ({ where }: { where: { email: string } }) => where.email === user.email ? user : null },
  householdMember: { findFirst: async ({ where }: { where: { userId: string } }) => where.userId === user.id ? membership : null },
  income: { findMany: async () => [] },
} as unknown as PrismaClient;

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not open the test server.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function functionRequestUrl(baseUrl: string, path: string) {
  const requestUrl = new URL(path, baseUrl);
  const suffix = requestUrl.pathname.replace(/^\/api\/?/, '');
  requestUrl.pathname = '/api/[...path]';
  requestUrl.searchParams.set('__futura_vercel_path', suffix);
  return requestUrl;
}

function apiFetch(baseUrl: string, path: string, init?: RequestInit) {
  return fetch(functionRequestUrl(baseUrl, path), init);
}

function getCookie(response: Response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'expected a Set-Cookie response header');
  return value.split(';', 1)[0];
}

test('login persists in the shared session store across app instances; logout clears it', async () => {
  const store = new session.MemoryStore();
  const options = { prisma, sessionStore: store, sessionSecret, frontendUrl: 'https://futura.example' };
  const first = await serve(createVercelApiHandler(createApp(options)));
  const second = await serve(createVercelApiHandler(createApp(options)));

  try {
    const health = await apiFetch(first.url, '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const protectedBeforeLogin = await apiFetch(first.url, '/api/incomes');
    assert.equal(protectedBeforeLogin.status, 401);

    const preflight = await apiFetch(first.url, '/api/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'https://futura.example', 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://futura.example');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

    const login = await apiFetch(first.url, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'GUSTAVO@FUTURACASA.LOCAL', password: 'a-test-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = getCookie(login);
    assert.match(login.headers.get('set-cookie') ?? '', /HttpOnly/i);
    assert.match(login.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
    assert.doesNotMatch(login.headers.get('set-cookie') ?? '', /; Secure/i);

    const me = await apiFetch(second.url, '/api/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: membership.user });
    const protectedAfterLogin = await apiFetch(second.url, '/api/incomes', { headers: { cookie } });
    assert.equal(protectedAfterLogin.status, 200);

    const logout = await apiFetch(second.url, '/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true });
    assert.match(logout.headers.get('set-cookie') ?? '', /HttpOnly/i);

    const meAfterLogout = await apiFetch(second.url, '/api/auth/me', { headers: { cookie } });
    assert.equal(meAfterLogout.status, 401);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('production session cookies are Secure behind the Vercel proxy', async () => {
  const server = await serve(createVercelApiHandler(createApp({
    prisma,
    sessionStore: new session.MemoryStore(),
    sessionSecret,
    frontendUrl: 'https://futura.example',
    production: true,
  })));

  try {
    const login = await apiFetch(server.url, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: user.email, password: 'a-test-password' }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') ?? '', /; Secure/i);
  } finally {
    await server.close();
  }
});
