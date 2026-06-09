import type { PasteCryptoSpec } from '../shared/api-types';
import type { PasteLanguage } from '../shared/constants';
import { MAX_TEXT_BYTES } from '../shared/constants';
import { base64urlToBytes, bytesToBase64url, randomBase64url } from './base64url';
import { concatBytes, decodeUtf8, toArrayBuffer, utf8ByteLength, utf8Bytes } from './encoding';

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 100_000;

export type EncryptedPaste = {
  ciphertext: string;
  crypto: PasteCryptoSpec;
  key: string;
  textSize: number;
};

export function validateTextSize(text: string): number {
  const size = utf8ByteLength(text);
  if (size === 0) {
    throw new Error('请输入要传输的文字。');
  }
  if (size > MAX_TEXT_BYTES) {
    throw new Error('内容超过 1MB 限制。');
  }
  return size;
}

async function deriveAesKey(secret: string, password: string, spec: PasteCryptoSpec): Promise<CryptoKey> {
  const keyBytes = base64urlToBytes(secret);
  const passwordBytes = utf8Bytes(password);
  const material = passwordBytes.byteLength > 0 ? concatBytes(keyBytes, passwordBytes) : keyBytes;
  const imported = await crypto.subtle.importKey('raw', toArrayBuffer(material), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(base64urlToBytes(spec.salt)),
      iterations: spec.iterations,
      hash: 'SHA-256',
    },
    imported,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aesParams(spec: PasteCryptoSpec): AesGcmParams {
  return {
    name: 'AES-GCM',
    iv: toArrayBuffer(base64urlToBytes(spec.iv)),
    additionalData: toArrayBuffer(utf8Bytes(JSON.stringify(spec.aad))),
    tagLength: spec.tagLength,
  };
}

export async function encryptPasteText(options: {
  text: string;
  password: string;
  language: PasteLanguage;
  burnAfterReading: boolean;
}): Promise<EncryptedPaste> {
  const textSize = validateTextSize(options.text);
  const key = randomBase64url(KEY_BYTES);
  const cryptoSpec: PasteCryptoSpec = {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: randomBase64url(SALT_BYTES),
    iv: randomBase64url(IV_BYTES),
    tagLength: 128,
    aad: {
      v: 1,
      language: options.language,
      burnAfterReading: options.burnAfterReading,
      requiresPassword: options.password.length > 0,
    },
  };
  const aesKey = await deriveAesKey(key, options.password, cryptoSpec);
  const encrypted = await crypto.subtle.encrypt(
    aesParams(cryptoSpec),
    aesKey,
    toArrayBuffer(utf8Bytes(options.text)),
  );

  return {
    ciphertext: bytesToBase64url(new Uint8Array(encrypted)),
    crypto: cryptoSpec,
    key,
    textSize,
  };
}

export async function decryptPasteText(options: {
  ciphertext: string;
  crypto: PasteCryptoSpec;
  key: string;
  password: string;
}): Promise<string> {
  const aesKey = await deriveAesKey(options.key, options.password, options.crypto);
  const decrypted = await crypto.subtle.decrypt(
    aesParams(options.crypto),
    aesKey,
    toArrayBuffer(base64urlToBytes(options.ciphertext)),
  );
  return decodeUtf8(decrypted);
}

export function parsePasteHash(hash: string): { key: string; requiresLoadConfirmation: boolean } {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  const requiresLoadConfirmation = value.startsWith('-');
  const key = requiresLoadConfirmation ? value.slice(1) : value;
  if (!key) {
    throw new Error('链接里缺少解密密钥。');
  }
  return { key, requiresLoadConfirmation };
}
