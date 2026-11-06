export type AppTab = 'markets' | 'assets' | 'admin' | 'price' | 'liquidate';

export function pathFromLegacyHash(hash: string): string | null {
  const key = hash.replace(/^#/, '').trim();
  if (!key || key === 'home') return '/';
  if (key === 'markets' || key.startsWith('markets/'))
    return key.startsWith('markets/') ? `/${key}` : '/markets';
  if (key === 'supply' || key === 'lend' || key === 'borrow') return '/markets';
  return null;
}

export function tabFromPath(_pathname: string): AppTab {
  return 'markets';
}

export function pageTitleFromPath(pathname: string): string {
  if (pathname === '/' || pathname === '' || pathname.startsWith('/markets'))
    return 'LPFY - Markets';
  return 'LPFY | Unlock your locked liquidity';
}
