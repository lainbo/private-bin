import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPIRATION_ID, EXPIRATION_OPTIONS, MAX_TEXT_BYTES } from '../src/shared/constants';
import { decryptPasteText, encryptPasteText, parsePasteHash, validateTextSize } from '../src/lib/paste-crypto';

describe('paste crypto', () => {
  it('round-trips text without a password', async () => {
    const encrypted = await encryptPasteText({
      text: 'console.log("hello");',
      password: '',
      language: 'javascript',
      burnAfterReading: false,
    });

    await expect(
      decryptPasteText({
        ciphertext: encrypted.ciphertext,
        crypto: encrypted.crypto,
        key: encrypted.key,
        password: '',
      }),
    ).resolves.toBe('console.log("hello");');
    expect(encrypted.crypto).toMatchObject({
      v: 2,
      kdf: 'ARGON2ID',
      iterations: 4,
      memoryKiB: 64 * 1024,
      parallelism: 5,
    });
  });

  it('requires the same password when password protection is enabled', async () => {
    const encrypted = await encryptPasteText({
      text: '只有知道密码的人能看见。',
      password: 'correct horse battery staple',
      language: 'text',
      burnAfterReading: true,
    });

    await expect(
      decryptPasteText({
        ciphertext: encrypted.ciphertext,
        crypto: encrypted.crypto,
        key: encrypted.key,
        password: 'wrong',
      }),
    ).rejects.toThrow();

    await expect(
      decryptPasteText({
        ciphertext: encrypted.ciphertext,
        crypto: encrypted.crypto,
        key: encrypted.key,
        password: 'correct horse battery staple',
      }),
    ).resolves.toBe('只有知道密码的人能看见。');
  });

  it('parses normal and burn-after-reading URL fragments', () => {
    const key = 'a'.repeat(43);
    expect(parsePasteHash(`#${key}`)).toEqual({
      key,
      requiresLoadConfirmation: false,
    });
    expect(parsePasteHash(`#-${key}`)).toEqual({
      key,
      requiresLoadConfirmation: true,
    });
    expect(() => parsePasteHash('#')).toThrow('链接里缺少解密密钥。');
    expect(() => parsePasteHash('#too-short')).toThrow('链接里缺少解密密钥。');
  });

  it('authenticates public metadata through AES-GCM AAD', async () => {
    const encrypted = await encryptPasteText({
      text: '不可篡改的内容',
      password: '',
      language: 'text',
      burnAfterReading: false,
    });

    await expect(
      decryptPasteText({
        ciphertext: encrypted.ciphertext,
        crypto: {
          ...encrypted.crypto,
          aad: { ...encrypted.crypto.aad, burnAfterReading: true },
        },
        key: encrypted.key,
        password: '',
      }),
    ).rejects.toThrow();
  });

  it('enforces the 1MB plaintext limit', () => {
    expect(validateTextSize('a'.repeat(MAX_TEXT_BYTES))).toBe(MAX_TEXT_BYTES);
    expect(() => validateTextSize('a'.repeat(MAX_TEXT_BYTES + 1))).toThrow('内容超过 1MB 限制。');
  });
});

describe('expiration options', () => {
  it('defaults to six hours and never includes forever', () => {
    const defaultOption = EXPIRATION_OPTIONS.find((option) => option.id === DEFAULT_EXPIRATION_ID);
    expect(defaultOption?.seconds).toBe(6 * 60 * 60);
    expect(EXPIRATION_OPTIONS.every((option) => option.seconds > 0)).toBe(true);
  });
});
