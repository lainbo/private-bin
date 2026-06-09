import type { ApiUser } from '../shared/api-types';
import type { AppEnv } from './env';

export type UserRow = {
  id: string;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
  created_at: number;
  updated_at: number;
};

export type CredentialRow = {
  credential_id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  credential_device_type: string | null;
  credential_backed_up: number;
  created_at: number;
  last_used_at: number | null;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
};

export type ChallengeRow = {
  id: string;
  kind: 'registration' | 'authentication';
  challenge: string;
  user_id: string | null;
  display_name: string | null;
  expires_at: number;
  created_at: number;
};

export type PasteRow = {
  id: string;
  owner_user_id: string;
  version: number;
  ciphertext: string;
  crypto: string;
  expires_at: number;
  burn_after_reading: number;
  requires_password: number;
  text_size: number;
  language: string;
  created_at: number;
  read_count: number;
  last_read_at: number | null;
};

export function toApiUser(row: UserRow): ApiUser {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
  };
}

export async function getUserById(env: AppEnv, userId: string): Promise<UserRow | null> {
  return (
    (await env.DB.prepare(
      'SELECT id, display_name, role, disabled, created_at, updated_at FROM users WHERE id = ?',
    )
      .bind(userId)
      .first<UserRow>()) ?? null
  );
}

export async function countUsers(env: AppEnv): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function cleanupExpired(env: AppEnv, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM pastes WHERE expires_at <= ?').bind(now),
  ]);
}
