import { useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { BrandLockup } from '../components/BrandMark';
import { shortAddr } from '../lib/format';
import { useNetwork } from '../lib/networkContext';

export function AppShell() {
  const net = useNetwork();
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const wrongNetwork = isConnected && walletChainId !== net.chainId;

  useEffect(() => {
    document.title = 'LPFY Markets';
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <button type="button" className="brand brand-btn">
            <BrandLockup />
          </button>
          <nav className="tabs" aria-label="Primary" />
          <div className="header-controls">
            <span className="pill">{net.label}</span>
            <div className="wallet">
              {isConnected ? (
                <>
                  <span className="pill">{shortAddr(address)}</span>
                  <button className="btn ghost" onClick={() => disconnect()}>Disconnect</button>
                </>
              ) : (
                <button className="btn" disabled={connecting || !connectors[0]} onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="app-body">
        <div className="page-shell">
          {wrongNetwork && (
            <div className="warn">
              Wrong network. Switch to {net.label} (chain {net.chainId}) to continue.
              <button className="btn" disabled={switching} onClick={() => switchChain({ chainId: net.chainId })}>Switch network</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
