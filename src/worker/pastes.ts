import type {
  ConfigResponse,
  CreatePasteRequest,
  CreatePasteResponse,
  PasteCryptoSpec,
  PasteResponse,
} from '../shared/api-types';
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  EXPIRATION_OPTIONS,
  EXPIRATION_SECONDS,
  getDefaultExpirationSeconds,
  isPasteLanguage,
  IV_BYTES,
  LANGUAGE_OPTIONS,
  MAX_TEXT_BYTES,
  SALT_BYTES,
} from '../shared/constants';
import { base64urlPattern } from '../lib/base64url';
import { requireUser } from './auth';
import type { PasteRow } from './db';
import type { AppEnv } from './env';
import { HttpError, jsonResponse, readJson } from './response';
import { randomId } from './crypto';
import { enforceRateLimit } from './rate-limit';

const ID_RE = /^[a-z0-9]{16}$/u;
const SALT_RE = base64urlPattern(SALT_BYTES);
const IV_RE = base64urlPattern(IV_BYTES);
const MAX_CIPHERTEXT_CHARS = 1_500_000;
const CRYPTO_KEYS = [
  'v',
  'alg',
  'kdf',
  'iterations',
  'memoryKiB',
  'parallelism',
  'salt',
  'iv',
  'tagLength',
  'aad',
] satisfies Array<keyof PasteCryptoSpec>;
const AAD_KEYS = ['v', 'language', 'burnAfterReading', 'requiresPassword'] satisfies Array<
  keyof PasteCryptoSpec['aad']
>;

export function configResponse(): Response {
  const payload: ConfigResponse = {
    maxTextBytes: MAX_TEXT_BYTES,
    defaultExpirationSeconds: getDefaultExpirationSeconds(),
    expirations: EXPIRATION_OPTIONS.map((option) => ({ ...option })),
    languages: LANGUAGE_OPTIONS.map((option) => ({ ...option })),
  };
  return jsonResponse(payload);
}

function validatePasteId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Paste 不存在、已过期或已删除。');
  return id;
}

function hasExactKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseCrypto(value: unknown): PasteCryptoSpec {
  if (!value || typeof value !== 'object' || !hasExactKeys(value, CRYPTO_KEYS)) {
    throw new HttpError(400, '加密参数不正确。');
  }
  const spec = value as PasteCryptoSpec;
  if (
    spec.v !== 2 ||
    spec.alg !== 'AES-GCM' ||
    spec.kdf !== 'ARGON2ID' ||
    spec.iterations !== ARGON2_ITERATIONS ||
    spec.memoryKiB !== ARGON2_MEMORY_KIB ||
    spec.parallelism !== ARGON2_PARALLELISM ||
    typeof spec.salt !== 'string' ||
    !SALT_RE.test(spec.salt) ||
    typeof spec.iv !== 'string' ||
    !IV_RE.test(spec.iv) ||
    spec.tagLength !== 128 ||
    !spec.aad ||
    !hasExactKeys(spec.aad, AAD_KEYS) ||
    spec.aad.v !== 2 ||
    typeof spec.aad.burnAfterReading !== 'boolean' ||
    typeof spec.aad.requiresPassword !== 'boolean' ||
    !isPasteLanguage(spec.aad.language)
  ) {
    throw new HttpError(400, '加密参数不正确。');
  }
  return spec;
}

function validateCreatePaste(body: CreatePasteRequest): CreatePasteRequest {
  if (typeof body.ciphertext !== 'string' || body.ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    throw new HttpError(400, '密文大小不正确。');
  }
  const crypto = parseCrypto(body.crypto);
  if (!EXPIRATION_SECONDS.has(body.expiresInSeconds)) {
    throw new HttpError(400, '过期时间不正确。');
  }
  if (typeof body.burnAfterReading !== 'boolean' || body.burnAfterReading !== crypto.aad.burnAfterReading) {
    throw new HttpError(400, '阅后即焚参数不一致。');
  }
  if (typeof body.requiresPassword !== 'boolean' || body.requiresPassword !== crypto.aad.requiresPassword) {
    throw new HttpError(400, '密码保护参数不一致。');
  }
  if (!Number.isInteger(body.textSize) || body.textSize < 1 || body.textSize > MAX_TEXT_BYTES) {
    throw new HttpError(400, '文本大小不正确。');
  }
  if (!isPasteLanguage(body.language) || body.language !== crypto.aad.language) {
    throw new HttpError(400, '代码语言不正确。');
  }
  return { ...body, crypto };
}

function rowToPaste(row: PasteRow, now: number): PasteResponse {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    crypto: JSON.parse(row.crypto) as PasteCryptoSpec,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    burnAfterReading: row.burn_after_reading === 1,
    requiresPassword: row.requires_password === 1,
    textSize: row.text_size,
    language: row.language,
    timeToLiveSeconds: Math.max(0, Math.floor((row.expires_at - now) / 1000)),
  };
}

export async function createPaste(env: AppEnv, request: Request): Promise<Response> {
  const auth = await requireUser(env, request);
  await enforceRateLimit(env.CREATE_RATE_LIMITER, `private-bin:create:${auth.user.id}`);
  const body = validateCreatePaste(await readJson<CreatePasteRequest>(request, 2 * 1024 * 1024));
  const now = Date.now();
  const expiresAt = now + body.expiresInSeconds * 1000;
  const id = randomId(16);

  await env.DB.prepare(
    `INSERT INTO pastes
     (id, owner_user_id, version, ciphertext, crypto, expires_at, burn_after_reading, requires_password, text_size, language, created_at)
     VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      auth.user.id,
      body.ciphertext,
      JSON.stringify(body.crypto),
      expiresAt,
      body.burnAfterReading ? 1 : 0,
      body.requiresPassword ? 1 : 0,
      body.textSize,
      body.language,
      now,
    )
    .run();

  const payload: CreatePasteResponse = { id, expiresAt, createdAt: now };
  return jsonResponse(payload, { status: 201 });
}

export async function getPaste(env: AppEnv, id: string): Promise<Response> {
  const pasteId = validatePasteId(id);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(pasteId),
    env.DB.prepare('DELETE FROM pastes WHERE id = ? AND expires_at <= ?').bind(pasteId, now),
  ]);
  const rows = (results[0].results ?? []) as unknown as PasteRow[];
  const row = rows[0];
  if (!row || row.expires_at <= now) throw new HttpError(404, 'Paste 不存在、已过期或已删除。');
  if (row.burn_after_reading === 1) {
    throw new HttpError(409, '这个 Paste 需要确认后才能打开。');
  }
  return jsonResponse(rowToPaste(row, now));
}

export async function consumePaste(env: AppEnv, id: string): Promise<Response> {
  const pasteId = validatePasteId(id);
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare('SELECT * FROM pastes WHERE id = ?').bind(pasteId),
    env.DB.prepare('DELETE FROM pastes WHERE id = ? AND expires_at <= ?').bind(pasteId, now),
    env.DB.prepare('DELETE FROM pastes WHERE id = ? AND burn_after_reading = 1 AND expires_at > ?').bind(
      pasteId,
      now,
    ),
  ]);
  const rows = (results[0].results ?? []) as unknown as PasteRow[];
  const row = rows[0];
  if (!row || row.expires_at <= now) throw new HttpError(404, 'Paste 不存在、已过期或已删除。');
  if (row.burn_after_reading !== 1) throw new HttpError(400, '这个 Paste 不是阅后即焚。');
  return jsonResponse(rowToPaste(row, now));
}

export async function deletePaste(env: AppEnv, request: Request, id: string): Promise<Response> {
  const pasteId = validatePasteId(id);
  const auth = await requireUser(env, request);
  const row = await env.DB.prepare('SELECT owner_user_id FROM pastes WHERE id = ?')
    .bind(pasteId)
    .first<{ owner_user_id: string }>();
  if (!row) throw new HttpError(404, 'Paste 不存在、已过期或已删除。');
  if (row.owner_user_id !== auth.user.id && auth.user.role !== 'admin') {
    throw new HttpError(403, '只能删除自己创建的 Paste。');
  }
  await env.DB.prepare('DELETE FROM pastes WHERE id = ?').bind(pasteId).run();
  return jsonResponse({ ok: true });
}
