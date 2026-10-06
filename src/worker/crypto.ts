import { bytesToBase64url, randomBase64url } from '../lib/base64url';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// 只使用小于 252（36 的整数倍）的字节，取模后每个字符出现的概率相同
const UNBIASED_BYTE_LIMIT = 256 - (256 % ID_ALPHABET.length);

export function randomId(length: number): string {
  let id = '';
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < UNBIASED_BYTE_LIMIT && id.length < length) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  return id;
}

export async function sha256Base64url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToBase64url(new Uint8Array(digest));
}

export function sessionToken(): string {
  return randomBase64url(32);
}
