const BOTTOM_NAV_EXACT_ROUTES = new Set([
  '/',
  '/diary',
  '/chat',
  '/mypage',
]);

const BOTTOM_NAV_ROUTE_PREFIXES = [
  '/diary/history',
];

/** Static Capacitor routes may include a trailing slash even when Next.js does not. */
function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || '/';
  if (pathOnly === '/') return pathOnly;
  return pathOnly.replace(/\/+$/, '') || '/';
}

/**
 * BottomNav is opt-in: new routes are full-page by default.
 * This prevents a newly added popup or editing flow from accidentally showing tabs.
 */
export function shouldShowBottomNav(pathname?: string | null): boolean {
  if (!pathname) return false;
  const normalizedPathname = normalizePathname(pathname);
  return BOTTOM_NAV_EXACT_ROUTES.has(normalizedPathname)
    || BOTTOM_NAV_ROUTE_PREFIXES.some(prefix => normalizedPathname.startsWith(prefix));
}

/** Full-page flows replace the current tab context and must never show BottomNav. */
export function isFullPageRoute(pathname?: string | null): boolean {
  return Boolean(pathname) && !shouldShowBottomNav(pathname);
}

const STATIC_ENTITY_ROUTE_ID = '1';

/** Capacitor static exports contain one physical dynamic-route page; the real ID travels in the query. */
export function buildStaticEntityRoute(basePath: string, entityId: string): string {
  if (process.env.NEXT_PUBLIC_BUILD_TARGET !== 'app') {
    return `${basePath}/${encodeURIComponent(entityId)}`;
  }
  return `${basePath}/${STATIC_ENTITY_ROUTE_ID}/?entityId=${encodeURIComponent(entityId)}`;
}

/** Resolve the real entity ID after the statically exported page has mounted in the WebView. */
export function resolveStaticEntityId(routeId: string): string {
  if (typeof window === 'undefined') return routeId;
  return new URLSearchParams(window.location.search).get('entityId') || routeId;
}
