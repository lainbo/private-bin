import { HttpError } from './response';

export async function enforceRateLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) {
    throw new HttpError(429, '操作过于频繁，请一分钟后重试。', { 'Retry-After': '60' });
  }
}
