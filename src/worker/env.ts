export type AppEnv = Pick<Env, 'DB' | 'ASSETS' | 'AUTH_RATE_LIMITER' | 'CREATE_RATE_LIMITER'> & {
  ALLOW_PASSKEY_REGISTRATION?: string;
  PUBLIC_ORIGIN?: string;
  RP_ID?: string;
  SESSION_TTL_DAYS?: string;
};
