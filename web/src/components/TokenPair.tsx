import { useState } from "react";
import type { Address } from "viem";
import { resolveSymbol, tokenLogoUrl } from "../lib/tokens";

function hueFrom(symbol: string) {
  let h = 0;
  for (let i = 0; i < symbol.length; i += 1) h = (h + symbol.charCodeAt(i) * 17) % 360;
  return h;
}

export function TokenIcon({
  symbol,
  address,
  size = 22,
}: {
  symbol: string;
  address?: Address;
  size?: number;
}) {
  const src = tokenLogoUrl(address, symbol);
  const [failed, setFailed] = useState(false);
  const hue = hueFrom(symbol);

  if (src && !failed) {
    return (
      <img
        className="token-icon token-icon-img"
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="token-icon"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.38),
        background: `hsl(${hue} 42% 36%)`,
      }}
      aria-hidden
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function TokenPair({
  token0,
  token1,
}: {
  token0?: Address;
  token1?: Address;
}) {
  if (!token0 && !token1) {
    return <span className="pair-name muted">Pair unavailable</span>;
  }
  const s0 = resolveSymbol(token0, undefined, token0 ? "token0" : "—");
  const s1 = resolveSymbol(token1, undefined, token1 ? "token1" : "—");
  return (
    <span className="token-pair">
      <span className="token-pair-icons">
        <TokenIcon symbol={s0} address={token0} />
        <TokenIcon symbol={s1} address={token1} />
      </span>
      <span className="pair-name">
        {s0} / {s1}
      </span>
    </span>
  );
}
