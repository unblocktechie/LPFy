import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Address } from 'viem';
import { useAccount, useReadContracts } from 'wagmi';
import { borrowRateConfigAbi, marketLendingAbi } from '../../abi';
import { TokenPair } from '../../components/TokenPair';
import { MaybeLoading } from '../../components/Loader';
import { toInputAmount } from '../../lib/amounts';
import { formatAmount, shortAddr } from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import type { AppMarket } from '../../lib/networks';
import { marketPoolIds } from '../../lib/pairId';
import {
	debtTokenDecimals,
	formatBpsAsPct,
	resolveSymbol,
} from '../../lib/tokens';
import { useTxScope } from '../../hooks/tx';
import { SupplyPanel } from '../supply/SupplyPanel';
import { DepositPanel } from '../borrow/DepositPanel';

export function Markets() {
	const net = useNetwork();
	const navigate = useNavigate();
	const { marketId } = useParams<{ marketId?: string }>();
	const { address, isConnected } = useAccount();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');

	function openMarket(id: string) {
		navigate('/markets/' + id);
	}

	function backToList() {
		navigate('/markets');
	}

	const marketPoolReads = useReadContracts({
		contracts: net.markets.flatMap((m) => {
			const { primary } = marketPoolIds(m);
			return [
				{
					address: net.addresses.lendingModule,
					abi: marketLendingAbi,
					functionName: 'cashBalance' as const,
					args: [primary] as const,
					chainId: net.chainId,
				},
				{
					address: net.addresses.lendingModule,
					abi: marketLendingAbi,
					functionName: 'utilizationBps' as const,
					args: [primary] as const,
					chainId: net.chainId,
				},
				{
					address: net.addresses.lendingModule,
					abi: marketLendingAbi,
					functionName: 'getLenderApyBps' as const,
					args: [primary] as const,
					chainId: net.chainId,
				},
				{
					address: net.addresses.borrowRateConfig,
					abi: borrowRateConfigAbi,
					functionName: 'getBorrowAprBps' as const,
					args: [primary] as const,
					chainId: net.chainId,
				},
			];
		}),
		query: {
			enabled: net.contractsConfigured,
			staleTime: 0,
			refetchOnMount: 'always',
			refetchOnWindowFocus: true,
			refetchInterval: 10_000,
		},
	});

	const selected = net.markets.find((m) => m.id === marketId);

	if (selected) {
		return (
			<MarketDetail
				market={selected}
				connected={isConnected}
				address={address}
				onBack={backToList}
			/>
		);
	}

	return (
		<div className="markets-page">
			<div className="page-head">
				<div>
					<p className="eyebrow">Supported</p>
					<h2>Markets</h2>
					<p className="meta">
						Open a pair to supply {debtSym} or borrow against matching DEX
						LP NFTs.
					</p>
				</div>
			</div>

			<div className="surface-card">
				<div className="pos-table-wrap">
					<table className="data-table pos-table markets-table">
						<thead>
							<tr>
								<th>Pair</th>
								<th>Collateral</th>
								<th className="num">LTV</th>
								<th className="num">Borrow APR</th>
								<th className="num">Supply APY</th>
								<th className="num">Utilization</th>
								<th className="num">Cash</th>
							</tr>
						</thead>
						<tbody>
							{net.markets.map((m, i) => {
								const cashRow = marketPoolReads.data?.[i * 4];
								const utilRow = marketPoolReads.data?.[i * 4 + 1];
								const apyRow = marketPoolReads.data?.[i * 4 + 2];
								const aprRow = marketPoolReads.data?.[i * 4 + 3];
								const poolCash =
									cashRow?.status === 'success'
										? (cashRow.result as bigint)
										: undefined;
								const utilBps =
									utilRow?.status === 'success'
										? (utilRow.result as bigint)
										: undefined;
								const liveApy =
									apyRow?.status === 'success'
										? Number(apyRow.result)
										: undefined;
								const liveApr =
									aprRow?.status === 'success'
										? Number(aprRow.result)
										: undefined;
								return (
									<tr
										key={m.id}
										className="loan-row markets-row"
										onClick={() => openMarket(m.id)}
									>
										<td>
											<div className="pos-cell">
												<TokenPair
													token0={m.tokenA}
													token1={m.tokenB}
												/>
											</div>
										</td>
										<td>
											<span className="meta">{m.fee} LP</span>
										</td>
										<td className="num">{m.ltv}</td>
										<td className="num">
											<MaybeLoading
												loading={
													marketPoolReads.isLoading &&
													liveApr === undefined
												}
											>
												{liveApr !== undefined
													? formatBpsAsPct(liveApr)
													: '—'}
											</MaybeLoading>
										</td>
										<td className="num">
											<MaybeLoading
												loading={
													marketPoolReads.isLoading &&
													liveApy === undefined
												}
											>
												{liveApy !== undefined
													? formatBpsAsPct(liveApy)
													: '—'}
											</MaybeLoading>
										</td>
										<td className="num">
											{utilBps !== undefined
												? `${(Number(utilBps) / 100).toFixed(1)}%`
												: '—'}
										</td>
										<td className="num">
											<MaybeLoading
												loading={
													marketPoolReads.isLoading &&
													poolCash === undefined
												}
											>
												{poolCash !== undefined
													? `${formatAmount(
															poolCash,
															debtDec,
													  )} ${debtSym}`
													: '—'}
											</MaybeLoading>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
			<p className="page-footnote">
				Module {shortAddr(net.addresses.lendingModule)}
			</p>
		</div>
	);
}

export function MarketDetail({
	market,
	connected,
	address,
	onBack,
}: {
	market: AppMarket;
	connected: boolean;
	address?: `0x${string}`;
	onBack: () => void;
}) {
	const net = useNetwork();
	const txScope = useTxScope();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const pools = marketPoolIds(market);
	const pairId = pools.primary;
	const [action, setAction] = useState<'lend' | 'borrow'>('lend');

	const reads = useReadContracts({
		contracts: [
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'getLenderApyBps' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.borrowRateConfig,
				abi: borrowRateConfigAbi,
				functionName: 'getBorrowAprBps' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'cashBalance' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'availableToBorrow' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'utilizationBps' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'pools' as const,
				args: [pairId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'oracle' as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'defaultLtvBps' as const,
				chainId: net.chainId,
			},
		],
		query: {
			enabled: net.contractsConfigured,
			staleTime: 0,
			refetchOnMount: 'always',
		},
		scopeKey: txScope,
	});

	const liveLenderApyBps =
		reads.data?.[0]?.status === 'success'
			? Number(reads.data[0].result)
			: undefined;
	const liveBorrowAprBps =
		reads.data?.[1]?.status === 'success'
			? Number(reads.data[1].result)
			: undefined;
	const cash =
		reads.data?.[2]?.status === 'success'
			? (reads.data[2].result as bigint)
			: undefined;
	const available =
		reads.data?.[3]?.status === 'success'
			? (reads.data[3].result as bigint)
			: undefined;
	const utilBps =
		reads.data?.[4]?.status === 'success'
			? Number(reads.data[4].result)
			: undefined;
	const poolTuple =
		reads.data?.[5]?.status === 'success'
			? (reads.data[5].result as readonly [bigint, bigint, bigint, bigint])
			: undefined;
	const principal = poolTuple?.[2];
	const oracleAddr =
		reads.data?.[6]?.status === 'success'
			? (reads.data[6].result as Address)
			: net.addresses.oracle;
	const ltvBps =
		reads.data?.[7]?.status === 'success'
			? Number(reads.data[7].result)
			: undefined;
	const utilPct = utilBps !== undefined ? utilBps / 100 : 0;

	const ltvLabel = ltvBps !== undefined ? formatBpsAsPct(ltvBps) : market.ltv;

	const supplyApy = formatBpsAsPct(liveLenderApyBps ?? market.lenderApyBps);
	const borrowApr = formatBpsAsPct(liveBorrowAprBps ?? market.borrowAprBps);
	const cashLabel =
		cash !== undefined ? `${toInputAmount(cash, debtDec)} ${debtSym}` : '—';
	const availableLabel =
		available !== undefined
			? `${formatAmount(available, debtDec)} ${debtSym}`
			: '—';
	const debtLabel =
		principal !== undefined
			? `${formatAmount(principal, debtDec)} ${debtSym}`
			: '—';

	return (
		<div className="md-page">
			<div className="md-hero">
				<button
					type="button"
					className="md-back"
					onClick={onBack}
					aria-label="Back"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden
					>
						<path
							d="M10 3.5L5.5 8L10 12.5"
							stroke="currentColor"
							strokeWidth="1.75"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<div className="md-hero-main">
					<TokenPair token0={market.tokenA} token1={market.tokenB} />
					<span className="md-net">{net.label}</span>
				</div>
			</div>

			<div className="md-ribbon" aria-label="Market rates">
				<div>
					<span>LTV</span>
					<strong>{ltvLabel}</strong>
				</div>
				<div>
					<span>Borrow APR</span>
					<strong>{borrowApr}</strong>
				</div>
				<div>
					<span>Supply APY</span>
					<strong>{supplyApy}</strong>
				</div>
				<div>
					<span>Utilization</span>
					<strong>
						{utilBps !== undefined ? `${utilPct.toFixed(1)}%` : '—'}
					</strong>
				</div>
				<div>
					<span>Cash</span>
					<strong>{cashLabel}</strong>
				</div>
			</div>

			<div className="md-util-line" aria-hidden>
				<div
					className="md-util-line-fill"
					style={{ width: `${Math.min(utilPct, 100)}%` }}
				/>
			</div>

			<div className="md-workspace">
				<section className="md-main">
					<div
						className={`md-tabs md-tabs-hero ${
							action === 'borrow' ? 'is-borrow' : 'is-lend'
						}`}
						role="tablist"
					>
						<span className="md-tab-slider" aria-hidden />
						<button
							type="button"
							role="tab"
							aria-selected={action === 'lend'}
							className={action === 'lend' ? 'on' : ''}
							onClick={() => setAction('lend')}
						>
							Lend
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={action === 'borrow'}
							className={action === 'borrow' ? 'on' : ''}
							onClick={() => setAction('borrow')}
						>
							Borrow
						</button>
					</div>
					<div
						key={action}
						className={`md-action-pane md-action-pane-${action}`}
					>
						{action === 'lend' ? (
							<SupplyPanel
								pairId={pairId}
								label={market.pair}
								embedded
								compact
								connected={connected}
								address={address}
							/>
						) : (
							<DepositPanel
								connected={connected}
								address={address}
								marketFilter={market}
								compact
							/>
						)}
					</div>
				</section>

				<aside className="md-side">
					<h3>Details</h3>
					<div className="md-kv">
						<span>Pair ID</span>
						<strong title={pairId}>
							<code>{shortAddr(pairId as Address)}</code>
						</strong>
					</div>
					<div className="md-kv">
						<span>Loan asset</span>
						<strong>{debtSym}</strong>
					</div>
					<div className="md-kv">
						<span>Collateral</span>
						<strong>{market.fee} LP NFT</strong>
					</div>
					<div className="md-kv">
						<span>Oracle</span>
						<strong>
							<code>{shortAddr(oracleAddr)}</code>
						</strong>
					</div>
					<div className="md-kv">
						<span>Outstanding</span>
						<strong>{debtLabel}</strong>
					</div>
					<div className="md-kv">
						<span>Borrowable</span>
						<strong>{availableLabel}</strong>
					</div>
					{market.note ? <p className="md-note">{market.note}</p> : null}
				</aside>
			</div>
		</div>
	);
}
