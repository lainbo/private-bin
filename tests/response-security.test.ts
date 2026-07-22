import { describe, expect, it } from 'vitest';
import { assertSameOrigin, errorResponse, HttpError, jsonResponse } from '../src/worker/response';

describe('security responses', () => {
  it('prevents JSON responses from being cached', () => {
    const response = jsonResponse({ ok: true });

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(response.headers.get('Content-Security-Policy')).toContain("worker-src 'self'");
  });

  it('also prevents error responses from being cached', () => {
    const response = errorResponse(new HttpError(404, '不存在'));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('same-origin protection', () => {
  it('accepts an exact same-origin request', () => {
    const request = new Request('https://bin.example.com/api/pastes', {
      method: 'POST',
      headers: { Origin: 'https://bin.example.com' },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('rejects a missing or cross-origin Origin header', () => {
    const missing = new Request('https://bin.example.com/api/pastes', { method: 'POST' });
    const crossOrigin = new Request('https://bin.example.com/api/pastes', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });

    expect(() => assertSameOrigin(missing)).toThrow('请求来源不被允许。');
    expect(() => assertSameOrigin(crossOrigin)).toThrow('请求来源不被允许。');
  });
});
