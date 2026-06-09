const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
};

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; manifest-src 'self'";

const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
};

function isLocalDevelopmentRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function applySecurityHeaders(headers: Headers, request?: Request): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  if (request && isLocalDevelopmentRequest(request)) {
    headers.set(
      'Content-Security-Policy',
      CONTENT_SECURITY_POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    );
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(payload), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ message: error.message }, { status: error.status });
  }
  console.error(error);
  return jsonResponse({ message: '服务器暂时无法处理请求。' }, { status: 500 });
}

export async function assetResponse(response: Response, request?: Request): Promise<Response> {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, request);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, '请求必须使用 JSON。');
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'JSON 格式不正确。');
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    throw new HttpError(403, '请求来源不被允许。');
  }
}
