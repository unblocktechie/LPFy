import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAccount, useSwitchChain } from 'wagmi';
import { BrandLockup } from '../components/BrandMark';
import { useNetwork } from '../lib/networkContext';
import { pageTitleFromPath, pathFromLegacyHash, tabFromPath } from '../lib/routing';
import { Markets } from '../features/markets/Markets';

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const net = useNetwork();
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = isConnected && walletChainId !== net.chainId;
  const tab = tabFromPath(location.pathname);

  useEffect(() => { document.title = pageTitleFromPath(location.pathname); }, [location.pathname]);
  useEffect(() => {
    if (!location.hash) return;
    const nextPath = pathFromLegacyHash(location.hash);
    if (nextPath) navigate(nextPath, { replace: true });
  }, [location.hash, navigate]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <button type="button" className="brand brand-btn" onClick={() => navigate('/')}><BrandLockup /></button>
          <nav className="tabs" aria-label="Primary">
            <button className={`tab ${tab === 'markets' ? 'active' : ''}`} onClick={() => navigate('/')}>Markets</button>
          </nav>
          <div className="header-controls"><div className="wallet">
            <ConnectButton chainStatus="none" accountStatus="address" showBalance={false} />
          </div></div>
        </div>
      </header>
      <main className="app-body"><div className="page-shell">
        {wrongNetwork && <div className="warn">Wrong network. Switch to {net.label} (chain {net.chainId}) to continue.
          <button className="btn" disabled={switching} onClick={() => switchChain({ chainId: net.chainId })}>Switch network</button>
        </div>}
        <Routes>
          <Route path="/" element={<Markets />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/markets/:marketId" element={<Markets />} />
          <Route path="/borrow" element={<Navigate to="/markets" replace />} />
          <Route path="*" element={<Navigate to="/markets" replace />} />
        </Routes>
      </div></main>
    </div>
  );
}
