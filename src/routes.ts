export type Route = { name: 'home' } | { name: 'admin' } | { name: 'paste'; id: string };

export function currentRoute(): Route {
  if (window.location.pathname === '/admin') return { name: 'admin' };
  const match = window.location.pathname.match(/^\/p\/([a-z0-9]{16})$/u);
  if (match) return { name: 'paste', id: match[1] };
  return { name: 'home' };
}
