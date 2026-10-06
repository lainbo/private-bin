import { describe, expect, it } from 'vitest';
import type { PasteCryptoSpec } from '../src/shared/api-types';
import type { PasteRow } from '../src/worker/db';
import type { AppEnv } from '../src/worker/env';
import { consumePaste, getPaste } from '../src/worker/pastes';
import worker from '../src/worker/index';

type QueryResult = { results?: unknown[]; success?: boolean };

const cryptoSpec: PasteCryptoSpec = {
  v: 2,
  alg: 'AES-GCM',
  kdf: 'ARGON2ID',
  iterations: 4,
  memoryKiB: 64 * 1024,
  parallelism: 5,
  salt: 'a'.repeat(22),
  iv: 'b'.repeat(16),
  tagLength: 128,
  aad: {
    v: 2,
    language: 'text',
    burnAfterReading: false,
    requiresPassword: false,
  },
};

class TestStatement {
  private values: unknown[] = [];

  constructor(
    private readonly rows: PasteRow[],
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): TestStatement {
    this.values = values;
    return this;
  }

  execute(): QueryResult {
    if (this.query === 'SELECT * FROM pastes WHERE id = ?') {
      const [id] = this.values as [string];
      const row = this.rows.find((item) => item.id === id);
      return { results: row ? [row] : [] };
    }

    if (this.query.includes('DELETE FROM pastes WHERE id = ? AND expires_at <= ?')) {
      const [id, now] = this.values as [string, number];
      this.remove((row) => row.id === id && row.expires_at <= now);
      return { success: true };
    }

    if (this.query.includes('DELETE FROM pastes WHERE id = ? AND burn_after_reading = 1')) {
      const [id, now] = this.values as [string, number];
      this.remove((row) => row.id === id && row.burn_after_reading === 1 && row.expires_at > now);
      return { success: true };
    }

    if (this.query === 'DELETE FROM pastes WHERE expires_at <= ?') {
      const [now] = this.values as [number];
      this.remove((row) => row.expires_at <= now);
      return { success: true };
    }

    if (this.query.startsWith('DELETE FROM sessions') || this.query.startsWith('DELETE FROM auth_challenges')) {
      return { success: true };
    }

    throw new Error(`Unhandled query: ${this.query}`);
  }

  private remove(predicate: (row: PasteRow) => boolean): void {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (predicate(this.rows[index])) this.rows.splice(index, 1);
    }
  }
}

class TestDatabase {
  constructor(private readonly rows: PasteRow[]) {}

  prepare(query: string): TestStatement {
    return new TestStatement(this.rows, query);
  }

  async batch(statements: TestStatement[]): Promise<QueryResult[]> {
    return statements.map((statement) => statement.execute());
  }
}

function pasteRow(options: { id: string; burn: boolean; expiresAt?: number }): PasteRow {
  const spec: PasteCryptoSpec = {
    ...cryptoSpec,
    aad: { ...cryptoSpec.aad, burnAfterReading: options.burn },
  };
  return {
    id: options.id,
    owner_user_id: 'owner',
    version: 2,
    ciphertext: 'ciphertext',
    crypto: JSON.stringify(spec),
    expires_at: options.expiresAt ?? Date.now() + 60_000,
    burn_after_reading: options.burn ? 1 : 0,
    requires_password: 0,
    text_size: 10,
    language: 'text',
    created_at: Date.now(),
  };
}

function setup(rows: PasteRow[]): AppEnv {
  return {
    DB: new TestDatabase(rows) as unknown as D1Database,
    ASSETS: {} as Fetcher,
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    CREATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

describe('paste retrieval', () => {
  it('does not consume a burn paste through GET', async () => {
    const rows = [pasteRow({ id: 'aaaaaaaaaaaaaaaa', burn: true })];

    await expect(getPaste(setup(rows), 'aaaaaaaaaaaaaaaa')).rejects.toMatchObject({ status: 409 });
    expect(rows).toHaveLength(1);
  });

  it('returns and deletes a burn paste through explicit consume', async () => {
    const rows = [pasteRow({ id: 'bbbbbbbbbbbbbbbb', burn: true })];

    const response = await consumePaste(setup(rows), 'bbbbbbbbbbbbbbbb');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ id: 'bbbbbbbbbbbbbbbb', burnAfterReading: true });
    expect(rows).toHaveLength(0);
  });

  it('rejects consuming a normal paste without deleting it', async () => {
    const rows = [pasteRow({ id: 'cccccccccccccccc', burn: false })];

    await expect(consumePaste(setup(rows), 'cccccccccccccccc')).rejects.toMatchObject({ status: 400 });
    expect(rows).toHaveLength(1);
  });

  it('returns a normal paste without deleting it', async () => {
    const rows = [pasteRow({ id: 'dddddddddddddddd', burn: false })];

    const response = await getPaste(setup(rows), 'dddddddddddddddd');

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
  });

  it('deletes an expired paste and returns not found', async () => {
    const rows = [pasteRow({ id: 'eeeeeeeeeeeeeeee', burn: false, expiresAt: Date.now() - 1 })];

    await expect(getPaste(setup(rows), 'eeeeeeeeeeeeeeee')).rejects.toMatchObject({ status: 404 });
    expect(rows).toHaveLength(0);
  });

  it('routes an exact same-origin POST to the burn consume endpoint', async () => {
    const rows = [pasteRow({ id: 'ffffffffffffffff', burn: true })];
    const request = new Request('https://bin.example.com/api/pastes/ffffffffffffffff/consume', {
      method: 'POST',
      headers: { Origin: 'https://bin.example.com' },
    });

    const response = await worker.fetch(request, setup(rows));

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it('rejects a consume POST without an Origin header', async () => {
    const rows = [pasteRow({ id: 'gggggggggggggggg', burn: true })];
    const request = new Request('https://bin.example.com/api/pastes/gggggggggggggggg/consume', {
      method: 'POST',
    });

    const response = await worker.fetch(request, setup(rows));

    expect(response.status).toBe(403);
    expect(rows).toHaveLength(1);
  });
});
