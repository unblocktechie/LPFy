import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { BrandLockup } from '../components/BrandMark';
import { PoolLiquidity } from '../features/pool/PoolLiquidity';
import { shortAddr } from '../lib/format';
import { useNetwork } from '../lib/networkContext';

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const net = useNetwork();
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const wrongNetwork = isConnected && walletChainId !== net.chainId;

  useEffect(() => { document.title = 'LPFY Markets'; }, [location.pathname]);

  return (
    <div className="app">
      <header className="app-header"><div className="app-header-inner">
        <button type="button" className="brand brand-btn" onClick={() => navigate('/')}><BrandLockup /></button>
        <nav className="tabs" aria-label="Primary"><button className="tab active" onClick={() => navigate('/')}>Markets</button></nav>
        <div className="header-controls"><span className="pill">{net.label}</span><div className="wallet">
          {isConnected ? <><span className="pill">{shortAddr(address)}</span><button className="btn ghost" onClick={() => disconnect()}>Disconnect</button></> :
          <button className="btn" disabled={connecting || !connectors[0]} onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>}
        </div></div>
      </div></header>
      <main className="app-body"><div className="page-shell">
        {wrongNetwork && <div className="warn">Wrong network. Switch to {net.label} (chain {net.chainId}) to continue.<button className="btn" disabled={switching} onClick={() => switchChain({ chainId: net.chainId })}>Switch network</button></div>}
        <Routes>
          <Route path="/" element={<PoolLiquidity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div></main>
    </div>
  );
}
