import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  encodePacked,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWalletClient,
} from "wagmi";
import {
  borrowRateConfigAbi,
  marketLendingAbi,
  oracleAdminAbi,
  staticApySourceAbi,
} from "../abi";
import { LoadingText, MaybeLoading, Spinner } from "./Loader";
import { useNetwork } from "../lib/networkContext";
import {
  DEBT_ASSET,
  SEPOLIA_CIRCLE_USDC,
  SEPOLIA_USDT,
  SEPOLIA_WBTC,
  SEPOLIA_WETH,
} from "../lib/networks";
import { marketPoolIds } from "../lib/pairId";
import { formatBpsAsPct, resolveSymbol } from "../lib/tokens";
import { formatAmount, formatUsd8, shortAddr } from "../lib/format";
import { debtTokenDecimals } from "../lib/tokens";

type TxCall = { to: Address; data: Hex };

function pairIdOf(tokenA: Address, tokenB: Address): Hex {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(encodePacked(["address", "address"], [x, y]));
}

function useAdminTx() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  async function send(calls: TxCall[]): Promise<boolean> {
    if (!calls.length) return false;
    setBusy(true);
    setIsError(false);
    setStatus("Confirm in your wallet…");
    try {
      if (!walletClient) throw new Error("Connect admin wallet first.");
      for (let i = 0; i < calls.length; i += 1) {
        setStatus(
          calls.length > 1
            ? `Confirm step ${i + 1}/${calls.length}…`
            : "Confirm in your wallet…",
        );
        const hash = await walletClient.sendTransaction({
          to: calls[i].to,
          data: calls[i].data,
        });
        setStatus("Pending on-chain…");
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
      }
      setStatus("Confirmed.");
      window.setTimeout(() => setStatus(""), 2500);
      return true;
    } catch (e) {
      setIsError(true);
      const err = e as { shortMessage?: string; message?: string };
      setStatus(err.shortMessage || err.message || "Transaction failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { send, busy, status, isError };
}

function AddrRow({ label, value }: { label: string; value?: Address | string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="admin-addr">
      <span>{label}</span>
      <strong>
        <code title={value}>{shortAddr(value as Address)}</code>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </strong>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {children}
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
    </label>
  );
}

function TokenChips({
  tokens,
  value,
  onPick,
}: {
  tokens: { label: string; address: Address }[];
  value: string;
  onPick: (addr: Address) => void;
}) {
  return (
    <div className="admin-chips">
      {tokens.map((t) => {
        const on = value.toLowerCase() === t.address.toLowerCase();
        return (
          <button
            key={t.label}
            type="button"
            className={`admin-chip ${on ? "on" : ""}`}
            onClick={() => onPick(t.address)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function useIsProtocolAdmin(address?: Address) {
  const net = useNetwork();
  const owner = useReadContract({
    address: net.addresses.lendingModule,
    abi: marketLendingAbi,
    functionName: "owner",
    chainId: net.chainId,
    query: {
      enabled:
        net.contractsConfigured && net.addresses.lendingModule !== zeroAddress,
    },
  });
  const isAdmin =
    !!address &&
    !!owner.data &&
    address.toLowerCase() === (owner.data as Address).toLowerCase();
  return { isAdmin, owner: owner.data as Address | undefined, loading: owner.isLoading };
}

export function AdminPanel() {
  const net = useNetwork();
  const { address } = useAccount();
  const { isAdmin, owner, loading: ownerLoading } = useIsProtocolAdmin(address);
  const { send, busy, status, isError } = useAdminTx();
  const debtDec = debtTokenDecimals(net.addresses.debtAsset);
  const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, "USDC");

  const module = net.addresses.lendingModule;
  const rates = net.addresses.borrowRateConfig;
  const apyCfg = net.addresses.staticApySource;
  const oracle = net.addresses.oracle;

  const reads = useReadContracts({
    contracts: [
      { address: module, abi: marketLendingAbi, functionName: "paused", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "defaultLtvBps", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "maxUtilizationBps", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "fallbackLenderApyBps", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "oracle", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "borrowRateConfig", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "apySource", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "usdc", chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "adapters", args: [0], chainId: net.chainId },
      { address: module, abi: marketLendingAbi, functionName: "adapters", args: [1], chainId: net.chainId },
      { address: apyCfg, abi: staticApySourceAbi, functionName: "defaultApyBps", chainId: net.chainId },
      { address: oracle, abi: oracleAdminAbi, functionName: "maxPriceAge", chainId: net.chainId },
      { address: oracle, abi: oracleAdminAbi, functionName: "maxPoolDeviationBps", chainId: net.chainId },
      { address: rates, abi: borrowRateConfigAbi, functionName: "owner", chainId: net.chainId },
      { address: oracle, abi: oracleAdminAbi, functionName: "owner", chainId: net.chainId },
      { address: apyCfg, abi: staticApySourceAbi, functionName: "owner", chainId: net.chainId },
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "defaultLiquidationThresholdBps",
        chainId: net.chainId,
      },
    ],
    query: { enabled: net.contractsConfigured, staleTime: 0 },
  });

  const r = (i: number) => reads.data?.[i]?.result;
  /** Write target = whatever MarketLendingModule.apySource() returns. */
  const onChainApy = r(6) as Address | undefined;
  const apy =
    onChainApy && onChainApy !== zeroAddress ? onChainApy : apyCfg;

  const adminPools = useMemo(() => {
    return net.markets.map((m) => {
      const p = marketPoolIds(m);
      return {
        label: m.pair,
        pairId: p.primary,
        tokenA: m.tokenA as Address,
        tokenB: m.tokenB as Address,
      };
    });
  }, [net.markets]);

  const poolReads = useReadContracts({
    contracts: adminPools.flatMap((p) => [
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "cashBalance" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "utilizationBps" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "getLenderApyBps" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "pools" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
    ]),
    query: { enabled: net.contractsConfigured && adminPools.length > 0, staleTime: 0 },
  });

  const knownTokens = useMemo(
    () =>
      [
        { label: "WETH", address: SEPOLIA_WETH },
        { label: "Circle USDC", address: SEPOLIA_CIRCLE_USDC },
        { label: "USDC", address: DEBT_ASSET },
        { label: "USDT (mock)", address: SEPOLIA_USDT },
        { label: "WBTC (mock)", address: SEPOLIA_WBTC },
      ].filter((t) => t.address && t.address !== ("0x" as Address)),
    [],
  );

  const tokenPriceReads = useReadContracts({
    contracts: knownTokens.flatMap((t) => [
      {
        address: oracle,
        abi: oracleAdminAbi,
        functionName: "feeds" as const,
        args: [t.address] as const,
        chainId: net.chainId,
      },
      {
        address: oracle,
        abi: oracleAdminAbi,
        functionName: "getTokenPriceUsd" as const,
        args: [t.address] as const,
        chainId: net.chainId,
      },
    ]),
    query: { enabled: net.contractsConfigured, staleTime: 0 },
  });

  const pairChecks = useReadContracts({
    contracts: adminPools.flatMap((p) => [
      {
        address: rates,
        abi: borrowRateConfigAbi,
        functionName: "isPairSupported" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
      {
        address: rates,
        abi: borrowRateConfigAbi,
        functionName: "getBorrowAprBps" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
      {
        address: module,
        abi: marketLendingAbi,
        functionName: "getLenderApyBps" as const,
        args: [p.pairId] as const,
        chainId: net.chainId,
      },
    ]),
    query: {
      enabled: rates !== zeroAddress && adminPools.length > 0,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });

  // Forms
  const [tokenA, setTokenA] = useState(SEPOLIA_CIRCLE_USDC);
  const [tokenB, setTokenB] = useState(SEPOLIA_WETH);
  const [aprBps, setAprBps] = useState("600");
  const [lenderApyBps, setLenderApyBps] = useState("500");
  const [pairEnabled, setPairEnabled] = useState(true);

  const [defaultApy, setDefaultApy] = useState("");
  const [fallbackApy, setFallbackApy] = useState("");
  const [ltvBps, setLtvBps] = useState("");
  const [ltBps, setLtBps] = useState("");
  const [utilBps, setUtilBps] = useState("");

  const [feedToken, setFeedToken] = useState(SEPOLIA_CIRCLE_USDC);
  const [feedAddr, setFeedAddr] = useState("");
  const [maxAge, setMaxAge] = useState("");

  const [wireOracle, setWireOracle] = useState("");
  const [wireRates, setWireRates] = useState("");
  const [wireApy, setWireApy] = useState("");
  const [wireV3, setWireV3] = useState("");
  const [wireV4, setWireV4] = useState("");

  useEffect(() => {
    const dApy = r(10) as number | undefined;
    const fApy = r(3) as number | undefined;
    const ltv = r(1) as number | undefined;
    const util = r(2) as number | undefined;
    const age = r(11) as bigint | undefined;
    const lt = r(16) as number | undefined;
    if (dApy !== undefined && !defaultApy) setDefaultApy(String(dApy));
    if (fApy !== undefined && !fallbackApy) setFallbackApy(String(fApy));
    if (ltv !== undefined && !ltvBps) setLtvBps(String(ltv));
    if (lt !== undefined && !ltBps) setLtBps(String(lt));
    if (util !== undefined && !utilBps) setUtilBps(String(util));
    if (age !== undefined && !maxAge) setMaxAge(age.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads.dataUpdatedAt]);

  async function refresh() {
    await reads.refetch();
    await poolReads.refetch();
    await tokenPriceReads.refetch();
    await pairChecks.refetch();
  }

  async function run(calls: TxCall[]) {
    const ok = await send(calls);
    if (ok) await refresh();
    return ok;
  }

  if (ownerLoading) {
    return (
      <div className="empty">
        <Spinner size={24} />
        <strong>Checking admin access…</strong>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="assets-page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Restricted</p>
            <h2>Admin</h2>
            <p className="meta">
              Connect the protocol owner wallet to manage markets.
              {owner ? ` Owner: ${shortAddr(owner)}.` : null}
            </p>
          </div>
        </div>
        <div className="empty">Not authorized for this wallet.</div>
      </div>
    );
  }

  const paused = r(0) as boolean | undefined;
  const cashTotal = useMemo(() => {
    let sum = 0n;
    let n = 0;
    for (let i = 0; i < adminPools.length; i += 1) {
      const row = poolReads.data?.[i * 4];
      if (row?.status === "success") {
        sum += row.result as bigint;
        n += 1;
      }
    }
    return n ? sum : undefined;
  }, [adminPools.length, poolReads.data]);
  const principalTotal = useMemo(() => {
    let sum = 0n;
    let n = 0;
    for (let i = 0; i < adminPools.length; i += 1) {
      const row = poolReads.data?.[i * 4 + 3];
      if (row?.status === "success") {
        const pool = row.result as readonly [bigint, bigint, bigint, bigint];
        sum += pool[2];
        n += 1;
      }
    }
    return n ? sum : undefined;
  }, [adminPools.length, poolReads.data]);

  return (
    <div className="assets-page admin-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Owner</p>
          <h2>Admin</h2>
          <p className="meta">
            Manage pairs, rates, oracle feeds, and module wiring on {net.label}.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          {paused ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "unpause",
                    }),
                  },
                ])
              }
            >
              Unpause
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "pause",
                    }),
                  },
                ])
              }
            >
              Pause market
            </button>
          )}
        </div>
      </div>

      {(status || busy) && (
        <div className={`admin-status ${isError ? "bad" : ""}`}>
          {busy ? <Spinner size={14} /> : null}
          <span>{status}</span>
        </div>
      )}

      <div className="admin-kpis">
        <article className="card">
          <span className="badge">{paused ? "Paused" : "Live"}</span>
          <h3>Pool totals</h3>
          <div className="row">
            <span>Total cash</span>
            <strong>
              {cashTotal !== undefined
                ? `${formatAmount(cashTotal, debtDec)} ${debtSym}`
                : "—"}
            </strong>
          </div>
          <div className="row">
            <span>Total debt</span>
            <strong>
              {principalTotal !== undefined
                ? `${formatAmount(principalTotal, debtDec)} ${debtSym}`
                : "—"}
            </strong>
          </div>
          <p className="meta">Each pair has its own isolated cash pool.</p>
        </article>
        <article className="card">
          <span className="badge">Params</span>
          <h3>Risk & rates</h3>
          <div className="row">
            <span>Max LTV</span>
            <strong>{formatBpsAsPct(r(1) as number | undefined)}</strong>
          </div>
          <div className="row">
            <span>Liq. threshold</span>
            <strong>{formatBpsAsPct(r(16) as number | undefined)}</strong>
          </div>
          <div className="row">
            <span>Max utilization</span>
            <strong>{formatBpsAsPct(r(2) as number | undefined)}</strong>
          </div>
          <div className="row">
            <span>Default supply APY</span>
            <strong>{formatBpsAsPct(r(10) as number | undefined)}</strong>
          </div>
          <div className="row">
            <span>Module fallback APY</span>
            <strong>{formatBpsAsPct(r(3) as number | undefined)}</strong>
          </div>
        </article>
        <article className="card">
          <span className="badge">Owners</span>
          <h3>Access</h3>
          <AddrRow label="Module" value={owner} />
          <AddrRow label="Rates" value={r(13) as Address | undefined} />
          <AddrRow label="Oracle" value={r(14) as Address | undefined} />
          <AddrRow label="APY source" value={r(15) as Address | undefined} />
        </article>
      </div>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Pools</p>
            <h3>Cash, utilization &amp; supply APY</h3>
          </div>
        </header>
        <div className="pos-table-wrap admin-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Market</th>
                <th className="num">Cash</th>
                <th className="num">Debt</th>
                <th className="num">Utilization</th>
                <th className="num">Supply APY</th>
              </tr>
            </thead>
            <tbody>
              {adminPools.map((p, i) => {
                const cashRow = poolReads.data?.[i * 4];
                const utilRow = poolReads.data?.[i * 4 + 1];
                const apyRow = poolReads.data?.[i * 4 + 2];
                const poolRow = poolReads.data?.[i * 4 + 3];
                const cashVal =
                  cashRow?.status === "success"
                    ? (cashRow.result as bigint)
                    : undefined;
                const utilVal =
                  utilRow?.status === "success"
                    ? (utilRow.result as bigint)
                    : undefined;
                const apyBps =
                  apyRow?.status === "success"
                    ? Number(apyRow.result)
                    : undefined;
                const principalVal =
                  poolRow?.status === "success"
                    ? (
                        poolRow.result as readonly [
                          bigint,
                          bigint,
                          bigint,
                          bigint,
                        ]
                      )[2]
                    : undefined;
                return (
                  <tr key={p.pairId}>
                    <td>{p.label}</td>
                    <td className="num">
                      {cashVal !== undefined
                        ? `${formatAmount(cashVal, debtDec)} ${debtSym}`
                        : "—"}
                    </td>
                    <td className="num">
                      {principalVal !== undefined
                        ? `${formatAmount(principalVal, debtDec)} ${debtSym}`
                        : "—"}
                    </td>
                    <td className="num">
                      {utilVal !== undefined
                        ? `${(Number(utilVal) / 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="num">{formatBpsAsPct(apyBps)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Deployments</p>
            <h3>Active contracts</h3>
          </div>
        </header>
        <div className="admin-addr-list">
        <AddrRow label="MarketLendingModule" value={module} />
        <AddrRow label="BorrowRateConfig (cfg)" value={rates} />
        <AddrRow label="BorrowRateConfig (on-chain)" value={r(5) as Address | undefined} />
        <AddrRow label="StaticApySource (cfg/.env)" value={apyCfg} />
        <AddrRow label="APY source (on-chain module)" value={r(6) as Address | undefined} />
        <AddrRow label="Oracle (cfg)" value={oracle} />
        <AddrRow label="Oracle (on-chain)" value={r(4) as Address | undefined} />
        <AddrRow label="V3 adapter" value={r(8) as Address | undefined} />
        <AddrRow label="V4 adapter" value={r(9) as Address | undefined} />
        <AddrRow label="Debt / USDC token" value={r(7) as Address | undefined} />
        <AddrRow label="V3 NPM" value={net.addresses.v3Npm} />
        <AddrRow label="V4 NPM" value={net.addresses.v4Npm} />
        <AddrRow label="Factory" value={net.addresses.factory} />
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Pairs</p>
            <h3>Whitelist &amp; rates</h3>
            <p className="meta">
              Click a market to load it into the form. Saving writes borrow APR
              and lender APY in two wallet confirmations.
            </p>
          </div>
        </header>
        <div className="pos-table-wrap admin-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Token A</th>
                <th>Token B</th>
                <th className="num">Borrow APR</th>
                <th className="num">Supply APY</th>
                <th className="col-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {adminPools.map((p, i) => {
                const okRow = pairChecks.data?.[i * 3];
                const aprRow = pairChecks.data?.[i * 3 + 1];
                const apyRow = pairChecks.data?.[i * 3 + 2];
                const ok = okRow?.result === true;
                const fail = okRow?.status === "failure";
                const liveApr =
                  aprRow?.status === "success"
                    ? Number(aprRow.result)
                    : undefined;
                const liveApy =
                  apyRow?.status === "success"
                    ? Number(apyRow.result)
                    : undefined;
                return (
                  <tr
                    key={p.pairId}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setTokenA(p.tokenA);
                      setTokenB(p.tokenB);
                      if (liveApr !== undefined) setAprBps(String(liveApr));
                      if (liveApy !== undefined) setLenderApyBps(String(liveApy));
                      setPairEnabled(ok);
                    }}
                    title="Click to load into form below"
                  >
                    <td>{p.label}</td>
                    <td>
                      <code>{shortAddr(p.tokenA)}</code>
                    </td>
                    <td>
                      <code>{shortAddr(p.tokenB)}</code>
                    </td>
                    <td className="num">
                      <MaybeLoading
                        loading={pairChecks.isLoading && liveApr === undefined}
                      >
                        {liveApr !== undefined ? formatBpsAsPct(liveApr) : "—"}
                      </MaybeLoading>
                    </td>
                    <td className="num">
                      <MaybeLoading
                        loading={pairChecks.isLoading && liveApy === undefined}
                      >
                        {liveApy !== undefined ? formatBpsAsPct(liveApy) : "—"}
                      </MaybeLoading>
                    </td>
                    <td className="col-center">
                      <span className={`status-pill ${ok ? "ok" : "muted"}`}>
                        {fail ? "Error" : ok ? "Enabled" : "Off"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="meta admin-table-note">
            Live values from BorrowRateConfig and getLenderApyBps.
          </p>
        </div>

        <div className="admin-form">
          <div className="admin-form-grid">
            <Field label="Token A">
              <input
                value={tokenA}
                onChange={(e) => setTokenA(e.target.value as Address)}
                placeholder="0x…"
              />
              <TokenChips tokens={knownTokens} value={tokenA} onPick={setTokenA} />
            </Field>
            <Field label="Token B">
              <input
                value={tokenB}
                onChange={(e) => setTokenB(e.target.value as Address)}
                placeholder="0x…"
              />
              <TokenChips tokens={knownTokens} value={tokenB} onPick={setTokenB} />
            </Field>
            <Field
              label="Borrow APR"
              hint={`${formatBpsAsPct(Number(aprBps) || undefined)} — what borrowers pay`}
            >
              <input
                inputMode="numeric"
                value={aprBps}
                onChange={(e) => setAprBps(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field
              label="Lender APY"
              hint={`${formatBpsAsPct(Number(lenderApyBps) || undefined)} — display rate for lenders`}
            >
              <input
                inputMode="numeric"
                value={lenderApyBps}
                onChange={(e) =>
                  setLenderApyBps(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
          </div>
          <div className="admin-callout">
            ETH/WETH market accepts V3 WETH/USDC and V4 native ETH/USDC
            (UI + contracts map address(0) → WETH). Configure pairs with WETH:{" "}
            {shortAddr(SEPOLIA_WETH)}.
          </div>
          <div className="admin-form-foot">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={pairEnabled}
                onChange={(e) => setPairEnabled(e.target.checked)}
              />
              Pair enabled
            </label>
            <button
              type="button"
              className="btn"
              disabled={
                busy ||
                !isAddress(tokenA) ||
                !isAddress(tokenB) ||
                !aprBps ||
                !lenderApyBps
              }
              onClick={() => {
                const bps = Number(aprBps);
                const apyBps = Number(lenderApyBps);
                if (bps > 10_000 || apyBps > 10_000) return;
                const a = getAddress(tokenA);
                const b = getAddress(tokenB);
                const pid = pairIdOf(a, b);
                void run([
                  {
                    to: rates,
                    data: encodeFunctionData({
                      abi: borrowRateConfigAbi,
                      functionName: "setPair",
                      args: [a, b, bps, pairEnabled],
                    }),
                  },
                  {
                    to: apy,
                    data: encodeFunctionData({
                      abi: staticApySourceAbi,
                      functionName: "setApyBps",
                      args: [pid, apyBps],
                    }),
                  },
                ]);
              }}
            >
              Save pair + lender APY
            </button>
          </div>
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Rates &amp; risk</p>
            <h3>Global APY, LTV &amp; utilization</h3>
            <p className="meta">
              Per-pair lender APY is set above. These values are protocol-wide
              defaults.
            </p>
          </div>
        </header>
        <div className="admin-tiles">
          <div className="admin-tile">
            <h4>Display APY default</h4>
            <p className="meta">
              StaticApySource fallback when a pair has no override.
            </p>
            <Field label="Basis points">
              <input
                value={defaultApy}
                onChange={(e) =>
                  setDefaultApy(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
            <p className="admin-tile-live">
              {formatBpsAsPct(Number(defaultApy) || undefined)}
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy || !defaultApy}
              onClick={() =>
                void run([
                  {
                    to: apy,
                    data: encodeFunctionData({
                      abi: staticApySourceAbi,
                      functionName: "setDefaultApyBps",
                      args: [Number(defaultApy)],
                    }),
                  },
                ])
              }
            >
              Update display APY
            </button>
          </div>
          <div className="admin-tile">
            <h4>Module fallback APY</h4>
            <p className="meta">
              Used only if apySource is unset. Ignored while a source is wired.
            </p>
            <Field label="Basis points">
              <input
                value={fallbackApy}
                onChange={(e) =>
                  setFallbackApy(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
            <p className="admin-tile-live">
              {formatBpsAsPct(Number(fallbackApy) || undefined)}
            </p>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !fallbackApy}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "setFallbackLenderApyBps",
                      args: [Number(fallbackApy)],
                    }),
                  },
                ])
              }
            >
              Set fallback APY
            </button>
          </div>
          <div className="admin-tile">
            <h4>Default LTV</h4>
            <p className="meta">
              Live max borrow vs collateral for all open loans.
            </p>
            <Field label="Basis points">
              <input
                value={ltvBps}
                onChange={(e) => setLtvBps(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <p className="admin-tile-live">
              {formatBpsAsPct(Number(ltvBps) || undefined)}
            </p>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !ltvBps}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "setDefaultLtvBps",
                      args: [Number(ltvBps)],
                    }),
                  },
                ])
              }
            >
              Set LTV
            </button>
          </div>
          <div className="admin-tile">
            <h4>Liquidation threshold</h4>
            <p className="meta">
              Live LT for all loans (must be ≥ LTV). Lower after a max borrow to
              make positions liquidatable for demos.
            </p>
            <Field label="Basis points">
              <input
                value={ltBps}
                onChange={(e) => setLtBps(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <p className="admin-tile-live">
              {formatBpsAsPct(Number(ltBps) || undefined)}
            </p>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !ltBps}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "setDefaultLiquidationThresholdBps",
                      args: [Number(ltBps)],
                    }),
                  },
                ])
              }
            >
              Set LT
            </button>
          </div>
          <div className="admin-tile">
            <h4>Max utilization</h4>
            <p className="meta">
              Cap on pool utilization before new borrows are blocked.
            </p>
            <Field label="Basis points">
              <input
                value={utilBps}
                onChange={(e) =>
                  setUtilBps(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
            <p className="admin-tile-live">
              {formatBpsAsPct(Number(utilBps) || undefined)}
            </p>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !utilBps}
              onClick={() =>
                void run([
                  {
                    to: module,
                    data: encodeFunctionData({
                      abi: marketLendingAbi,
                      functionName: "setMaxUtilizationBps",
                      args: [Number(utilBps)],
                    }),
                  },
                ])
              }
            >
              Set max util
            </button>
          </div>
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Oracle</p>
            <h3>Feeds &amp; tokens</h3>
          </div>
        </header>
        <div className="pos-table-wrap admin-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Address</th>
                <th>Feed</th>
                <th className="num">Price (USD 1e8)</th>
              </tr>
            </thead>
            <tbody>
              {knownTokens.map((t, i) => {
                const feed = tokenPriceReads.data?.[i * 2];
                const price = tokenPriceReads.data?.[i * 2 + 1];
                const feedOk =
                  feed?.status === "success" ? (feed.result as Address) : undefined;
                const priceOk =
                  price?.status === "success" ? (price.result as bigint) : undefined;
                return (
                  <tr key={t.label}>
                    <td>{t.label}</td>
                    <td>
                      <code>{shortAddr(t.address)}</code>
                    </td>
                    <td>
                      <MaybeLoading loading={tokenPriceReads.isLoading}>
                        {feedOk && feedOk !== zeroAddress
                          ? shortAddr(feedOk)
                          : "—"}
                      </MaybeLoading>
                    </td>
                    <td className="num">
                      {priceOk !== undefined ? (
                        formatUsd8(priceOk)
                      ) : price?.status === "failure" ? (
                        <span className="bad">revert</span>
                      ) : (
                        <LoadingText />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="admin-form">
          <div className="admin-form-grid">
            <Field label="Token">
              <input
                value={feedToken}
                onChange={(e) => setFeedToken(e.target.value as Address)}
              />
              <TokenChips
                tokens={knownTokens}
                value={feedToken}
                onPick={setFeedToken}
              />
            </Field>
            <Field label="Chainlink feed">
              <input
                value={feedAddr}
                onChange={(e) => setFeedAddr(e.target.value as Address)}
                placeholder="0x…"
              />
            </Field>
            <Field label="Global max price age (seconds)">
              <input
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
          </div>
          <div className="admin-form-foot">
            <button
              type="button"
              className="btn"
              disabled={busy || !isAddress(feedToken) || !isAddress(feedAddr)}
              onClick={() =>
                void run([
                  {
                    to: oracle,
                    data: encodeFunctionData({
                      abi: oracleAdminAbi,
                      functionName: "setFeed",
                      args: [getAddress(feedToken), getAddress(feedAddr)],
                    }),
                  },
                ])
              }
            >
              Set feed
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy || !maxAge}
              onClick={() =>
                void run([
                  {
                    to: oracle,
                    data: encodeFunctionData({
                      abi: oracleAdminAbi,
                      functionName: "setMaxPriceAge",
                      args: [BigInt(maxAge)],
                    }),
                  },
                ])
              }
            >
              Set max age
            </button>
          </div>
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div>
            <p className="eyebrow">Wiring</p>
            <h3>Point module at contracts</h3>
            <p className="meta">
              Leave a field blank to keep the current address. Only filled
              fields are written.
            </p>
          </div>
        </header>
        <div className="admin-form">
          <div className="admin-form-grid">
            <Field label="Oracle">
              <input
                value={wireOracle}
                onChange={(e) => setWireOracle(e.target.value)}
                placeholder={String(r(4) ?? oracle)}
              />
            </Field>
            <Field label="BorrowRateConfig">
              <input
                value={wireRates}
                onChange={(e) => setWireRates(e.target.value)}
                placeholder={String(r(5) ?? rates)}
              />
            </Field>
            <Field label="ApySource">
              <input
                value={wireApy}
                onChange={(e) => setWireApy(e.target.value)}
                placeholder={String(r(6) ?? apy)}
              />
            </Field>
            <Field label="V3 adapter">
              <input
                value={wireV3}
                onChange={(e) => setWireV3(e.target.value)}
                placeholder={String(r(8) ?? net.addresses.v3Adapter)}
              />
            </Field>
            <Field label="V4 adapter">
              <input
                value={wireV4}
                onChange={(e) => setWireV4(e.target.value)}
                placeholder={String(r(9) ?? net.addresses.v4Adapter)}
              />
            </Field>
          </div>
          <div className="admin-form-foot">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
              const calls: TxCall[] = [];
              if (wireOracle && isAddress(wireOracle)) {
                calls.push({
                  to: module,
                  data: encodeFunctionData({
                    abi: marketLendingAbi,
                    functionName: "setOracle",
                    args: [getAddress(wireOracle)],
                  }),
                });
              }
              if (wireRates && isAddress(wireRates)) {
                calls.push({
                  to: module,
                  data: encodeFunctionData({
                    abi: marketLendingAbi,
                    functionName: "setBorrowRateConfig",
                    args: [getAddress(wireRates)],
                  }),
                });
              }
              if (wireApy && isAddress(wireApy)) {
                calls.push({
                  to: module,
                  data: encodeFunctionData({
                    abi: marketLendingAbi,
                    functionName: "setApySource",
                    args: [getAddress(wireApy)],
                  }),
                });
              }
              if (
                (wireV3 && isAddress(wireV3)) ||
                (wireV4 && isAddress(wireV4))
              ) {
                const v3 = wireV3 && isAddress(wireV3)
                  ? getAddress(wireV3)
                  : (r(8) as Address);
                const v4 = wireV4 && isAddress(wireV4)
                  ? getAddress(wireV4)
                  : (r(9) as Address);
                calls.push({
                  to: module,
                  data: encodeFunctionData({
                    abi: marketLendingAbi,
                    functionName: "setAdapters",
                    args: [v3, v4],
                  }),
                });
              }
              if (!calls.length) return;
              void run(calls).then((ok) => {
                if (!ok) return;
                setWireOracle("");
                setWireRates("");
                setWireApy("");
                setWireV3("");
                setWireV4("");
              });
            }}
          >
            Apply wiring
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
