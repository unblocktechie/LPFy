import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
	useAccount,
	useConnect,
	useDisconnect,
	useSwitchChain,
} from 'wagmi';
import { BrandLockup } from '../components/BrandMark';
import { AdminPanel, useIsProtocolAdmin } from '../components/AdminPanel';
import { Spinner } from '../components/Loader';
import { shortAddr } from '../lib/format';
import { useNetwork } from '../lib/networkContext';
import {
	type AppTab,
	pageTitleFromPath,
	pathFromLegacyHash,
	tabFromPath,
} from '../lib/routing';
import { Markets } from '../features/markets/Markets';
import { Loans } from '../features/loans/Loans';
import { Liquidate } from '../features/liquidate/Liquidate';

export function AppShell() {
	const navigate = useNavigate();
	const location = useLocation();
	const net = useNetwork();
	const { address, isConnected, chainId: walletChainId } = useAccount();
	const { switchChain, isPending: switching } = useSwitchChain();
	const { connectors, connect, isPending: connecting } = useConnect();
	const { disconnect } = useDisconnect();
	const wrongNetwork = isConnected && walletChainId !== net.chainId;
	const { isAdmin, loading: adminLoading } = useIsProtocolAdmin(address);
	const tab = tabFromPath(location.pathname);

	useEffect(() => {
		document.title = pageTitleFromPath(location.pathname);
	}, [location.pathname]);

	useEffect(() => {
		if (!location.hash) return;
		const nextPath = pathFromLegacyHash(location.hash);
		if (!nextPath) return;
		navigate(nextPath, { replace: true });
	}, [location.hash, navigate]);

	useEffect(() => {
		if (adminLoading) return;
		const adminOnly =
			location.pathname.startsWith('/admin') ||
			location.pathname.startsWith('/liquidate');
		if (adminOnly && !isAdmin) {
			navigate('/markets', { replace: true });
		}
	}, [adminLoading, isAdmin, location.pathname, navigate]);

	const nav: { id: AppTab; label: string; path: string }[] = [
		{ id: 'markets', label: 'Markets', path: '/' },
		{ id: 'assets', label: 'Assets', path: '/assets' },
		...(isAdmin
			? [
					{
						id: 'liquidate' as const,
						label: 'Liquidate',
						path: '/liquidate',
					},
					{ id: 'admin' as const, label: 'Admin', path: '/admin' },
			  ]
			: []),
	];


	return (
		<div className="app">
			<header className="app-header">
				<div className="app-header-inner">
					<button
						type="button"
						className="brand brand-btn"
						onClick={() => navigate('/')}
					>
						<BrandLockup />
					</button>
					<nav className="tabs" aria-label="Primary">
						{nav.map(({ id, label, path: to }) => (
							<button
								key={id}
								className={`tab ${tab === id ? 'active' : ''}`}
								onClick={() => navigate(to)}
							>
								{label}
							</button>
						))}
					</nav>
					<div className="header-controls">
						<span className="pill">{net.label}</span>
						<div className="wallet">
							{isConnected ? (
								<>
									<span className="pill">{shortAddr(address)}</span>
									<button
										className="btn ghost"
										onClick={() => disconnect()}
									>
										Disconnect
									</button>
								</>
							) : (
								<button
									className="btn"
									disabled={connecting || !connectors[0]}
									onClick={() => connect({ connector: connectors[0] })}
								>
									Connect wallet
								</button>
							)}
						</div>
					</div>
				</div>
			</header>

			<main className="app-body">
				<div className="page-shell">
					{wrongNetwork && (
						<div className="warn">
							Wrong network. Switch to {net.label} (chain {net.chainId})
							to continue.
							<button
								className="btn"
								disabled={switching}
								onClick={() => switchChain({ chainId: net.chainId })}
							>
								Switch network
							</button>
						</div>
					)}

					<Routes>
						<Route path="/" element={<Markets />} />
						<Route path="/markets" element={<Markets />} />
						<Route path="/markets/:marketId" element={<Markets />} />
						<Route
							path="/borrow"
							element={<Navigate to="/markets" replace />}
						/>
						<Route path="/assets" element={<Loans address={address} />} />
						<Route
							path="/admin"
							element={
								adminLoading ? (
									<div className="empty">
										<Spinner size={24} />
										<strong>Checking admin access…</strong>
									</div>
								) : isAdmin ? (
									<AdminPanel />
								) : (
									<Navigate to="/markets" replace />
								)
							}
						/>
						{/* <Route path="/price" element={<PriceCheck />} /> */}
						<Route
							path="/liquidate"
							element={
								adminLoading ? (
									<div className="empty">
										<Spinner size={24} />
										<strong>Checking admin access…</strong>
									</div>
								) : isAdmin ? (
									<Liquidate />
								) : (
									<Navigate to="/markets" replace />
								)
							}
						/>
						<Route
							path="*"
							element={<Navigate to="/markets" replace />}
						/>
					</Routes>
				</div>
			</main>
		</div>
	);
}
