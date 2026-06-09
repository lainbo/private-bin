import { bytesToBase64url, randomBase64url } from '../lib/base64url';

export function randomId(length = 16): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
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
