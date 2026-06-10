import { describe, expect, it } from 'vitest';
import {
  deleteAdminUser,
  forceLogoutAdminUser,
  updateAdminUser,
} from '../src/worker/auth';
import { sha256Base64url } from '../src/worker/crypto';
import type { AppEnv } from '../src/worker/env';
import type { UserRow } from '../src/worker/db';

type TestUser = UserRow;

type TestTables = {
  users: TestUser[];
  sessions: Array<{ token_hash: string; user_id: string; expires_at: number; created_at: number; last_seen_at: number }>;
  pastes: Array<{ id: string; owner_user_id: string }>;
  passkeyCredentials: Array<{ credential_id: string; user_id: string }>;
};

type QueryResult<T = unknown> = {
  results?: T[];
  success?: boolean;
};

class TestD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly tables: TestTables,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): TestD1Statement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.query.includes('FROM sessions') && this.query.includes('JOIN users')) {
      const [tokenHash, now] = this.values as [string, number];
      const session = this.tables.sessions.find((row) => row.token_hash === tokenHash && row.expires_at > now);
      if (!session) return null;
      return (this.tables.users.find((user) => user.id === session.user_id) ?? null) as T | null;
    }

    if (this.query.includes('FROM users WHERE id = ?')) {
      const [userId] = this.values as [string];
      return (this.tables.users.find((user) => user.id === userId) ?? null) as T | null;
    }

    if (this.query.includes('COUNT(*) AS count FROM users WHERE role = ? AND disabled = 0')) {
      const [role] = this.values as [TestUser['role']];
      return { count: this.tables.users.filter((user) => user.role === role && user.disabled === 0).length } as T;
    }

    throw new Error(`Unhandled first query: ${this.query}`);
  }

  async all<T>(): Promise<QueryResult<T>> {
    if (this.query.includes('FROM users ORDER BY created_at ASC')) {
      return { results: [...this.tables.users].sort((a, b) => a.created_at - b.created_at) as T[] };
    }
    throw new Error(`Unhandled all query: ${this.query}`);
  }

  async run(): Promise<QueryResult> {
    if (this.query.startsWith('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')) {
      const [lastSeenAt, tokenHash] = this.values as [number, string];
      const session = this.tables.sessions.find((row) => row.token_hash === tokenHash);
      if (session) session.last_seen_at = lastSeenAt;
      return { success: true };
    }

    if (this.query.startsWith('UPDATE users SET')) {
      const userId = this.values[this.values.length - 1] as string;
      const user = this.tables.users.find((row) => row.id === userId);
      if (!user) return { success: true };
      const assignments = this.query.slice('UPDATE users SET '.length, this.query.indexOf(' WHERE id = ?')).split(', ');
      assignments.forEach((assignment, index) => {
        const value = this.values[index];
        if (assignment === 'display_name = ?') user.display_name = value as string;
        if (assignment === 'disabled = ?') user.disabled = value as number;
        if (assignment === 'updated_at = ?') user.updated_at = value as number;
      });
      return { success: true };
    }

    if (this.query.startsWith('DELETE FROM sessions WHERE user_id = ?')) {
      const [userId] = this.values as [string];
      this.tables.sessions = this.tables.sessions.filter((row) => row.user_id !== userId);
      return { success: true };
    }

    if (this.query.startsWith('DELETE FROM pastes WHERE owner_user_id = ?')) {
      const [userId] = this.values as [string];
      this.tables.pastes = this.tables.pastes.filter((row) => row.owner_user_id !== userId);
      return { success: true };
    }

    if (this.query.startsWith('DELETE FROM passkey_credentials WHERE user_id = ?')) {
      const [userId] = this.values as [string];
      this.tables.passkeyCredentials = this.tables.passkeyCredentials.filter((row) => row.user_id !== userId);
      return { success: true };
    }

    if (this.query.startsWith('DELETE FROM users WHERE id = ?')) {
      const [userId] = this.values as [string];
      this.tables.users = this.tables.users.filter((row) => row.id !== userId);
      return { success: true };
    }

    throw new Error(`Unhandled run query: ${this.query}`);
  }
}

class TestD1Database {
  constructor(private readonly tables: TestTables) {}

  prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.tables, query);
  }

  async batch(statements: TestD1Statement[]): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

function user(id: string, displayName: string, role: TestUser['role'], disabled = 0): TestUser {
  return {
    id,
    display_name: displayName,
    role,
    disabled,
    created_at: 1,
    updated_at: 1,
  };
}

async function setupEnv(users: TestUser[]): Promise<{ env: AppEnv; tables: TestTables; cookie: string }> {
  const tokenHash = await sha256Base64url('admin-token');
  const tables: TestTables = {
    users,
    sessions: [
      { token_hash: tokenHash, user_id: 'admin-1', expires_at: Date.now() + 60_000, created_at: 1, last_seen_at: 1 },
      { token_hash: 'target-session', user_id: 'user-1', expires_at: Date.now() + 60_000, created_at: 1, last_seen_at: 1 },
    ],
    pastes: [
      { id: 'paste-1', owner_user_id: 'user-1' },
      { id: 'paste-2', owner_user_id: 'admin-1' },
    ],
    passkeyCredentials: [
      { credential_id: 'cred-user', user_id: 'user-1' },
      { credential_id: 'cred-admin', user_id: 'admin-1' },
    ],
  };
  return {
    env: {
      DB: new TestD1Database(tables) as unknown as D1Database,
      ASSETS: {} as Fetcher,
    },
    tables,
    cookie: 'pb_session=admin-token',
  };
}

function jsonRequest(cookie: string, body?: unknown): Request {
  return new Request('https://bin.example.com/api/admin/users/user-1', {
    method: 'PATCH',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('admin user management', () => {
  it('renames a user', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'Old', 'user')]);

    const response = await updateAdminUser(env, jsonRequest(cookie, { displayName: '  New Name  ' }), 'user-1');

    expect(response.status).toBe(200);
    expect(tables.users.find((row) => row.id === 'user-1')?.display_name).toBe('New Name');
  });

  it('force logs out a user', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    const response = await forceLogoutAdminUser(env, jsonRequest(cookie), 'user-1');

    expect(response.status).toBe(200);
    expect(tables.sessions.some((row) => row.user_id === 'user-1')).toBe(false);
    expect(tables.sessions.some((row) => row.user_id === 'admin-1')).toBe(true);
  });

  it('allows an admin to force log out the current session', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    const response = await forceLogoutAdminUser(env, jsonRequest(cookie), 'admin-1');

    expect(response.status).toBe(200);
    expect(tables.sessions.some((row) => row.user_id === 'admin-1')).toBe(false);
  });

  it('deletes a user only after exact display name confirmation and clears owned data', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    const response = await deleteAdminUser(env, jsonRequest(cookie, { confirmDisplayName: 'User' }), 'user-1');

    expect(response.status).toBe(200);
    expect(tables.users.some((row) => row.id === 'user-1')).toBe(false);
    expect(tables.sessions.some((row) => row.user_id === 'user-1')).toBe(false);
    expect(tables.pastes.some((row) => row.owner_user_id === 'user-1')).toBe(false);
    expect(tables.passkeyCredentials.some((row) => row.user_id === 'user-1')).toBe(false);
    expect(tables.pastes.some((row) => row.owner_user_id === 'admin-1')).toBe(true);
  });

  it('rejects deleting the last active admin', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    await expect(deleteAdminUser(env, jsonRequest(cookie, { confirmDisplayName: 'Admin' }), 'admin-1')).rejects.toThrow(
      '不能移除最后一个管理员。',
    );
    expect(tables.users.some((row) => row.id === 'admin-1')).toBe(true);
  });

  it('rejects disabling the last active admin', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    await expect(updateAdminUser(env, jsonRequest(cookie, { disabled: true }), 'admin-1')).rejects.toThrow(
      '不能停用当前登录的管理员。',
    );
    expect(tables.users.find((row) => row.id === 'admin-1')?.disabled).toBe(0);
  });

  it('requires exact display name confirmation before deleting', async () => {
    const { env, tables, cookie } = await setupEnv([user('admin-1', 'Admin', 'admin'), user('user-1', 'User', 'user')]);

    await expect(deleteAdminUser(env, jsonRequest(cookie, { confirmDisplayName: 'user' }), 'user-1')).rejects.toThrow(
      '请输入完整用户名确认删除。',
    );
    expect(tables.users.some((row) => row.id === 'user-1')).toBe(true);
  });
});
