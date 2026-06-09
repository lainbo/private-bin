import type { PasteLanguage } from './constants';

export type ApiUser = {
  id: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: number;
};

export type AuthStatusResponse = {
  authenticated: boolean;
  registrationOpen: boolean;
  user: ApiUser | null;
};

export type ConfigResponse = {
  maxTextBytes: number;
  defaultExpirationSeconds: number;
  expirations: Array<{
    id: string;
    label: string;
    seconds: number;
  }>;
  languages: Array<{
    id: PasteLanguage;
    label: string;
  }>;
};

export type PasteCryptoSpec = {
  v: 1;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  tagLength: 128;
  aad: {
    v: 1;
    language: PasteLanguage;
    burnAfterReading: boolean;
    requiresPassword: boolean;
  };
};

export type CreatePasteRequest = {
  ciphertext: string;
  crypto: PasteCryptoSpec;
  expiresInSeconds: number;
  burnAfterReading: boolean;
  requiresPassword: boolean;
  textSize: number;
  language: PasteLanguage;
};

export type CreatePasteResponse = {
  id: string;
  expiresAt: number;
  createdAt: number;
};

export type PasteResponse = {
  id: string;
  ciphertext: string;
  crypto: PasteCryptoSpec;
  expiresAt: number;
  createdAt: number;
  burnAfterReading: boolean;
  requiresPassword: boolean;
  textSize: number;
  language: PasteLanguage;
  timeToLiveSeconds: number;
};

export type AdminUserResponse = {
  users: ApiUser[];
};
