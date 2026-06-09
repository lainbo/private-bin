export type AppEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  ALLOW_PASSKEY_REGISTRATION?: string;
  PUBLIC_ORIGIN?: string;
  RP_ID?: string;
  SESSION_TTL_DAYS?: string;
};
