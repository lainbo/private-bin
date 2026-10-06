import type { PasteCryptoSpec } from '../shared/api-types';
import type { PasteLanguage } from '../shared/constants';
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  IV_BYTES,
  MAX_TEXT_BYTES,
  SALT_BYTES,
} from '../shared/constants';
import { deriveArgon2id } from './argon2';
import { base64urlPattern, base64urlToBytes, bytesToBase64url, randomBase64url } from './base64url';
import { concatBytes, decodeUtf8, toArrayBuffer, utf8ByteLength, utf8Bytes } from './encoding';

const KEY_BYTES = 32;
const KEY_RE = base64urlPattern(KEY_BYTES);

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
  const material = concatBytes(keyBytes, utf8Bytes(password));
  const derivedKey = await deriveArgon2id({
    password: material,
    salt: base64urlToBytes(spec.salt),
    iterations: spec.iterations,
    memoryKiB: spec.memoryKiB,
    parallelism: spec.parallelism,
  });
  return crypto.subtle.importKey('raw', toArrayBuffer(derivedKey), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
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
    v: 2,
    alg: 'AES-GCM',
    kdf: 'ARGON2ID',
    iterations: ARGON2_ITERATIONS,
    memoryKiB: ARGON2_MEMORY_KIB,
    parallelism: ARGON2_PARALLELISM,
    salt: randomBase64url(SALT_BYTES),
    iv: randomBase64url(IV_BYTES),
    tagLength: 128,
    aad: {
      v: 2,
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
  if (!KEY_RE.test(key)) {
    throw new Error('链接里缺少解密密钥。');
  }
  return { key, requiresLoadConfirmation };
}
