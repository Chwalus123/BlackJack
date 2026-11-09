import { signal } from '@preact/signals';

/** Hash router: #/path?query. Works with static hosting and needs no server rewrites. */
export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '') || '/';
  const [p, q] = raw.split('?');
  const path = (p || '/').replace(/\/+$/, '') || '/';
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}

export const route = signal<Route>(parse());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse();
  });
}

export function navigate(path: string, opts?: { replace?: boolean }): void {
  const url = `#${path}`;
  if (opts?.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  route.value = parse();
}

export function back(fallback = '/'): void {
  if (history.length > 1) history.back();
  else navigate(fallback);
}
