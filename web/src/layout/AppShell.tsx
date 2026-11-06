import { BrandLockup } from '../components/BrandMark';
import { TokenPair } from '../components/TokenPair';
import { SEPOLIA_CIRCLE_USDC, SEPOLIA_WETH } from '../lib/networks';

export function AppShell() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="brand"><BrandLockup /></span>
        </div>
      </header>
      <main className="app-body">
        <div className="page-shell">
          <h1>LPFY Markets</h1>
          <p>Supply liquidity and borrow against Uniswap LP positions.</p>
          <TokenPair token0={SEPOLIA_CIRCLE_USDC} token1={SEPOLIA_WETH} />
        </div>
      </main>
    </div>
  );
}
