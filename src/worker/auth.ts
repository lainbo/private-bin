import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type {
  AdminDeleteUserRequest,
  AdminUpdateUserRequest,
  AdminUserResponse,
  AuthStatusResponse,
} from '../shared/api-types';
import { base64urlToBytes, bytesToBase64url } from '../lib/base64url';
import { clearSessionCookie, parseCookies, sessionCookie } from './cookies';
import { countUsers, getUserById, toApiUser, type CredentialRow, type UserRow } from './db';
import type { AppEnv } from './env';
import { HttpError, jsonResponse, readJson } from './response';
import { randomId, sessionToken, sha256Base64url } from './crypto';

const SESSION_COOKIE = 'pb_session';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type AuthContext = {
  user: UserRow;
  tokenHash: string;
};

function isRegistrationOpen(env: AppEnv): boolean {
  return env.ALLOW_PASSKEY_REGISTRATION === 'true';
}

function sessionTtlMs(env: AppEnv): number {
  const days = Number(env.SESSION_TTL_DAYS ?? '30');
  const normalizedDays = Number.isFinite(days) && days > 0 ? days : 30;
  return normalizedDays * 24 * 60 * 60 * 1000;
}

function originFor(request: Request, env: AppEnv): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function rpIdFor(request: Request, env: AppEnv): string {
  return env.RP_ID || new URL(originFor(request, env)).hostname;
}

function secureCookie(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function validateDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, '请输入注册名称。');
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 64) {
    throw new HttpError(400, '注册名称需要在 1 到 64 个字符之间。');
  }
  return displayName;
}

function assertJsonObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '请求内容不正确。');
  }
}

async function countActiveAdmins(env: AppEnv): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM users WHERE role = ? AND disabled = 0',
  )
    .bind('admin')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function assertCanRemoveActiveAdmin(env: AppEnv, user: UserRow): Promise<void> {
  if (user.role !== 'admin' || user.disabled === 1) return;
  const activeAdminCount = await countActiveAdmins(env);
  if (activeAdminCount <= 1) {
    throw new HttpError(400, '不能移除最后一个管理员。');
  }
}

async function createSession(env: AppEnv, userId: string, request: Request): Promise<Headers> {
  const token = sessionToken();
  const tokenHash = await sha256Base64url(token);
  const now = Date.now();
  const maxAgeSeconds = Math.floor(sessionTtlMs(env) / 1000);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(tokenHash, userId, now + sessionTtlMs(env), now, now)
    .run();

  const headers = new Headers();
  headers.set('Set-Cookie', sessionCookie(token, maxAgeSeconds, secureCookie(request)));
  return headers;
}

export async function getAuthContext(env: AppEnv, request: Request): Promise<AuthContext | null> {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Base64url(token);
  const now = Date.now();
  const session = await env.DB.prepare(
    `SELECT users.id, users.display_name, users.role, users.disabled, users.created_at, users.updated_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<UserRow>();
  if (!session || session.disabled === 1) return null;
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run();
  return { user: session, tokenHash };
}

export async function requireUser(env: AppEnv, request: Request): Promise<AuthContext> {
  const auth = await getAuthContext(env, request);
  if (!auth) throw new HttpError(401, '请先使用 passkey 登录。');
  return auth;
}

export async function requireAdmin(env: AppEnv, request: Request): Promise<AuthContext> {
  const auth = await requireUser(env, request);
  if (auth.user.role !== 'admin') throw new HttpError(403, '只有管理员可以执行这个操作。');
  return auth;
}

export async function authStatus(env: AppEnv, request: Request): Promise<Response> {
  const auth = await getAuthContext(env, request);
  const payload: AuthStatusResponse = {
    authenticated: auth !== null,
    registrationOpen: isRegistrationOpen(env),
    user: auth ? toApiUser(auth.user) : null,
  };
  return jsonResponse(payload);
}

export async function registerOptions(env: AppEnv, request: Request): Promise<Response> {
  if (!isRegistrationOpen(env)) throw new HttpError(403, '注册暂未开放。');
  const body = await readJson<{ displayName?: unknown }>(request);
  const displayName = validateDisplayName(body.displayName);
  const userId = randomId(18);
  const rpID = rpIdFor(request, env);
  const options = await generateRegistrationOptions({
    rpName: 'Private Bin',
    rpID,
    userID: base64urlToBytes(userId),
    userName: userId,
    userDisplayName: displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  const challengeId = randomId(24);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO auth_challenges (id, kind, challenge, user_id, display_name, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(challengeId, 'registration', options.challenge, userId, displayName, now + CHALLENGE_TTL_MS, now)
    .run();

  return jsonResponse({ challengeId, options });
}

export async function verifyRegister(env: AppEnv, request: Request): Promise<Response> {
  if (!isRegistrationOpen(env)) throw new HttpError(403, '注册暂未开放。');
  const body = await readJson<{ challengeId?: string; response?: RegistrationResponseJSON }>(request);
  if (!body.challengeId || !body.response) throw new HttpError(400, '注册响应不完整。');
  const challenge = await env.DB.prepare(
    'SELECT id, challenge, user_id, display_name, expires_at FROM auth_challenges WHERE id = ? AND kind = ?',
  )
    .bind(body.challengeId, 'registration')
    .first<{ id: string; challenge: string; user_id: string; display_name: string; expires_at: number }>();
  if (!challenge || challenge.expires_at <= Date.now()) throw new HttpError(400, '注册挑战已过期。');

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: originFor(request, env),
    expectedRPID: rpIdFor(request, env),
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(400, 'Passkey 注册验证失败。');
  }

  const now = Date.now();
  const userCount = await countUsers(env);
  const role = userCount === 0 ? 'admin' : 'user';
  const credential = verification.registrationInfo.credential;
  const transports = body.response.response.transports ?? [];

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, display_name, role, disabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(challenge.user_id, challenge.display_name, role, now, now),
    env.DB.prepare(
      `INSERT INTO passkey_credentials
       (credential_id, user_id, public_key, counter, transports, credential_device_type, credential_backed_up, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      credential.id,
      challenge.user_id,
      bytesToBase64url(new Uint8Array(credential.publicKey)),
      credential.counter,
      JSON.stringify(transports),
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
      now,
      null,
    ),
    env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?').bind(challenge.id),
  ]);

  const headers = await createSession(env, challenge.user_id, request);
  return jsonResponse({ verified: true }, { headers });
}

export async function loginOptions(env: AppEnv, request: Request): Promise<Response> {
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(request, env),
    userVerification: 'preferred',
  });
  const challengeId = randomId(24);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO auth_challenges (id, kind, challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(challengeId, 'authentication', options.challenge, now + CHALLENGE_TTL_MS, now)
    .run();
  return jsonResponse({ challengeId, options });
}

export async function verifyLogin(env: AppEnv, request: Request): Promise<Response> {
  const body = await readJson<{ challengeId?: string; response?: AuthenticationResponseJSON }>(request);
  if (!body.challengeId || !body.response) throw new HttpError(400, '登录响应不完整。');

  const challenge = await env.DB.prepare(
    'SELECT id, challenge, expires_at FROM auth_challenges WHERE id = ? AND kind = ?',
  )
    .bind(body.challengeId, 'authentication')
    .first<{ id: string; challenge: string; expires_at: number }>();
  if (!challenge || challenge.expires_at <= Date.now()) throw new HttpError(400, '登录挑战已过期。');

  const credentialRow = await env.DB.prepare(
    `SELECT passkey_credentials.*, users.display_name, users.role, users.disabled
       FROM passkey_credentials
       JOIN users ON users.id = passkey_credentials.user_id
      WHERE passkey_credentials.credential_id = ?`,
  )
    .bind(body.response.id)
    .first<CredentialRow>();
  if (!credentialRow || credentialRow.disabled === 1) {
    throw new HttpError(401, '这个 passkey 未注册或用户已停用。');
  }

  const credential: WebAuthnCredential = {
    id: credentialRow.credential_id,
    publicKey: base64urlToBytes(credentialRow.public_key),
    counter: credentialRow.counter,
    transports: credentialRow.transports
      ? (JSON.parse(credentialRow.transports) as AuthenticatorTransportFuture[])
      : undefined,
  };
  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: originFor(request, env),
    expectedRPID: rpIdFor(request, env),
    credential,
    requireUserVerification: false,
  });
  if (!verification.verified) throw new HttpError(401, 'Passkey 登录验证失败。');

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?').bind(
      verification.authenticationInfo.newCounter,
      now,
      credentialRow.credential_id,
    ),
    env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?').bind(challenge.id),
  ]);
  const headers = await createSession(env, credentialRow.user_id, request);
  return jsonResponse({ verified: true }, { headers });
}

export async function logout(env: AppEnv, request: Request): Promise<Response> {
  const auth = await getAuthContext(env, request);
  if (auth) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.tokenHash).run();
  }
  const headers = new Headers();
  headers.set('Set-Cookie', clearSessionCookie(secureCookie(request)));
  return jsonResponse({ ok: true }, { headers });
}

export async function adminUsers(env: AppEnv, request: Request): Promise<Response> {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(
    'SELECT id, display_name, role, disabled, created_at, updated_at FROM users ORDER BY created_at ASC',
  ).all<UserRow>();
  const payload: AdminUserResponse = { users: results.map(toApiUser) };
  return jsonResponse(payload);
}

export async function updateAdminUser(env: AppEnv, request: Request, userId: string): Promise<Response> {
  const auth = await requireAdmin(env, request);
  const body = await readJson<AdminUpdateUserRequest>(request);
  assertJsonObject(body);
  const user = await getUserById(env, userId);
  if (!user) throw new HttpError(404, '用户不存在。');

  const updates: string[] = [];
  const values: Array<string | number> = [];

  if ('displayName' in body) {
    updates.push('display_name = ?');
    values.push(validateDisplayName(body.displayName));
  }

  if ('disabled' in body) {
    if (typeof body.disabled !== 'boolean') throw new HttpError(400, '用户状态不正确。');
    if (auth.user.id === userId && body.disabled) {
      throw new HttpError(400, '不能停用当前登录的管理员。');
    }
    if (body.disabled) await assertCanRemoveActiveAdmin(env, user);
    updates.push('disabled = ?');
    values.push(body.disabled ? 1 : 0);
  }

  if (updates.length === 0) throw new HttpError(400, '没有可更新的用户字段。');

  updates.push('updated_at = ?');
  values.push(Date.now(), userId);

  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return jsonResponse({ ok: true });
}

export async function forceLogoutAdminUser(env: AppEnv, request: Request, userId: string): Promise<Response> {
  await requireAdmin(env, request);
  const user = await getUserById(env, userId);
  if (!user) throw new HttpError(404, '用户不存在。');
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return jsonResponse({ ok: true });
}

export async function deleteAdminUser(env: AppEnv, request: Request, userId: string): Promise<Response> {
  await requireAdmin(env, request);
  const body = await readJson<AdminDeleteUserRequest>(request);
  assertJsonObject(body);
  const user = await getUserById(env, userId);
  if (!user) throw new HttpError(404, '用户不存在。');
  if (typeof body.confirmDisplayName !== 'string' || body.confirmDisplayName !== user.display_name) {
    throw new HttpError(400, '请输入完整用户名确认删除。');
  }
  await assertCanRemoveActiveAdmin(env, user);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM pastes WHERE owner_user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM passkey_credentials WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
  return jsonResponse({ ok: true });
}
