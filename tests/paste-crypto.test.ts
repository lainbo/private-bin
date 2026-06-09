import { describe, expect, it } from 'vitest';
import { toDataURL } from 'qrcode';
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
    expect(parsePasteHash('#abc123')).toEqual({
      key: 'abc123',
      requiresLoadConfirmation: false,
    });
    expect(parsePasteHash('#-abc123')).toEqual({
      key: 'abc123',
      requiresLoadConfirmation: true,
    });
    expect(() => parsePasteHash('#')).toThrow('链接里缺少解密密钥。');
  });

  it('enforces the 1MB plaintext limit', () => {
    expect(validateTextSize('a'.repeat(MAX_TEXT_BYTES))).toBe(MAX_TEXT_BYTES);
    expect(() => validateTextSize('a'.repeat(MAX_TEXT_BYTES + 1))).toThrow('内容超过 1MB 限制。');
  });
});

describe('expiration and QR code basics', () => {
  it('defaults to six hours and never includes forever', () => {
    const defaultOption = EXPIRATION_OPTIONS.find((option) => option.id === DEFAULT_EXPIRATION_ID);
    expect(defaultOption?.seconds).toBe(6 * 60 * 60);
    expect(EXPIRATION_OPTIONS.every((option) => option.seconds > 0)).toBe(true);
  });

  it('generates a QR data URL for a paste URL', async () => {
    const dataUrl = await toDataURL('https://bin.example.com/p/abc123def456ghi7#key', {
      margin: 1,
      width: 128,
    });
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
