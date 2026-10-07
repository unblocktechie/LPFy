export type AppTab =
	| 'markets'
	| 'assets'
	| 'admin'
	| 'price'
	| 'liquidate';

/** Map legacy `#hash` URLs to path routes. */
export function pathFromLegacyHash(hash: string): string | null {
	const key = hash.replace(/^#/, '').trim();
	if (!key || key === 'home') return '/';
	if (key === 'markets' || key.startsWith('markets/')) {
		return key.startsWith('markets/') ? `/${key}` : '/markets';
	}
	if (key === 'supply' || key === 'lend' || key === 'borrow')
		return '/markets';
	if (
		key === 'assets' ||
		key === 'loans' ||
		key === 'my-loan' ||
		key === 'my-loans'
	)
		return '/assets';
	if (key === 'admin') return '/admin';
	if (key === 'price') return '/price';
	if (key === 'liquidate') return '/liquidate';
	return null;
}

export function tabFromPath(pathname: string): AppTab {
	if (pathname.startsWith('/markets')) return 'markets';
	if (pathname.startsWith('/assets')) return 'assets';
	if (pathname.startsWith('/admin')) return 'admin';
	if (pathname.startsWith('/price')) return 'price';
	if (pathname.startsWith('/liquidate')) return 'liquidate';
	return 'markets';
}

/** Browser tab title: "LPFY - Markets" etc. */
export function pageTitleFromPath(pathname: string): string {
	if (pathname === '/' || pathname === '') return 'LPFY - Markets';
	if (pathname.startsWith('/markets')) return 'LPFY - Markets';
	if (pathname.startsWith('/assets')) return 'LPFY - Assets';
	if (pathname.startsWith('/liquidate')) return 'LPFY - Liquidate';
	if (pathname.startsWith('/admin')) return 'LPFY - Admin';
	if (pathname.startsWith('/price')) return 'LPFY - Price';
	return 'LPFY | Unlock your locked liquidity';
}
