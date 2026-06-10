import {
  adminUsers,
  authStatus,
  deleteAdminUser,
  forceLogoutAdminUser,
  loginOptions,
  logout,
  registerOptions,
  updateAdminUser,
  verifyLogin,
  verifyRegister,
} from './auth';
import { cleanupExpired } from './db';
import type { AppEnv } from './env';
import { configResponse, createPaste, deletePaste, getPaste } from './pastes';
import { assertSameOrigin, assetResponse, errorResponse, HttpError } from './response';

function pasteIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/pastes\/([^/]+)$/u);
  return match?.[1] ?? null;
}

async function handleApi(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== 'GET') {
    assertSameOrigin(request);
  }
  ctx.waitUntil(cleanupExpired(env));

  if (url.pathname === '/api/config' && method === 'GET') return configResponse();
  if (url.pathname === '/api/auth/status' && method === 'GET') return authStatus(env, request);
  if (url.pathname === '/api/auth/register/options' && method === 'POST') return registerOptions(env, request);
  if (url.pathname === '/api/auth/register/verify' && method === 'POST') return verifyRegister(env, request);
  if (url.pathname === '/api/auth/login/options' && method === 'POST') return loginOptions(env, request);
  if (url.pathname === '/api/auth/login/verify' && method === 'POST') return verifyLogin(env, request);
  if (url.pathname === '/api/auth/logout' && method === 'POST') return logout(env, request);
  if (url.pathname === '/api/admin/users' && method === 'GET') return adminUsers(env, request);

  const adminUserLogoutMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/logout$/u);
  if (adminUserLogoutMatch && method === 'POST') return forceLogoutAdminUser(env, request, adminUserLogoutMatch[1]);

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/u);
  if (adminUserMatch && method === 'PATCH') return updateAdminUser(env, request, adminUserMatch[1]);
  if (adminUserMatch && method === 'DELETE') return deleteAdminUser(env, request, adminUserMatch[1]);

  if (url.pathname === '/api/pastes' && method === 'POST') return createPaste(env, request);
  const pasteId = pasteIdFromPath(url.pathname);
  if (pasteId && method === 'GET') return getPaste(env, pasteId);
  if (pasteId && method === 'DELETE') return deletePaste(env, request, pasteId);

  throw new HttpError(404, '接口不存在。');
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, ctx);
      }
      return await assetResponse(await env.ASSETS.fetch(request), request);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
